// Local sandbox: runs commands directly on the host inside the workspace directory.
// Fast and simple for development; use DockerSandbox for real isolation.
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { Sandbox, truncate, type ExecOptions, type ExecResult } from "./sandbox.ts";

export class LocalSandbox extends Sandbox {
  kind = "local" as const;

  async start() {
    await mkdir(this.workdir, { recursive: true });
  }

  exec(cmd: string, opts: ExecOptions = {}): Promise<ExecResult> {
    return runProcess("bash", ["-lc", cmd], { cwd: this.workdir, env: { ...cleanEnv(), CI: "1", PYTHONDONTWRITEBYTECODE: "1", ...opts.env } }, opts.timeoutMs);
  }

  async dispose() {}
}

export function runProcess(
  bin: string,
  args: string[],
  spawnOpts: { cwd?: string; env?: NodeJS.ProcessEnv },
  timeoutMs = 120_000
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { ...spawnOpts, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {}
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? 124 : code ?? 1, stdout: truncate(stdout), stderr: truncate(stderr), timedOut });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: String(e), timedOut });
    });
  });
}

/** Host env minus variables that change how child tools behave (e.g. Node's test runner context). */
export function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of ["NODE_TEST_CONTEXT", "NODE_OPTIONS", "NODE_CHANNEL_FD"]) delete env[k];
  return env;
}
