// Sandbox abstraction. File operations go through the host filesystem with a path guard
// (the workspace is bind-mounted into Docker), commands run inside the sandbox.
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ExecOptions {
  timeoutMs?: number;
  env?: Record<string, string>;
}

export const MAX_OUTPUT = 20_000;

export abstract class Sandbox {
  abstract kind: "local" | "docker" | "kubernetes";
  constructor(public workdir: string) {
    this.workdir = resolve(workdir);
  }

  abstract start(): Promise<void>;
  abstract exec(cmd: string, opts?: ExecOptions): Promise<ExecResult>;
  abstract dispose(): Promise<void>;

  /** Called when a vanished container or pod was replaced; the orchestrator logs it. */
  onRestart?: (reason: string) => void;
  restarts = 0;
  static readonly MAX_RESTARTS = 3;

  /**
   * Run `cmd`; if it failed because the sandbox itself is gone (container removed, pod evicted,
   * node lost), start a fresh one and run the command again. The workspace lives on the host, so a
   * replacement sandbox sees exactly the same files: no work is lost.
   */
  protected async execRecovering(run: () => Promise<ExecResult>, alive: () => Promise<boolean>, looksGone: (r: ExecResult) => boolean): Promise<ExecResult> {
    const r = await run();
    if (r.code === 0 || !looksGone(r) || this.restarts >= Sandbox.MAX_RESTARTS || (await alive())) return r;
    this.restarts++;
    const reason = r.stderr.trim().split("\n")[0].slice(0, 200);
    await this.dispose().catch(() => {});
    await this.start();
    this.onRestart?.(reason);
    return run();
  }

  /** Resolve a workspace-relative path and refuse anything that escapes the workspace. */
  resolvePath(p: string): string {
    const abs = resolve(this.workdir, p.replace(/^\/+workspace\/?/, "").replace(/^\/+/, ""));
    const rel = relative(this.workdir, abs);
    if (rel.startsWith("..") || rel.split(sep).includes(".."))
      throw new Error(`Path escapes workspace: ${p}`);
    if (rel.split(sep)[0] === ".git") throw new Error(`Refusing to touch .git internals: ${p}`);
    return abs;
  }

  async readFile(p: string): Promise<string> {
    return readFile(this.resolvePath(p), "utf8");
  }

  async writeFile(p: string, content: string): Promise<void> {
    const abs = this.resolvePath(p);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
  }

  async deleteFile(p: string): Promise<void> {
    await rm(this.resolvePath(p), { force: true });
  }

  async listDir(p = "."): Promise<string[]> {
    const abs = this.resolvePath(p);
    const entries = await readdir(abs, { withFileTypes: true });
    return entries
      .filter((e) => e.name !== ".git" && e.name !== "node_modules" && e.name !== ".venv")
      .map((e) => (e.isDirectory() ? e.name + "/" : e.name))
      .sort();
  }

  async exists(p: string): Promise<boolean> {
    try {
      await stat(this.resolvePath(p));
      return true;
    } catch {
      return false;
    }
  }
}

export function truncate(s: string, max = MAX_OUTPUT): string {
  if (s.length <= max) return s;
  const half = Math.floor(max / 2);
  return s.slice(0, half) + `\n...[${s.length - max} chars truncated]...\n` + s.slice(-half);
}

/** Very small denylist. Real isolation comes from Docker; this stops obvious foot-guns in local mode. */
const BLOCKED = [
  /\brm\s+-[a-z]*r[a-z]*f?\s+\/(\s|$)/i,
  /\bmkfs\b/,
  /\bshutdown\b|\breboot\b/,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
  /\bgit\s+push\b/, // only the orchestrator pushes
  /\bdd\s+if=.*of=\/dev\//,
];

export function checkCommand(cmd: string): string | null {
  for (const re of BLOCKED) if (re.test(cmd)) return `Command blocked by policy: ${re}`;
  return null;
}

export function joinWs(...parts: string[]) {
  return join(...parts);
}
