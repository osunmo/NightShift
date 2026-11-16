// HTTP API + Server-Sent Events + static UI. No framework, just node:http.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize } from "node:path";
import { existsSync, statSync } from "node:fs";
import type { Orchestrator } from "../agents/orchestrator.ts";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "dist");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

/** Serve the built single-page app from web/dist; unknown paths fall back to index.html. */
async function serveStatic(pathname: string, res: ServerResponse) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
  const file = join(DIST, rel);
  if (rel && !rel.startsWith("..") && file.startsWith(DIST) && existsSync(file) && statSync(file).isFile()) {
    const immutable = rel.startsWith("assets/");
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    });
    return res.end(await readFile(file));
  }
  const index = join(DIST, "index.html");
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
  if (existsSync(index)) return res.end(await readFile(index));
  res.end(`<!doctype html><title>Nightshift</title><body style="font:14px system-ui;padding:40px">
<h1>Nightshift</h1><p>The web app has not been built yet. Run <code>npm run build:web</code>, then reload.</p>
<p>The API is available at <code>/api</code>.</p></body>`);
}

export interface AppDeps {
  orch: Orchestrator;
  maxConcurrentTasks: number;
  apiToken?: string;
  info: Record<string, any>;
}

export function createApp(deps: AppDeps): Server {
  const { orch } = deps;
  const { store, bus } = orch;
  const queue: string[] = [];
  let running = 0;

  // Tasks that were running when the server stopped cannot be resumed (their processes are gone).
  for (const t of store.listTasks())
    if (["queued", "planning", "running", "evaluating"].includes(t.status)) {
      store.updateTask(t.id, { status: "failed", summary: "Interrupted by a server restart." });
    }

  const pump = () => {
    while (running < deps.maxConcurrentTasks && queue.length) {
      const id = queue.shift()!;
      if (store.getTask(id)?.status !== "queued") continue;
      running++;
      orch
        .runTask(id)
        .catch(() => {})
        .finally(() => {
          running--;
          pump();
        });
    }
  };

  const routes: [string, RegExp, (req: IncomingMessage, res: ServerResponse, m: RegExpMatchArray) => Promise<void>][] = [
    ["GET", /^\/api\/info$/, async (_q, res) => json(res, deps.info)],
    [
      "GET",
      /^\/api\/tasks$/,
      async (_q, res) =>
        json(
          res,
          store.listTasks().map((t) => ({
            ...t,
            paused: orch.control(t.id).paused,
            attempts: store.listAttempts(t.id).map((a) => ({
              id: a.id,
              index: a.index,
              status: a.status,
              score: a.score,
              fixRounds: a.fixRounds,
              strategy: a.strategy.name,
            })),
          }))
        ),
    ],
    [
      "POST",
      /^\/api\/tasks$/,
      async (req, res) => {
        const b = await body(req);
        if (!b.prompt || !b.repo) return json(res, { error: "prompt and repo are required" }, 400);
        const task = store.createTask({
          prompt: String(b.prompt),
          repo: String(b.repo),
          baseBranch: String(b.baseBranch || "main"),
          numAttempts: Math.max(1, Math.min(4, Number(b.numAttempts || 1))),
        });
        bus.emit(task.id, null, "user", "task.created", { prompt: task.prompt, repo: task.repo, numAttempts: task.numAttempts });
        queue.push(task.id);
        pump();
        json(res, task, 201);
      },
    ],
    [
      "GET",
      /^\/api\/tasks\/([\w-]+)$/,
      async (_q, res, m) => {
        const task = store.getTask(m[1]);
        if (!task) return json(res, { error: "not found" }, 404);
        json(res, { task, attempts: store.listAttempts(task.id), paused: orch.control(task.id).paused });
      },
    ],
    ["GET", /^\/api\/tasks\/([\w-]+)\/events$/, async (req, res, m) => json(res, store.listEvents(m[1], Number(q(req).get("after") || 0)))],
    [
      "GET",
      /^\/api\/tasks\/([\w-]+)\/stream$/,
      async (req, res, m) => {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        let last = Number(q(req).get("after") || req.headers["last-event-id"] || 0);
        const send = (e: any) => {
          if (e.id <= last) return;
          last = e.id;
          res.write(`id: ${e.id}\ndata: ${JSON.stringify(e)}\n\n`);
        };
        const off = bus.onTask(m[1], send);
        for (const e of store.listEvents(m[1], last)) send(e);
        const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
        req.on("close", () => {
          off();
          clearInterval(ping);
        });
      },
    ],
    [
      "POST",
      /^\/api\/tasks\/([\w-]+)\/steer$/,
      async (req, res, m) => {
        const b = await body(req);
        if (!b.text) return json(res, { error: "text is required" }, 400);
        orch.steer(m[1], String(b.text), b.attemptId || null);
        json(res, { ok: true });
      },
    ],
    ["POST", /^\/api\/tasks\/([\w-]+)\/pause$/, async (_q, res, m) => (orch.pause(m[1]), json(res, { ok: true }))],
    ["POST", /^\/api\/tasks\/([\w-]+)\/resume$/, async (_q, res, m) => (orch.resume(m[1]), json(res, { ok: true }))],
    ["POST", /^\/api\/tasks\/([\w-]+)\/cancel$/, async (_q, res, m) => (orch.cancel(m[1]), json(res, { ok: true }))],
    [
      "POST",
      /^\/api\/tasks\/([\w-]+)\/select$/,
      async (req, res, m) => {
        const b = await body(req);
        const a = store.getAttempt(String(b.attemptId));
        if (!a || a.taskId !== m[1]) return json(res, { error: "unknown attempt" }, 400);
        json(res, await orch.finalize(m[1], a.id, "Selected by the user."));
      },
    ],
  ];

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      if (req.method === "GET" && !url.pathname.startsWith("/api/")) return serveStatic(url.pathname, res);
      if (url.pathname.startsWith("/api/") && deps.apiToken) {
        const auth = req.headers.authorization || "";
        const tok = auth.startsWith("Bearer ") ? auth.slice(7) : url.searchParams.get("token");
        if (tok !== deps.apiToken) return json(res, { error: "unauthorized" }, 401);
      }
      for (const [method, re, handler] of routes) {
        const m = url.pathname.match(re);
        if (m && req.method === method) return await handler(req, res, m);
      }
      json(res, { error: "not found" }, 404);
    } catch (e: any) {
      if (!res.headersSent) json(res, { error: e.message }, 500);
    }
  });
}

const q = (req: IncomingMessage) => new URL(req.url ?? "/", "http://x").searchParams;

function json(res: ServerResponse, data: any, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

async function body(req: IncomingMessage): Promise<any> {
  let s = "";
  for await (const chunk of req) {
    s += chunk;
    if (s.length > 1_000_000) throw new Error("body too large");
  }
  return s ? JSON.parse(s) : {};
}
