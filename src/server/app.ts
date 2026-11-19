// HTTP API + Server-Sent Events + static UI. No framework, just node:http.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize } from "node:path";
import { existsSync, statSync } from "node:fs";
import type { GitHubAppSettings } from "./github-app-settings.ts";
import { isModelProvider, type ModelSettings } from "./model-settings.ts";
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

/** Serve the built pages from web/dist: the homepage at / and the application at /app/. */
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
  // /app and anything under it is the application; everything else falls back to the homepage.
  const isApp = /^\/app(\/|$)/.test(pathname);
  const index = join(DIST, isApp ? "app/index.html" : "index.html");
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
  if (existsSync(index)) return res.end(await readFile(index));
  res.end(`<!doctype html><title>Nightshift</title><body style="font:14px system-ui;padding:40px">
<h1>Nightshift</h1><p>The web app has not been built yet. Run <code>npm run build:web</code>, then reload.</p>
<p>The API is available at <code>/api</code>.</p></body>`);
}

export interface AppDeps {
  orch: Orchestrator;
  maxConcurrentTasks: number;
  resumeOnStart?: boolean;
  apiToken?: string;
  modelSettings?: ModelSettings;
  githubApp?: GitHubAppSettings;
  info: Record<string, any>;
}

export function createApp(deps: AppDeps): Server {
  const { orch } = deps;
  const { store, bus } = orch;
  const queue: string[] = [];
  const resumable = new Set<string>();
  let running = 0;

  // Tasks the previous process left unfinished: resume them from their event log and workspaces
  // (NIGHTSHIFT_RESUME=0 marks them failed instead, the old behaviour).
  for (const t of store.listTasks().reverse())
    if (["queued", "planning", "running", "evaluating"].includes(t.status)) {
      if (t.status === "queued") queue.push(t.id);
      else if (deps.resumeOnStart === false) store.updateTask(t.id, { status: "failed", summary: "Interrupted by a server restart." });
      else {
        resumable.add(t.id);
        queue.push(t.id);
      }
    }

  const pump = () => {
    if (deps.modelSettings && !deps.modelSettings.ready) return;
    while (running < deps.maxConcurrentTasks && queue.length) {
      const id = queue.shift()!;
      const resume = resumable.delete(id);
      if (!resume && store.getTask(id)?.status !== "queued") continue;
      running++;
      (resume ? orch.resumeTask(id) : orch.runTask(id))
        .catch(() => {})
        .finally(() => {
          running--;
          pump();
        });
    }
  };
  // Start what was left over from the previous process.
  if (queue.length) setImmediate(pump);

  const routes: [string, RegExp, (req: IncomingMessage, res: ServerResponse, m: RegExpMatchArray) => Promise<void>][] = [
    ["GET", /^\/api\/info$/, async (_q, res) => json(res, { ...deps.info, ...deps.modelSettings?.status() })],
    [
      "GET",
      /^\/api\/settings\/github$/,
      async (req, res) => {
        if (!canAccessSettings(req, deps.apiToken)) return json(res, { error: "Use a local or authenticated Nightshift session." }, 403);
        res.setHeader("cache-control", "no-store");
        if (!deps.githubApp) return json(res, { configured: false });
        try {
          json(res, await deps.githubApp.list());
        } catch {
          json(res, { error: "Nightshift could not load GitHub App installations or repositories. Check the app credentials and repository access." }, 502);
        }
      },
    ],
    [
      "PUT",
      /^\/api\/settings\/github$/,
      async (req, res) => {
        if (!canAccessSettings(req, deps.apiToken)) return json(res, { error: "Use a local or authenticated Nightshift session." }, 403);
        if (!deps.githubApp) return json(res, { error: "Configure the GitHub App on the server first." }, 404);
        if (req.headers["content-type"]?.split(";")[0]?.trim() !== "application/json")
          return json(res, { error: "Expected JSON." }, 415);
        const payload = await body(req).catch(() => null);
        const id = payload?.installationId;
        if (!Number.isSafeInteger(id) || id <= 0) return json(res, { error: "Select a GitHub installation." }, 400);
        try {
          if (!await deps.githubApp.connect(id)) return json(res, { error: "This installation is unavailable." }, 404);
          json(res, { ok: true });
        } catch {
          json(res, { error: "Nightshift could not connect the GitHub App." }, 502);
        }
      },
    ],
    [
      "PUT",
      /^\/api\/settings\/models$/,
      async (req, res) => {
        if (!deps.modelSettings) return json(res, { error: "Model settings are unavailable." }, 404);
        if (!canAccessSettings(req, deps.apiToken))
          return json(res, { error: "Use a local Nightshift session or an authenticated connection." }, 403);
        if (req.headers["content-type"]?.split(";")[0]?.trim() !== "application/json")
          return json(res, { error: "Expected JSON." }, 415);
        const payload = await body(req).catch(() => null);
        const key = typeof payload?.key === "string" ? payload.key.trim() : "";
        if (!isModelProvider(payload?.provider) || !key || key.length > 4096 || /[\s\x00-\x1f\x7f]/.test(key))
          return json(res, { error: "Enter a valid API key for a supported provider." }, 400);
        try {
          deps.modelSettings.save(payload.provider, key);
        } catch {
          return json(res, { error: "Nightshift could not save the model key." }, 500);
        }
        pump();
        json(res, { ...deps.info, ...deps.modelSettings.status() });
      },
    ],
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
        if (deps.modelSettings && !deps.modelSettings.ready)
          return json(res, { error: "Configure a model key in Settings → Models." }, 503);
        if (!b.prompt || !b.repo) return json(res, { error: "prompt and repo are required" }, 400);
        if (b.pullRequest !== undefined && b.pullRequest !== "draft" && b.pullRequest !== "off")
          return json(res, { error: "pullRequest must be draft or off" }, 400);
        const task = store.createTask({
          pullRequest: b.pullRequest,
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

function canAccessSettings(req: IncomingMessage, apiToken?: string) {
  const site = req.headers["sec-fetch-site"];
  const loopback = /^(?:127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress ?? "")
    && /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(req.headers.host ?? "");
  return Boolean(apiToken || loopback) && (!site || site === "same-origin" || site === "none");
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
