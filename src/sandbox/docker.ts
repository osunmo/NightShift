// Docker sandbox: one long-lived container per attempt, workspace bind-mounted at /workspace,
// commands run with `docker exec`.
import { mkdir } from "node:fs/promises";
import { Sandbox, type ExecOptions, type ExecResult } from "./sandbox.ts";
import { runProcess } from "./local.ts";

export interface DockerConfig {
  image: string; // e.g. node:22-bookworm
  dockerBin: string[]; // e.g. ["docker"] or ["sudo", "docker"]
  network: "bridge" | "none";
  memory?: string; // e.g. "2g"
  cpus?: string; // e.g. "2"
  extraMounts: string[]; // "host:container:ro"
  env: Record<string, string>;
  user?: string; // "uid:gid"
}

export function dockerConfigFromEnv(env = process.env): DockerConfig {
  const extraEnv: Record<string, string> = {};
  if (env.NIGHTSHIFT_DOCKER_PATH) extraEnv.PATH = env.NIGHTSHIFT_DOCKER_PATH;
  return {
    image: env.NIGHTSHIFT_DOCKER_IMAGE || "node:22-bookworm",
    dockerBin: (env.NIGHTSHIFT_DOCKER_BIN || "docker").split(/\s+/),
    network: (env.NIGHTSHIFT_DOCKER_NETWORK as any) || "bridge",
    memory: env.NIGHTSHIFT_DOCKER_MEMORY || "4g",
    cpus: env.NIGHTSHIFT_DOCKER_CPUS || "2",
    extraMounts: (env.NIGHTSHIFT_DOCKER_MOUNTS || "").split(",").filter(Boolean),
    env: extraEnv,
    user: env.NIGHTSHIFT_DOCKER_USER || (process.getuid ? `${process.getuid()}:${process.getgid!()}` : undefined),
  };
}

export class DockerSandbox extends Sandbox {
  kind = "docker" as const;
  containerId: string | null = null;

  constructor(workdir: string, private cfg: DockerConfig, private name: string) {
    super(workdir);
  }

  private docker(args: string[], timeoutMs?: number) {
    const [bin, ...pre] = this.cfg.dockerBin;
    return runProcess(bin, [...pre, ...args], {}, timeoutMs);
  }

  async start() {
    await mkdir(this.workdir, { recursive: true });
    const args = [
      "run",
      "-d",
      "--rm",
      "--name",
      this.name,
      "--network",
      this.cfg.network,
      "-v",
      `${this.workdir}:/workspace`,
      "-w",
      "/workspace",
      "-e",
      "CI=1",
      "-e",
      "HOME=/tmp",
      "-e",
      "PYTHONDONTWRITEBYTECODE=1",
    ];
    if (this.cfg.memory) args.push("--memory", this.cfg.memory);
    if (this.cfg.cpus) args.push("--cpus", this.cfg.cpus);
    if (this.cfg.user) args.push("--user", this.cfg.user);
    for (const m of this.cfg.extraMounts) args.push("-v", m);
    for (const [k, v] of Object.entries(this.cfg.env)) args.push("-e", `${k}=${v}`);
    args.push(this.cfg.image, "sleep", "infinity");
    const r = await this.docker(args, 120_000);
    if (r.code !== 0) throw new Error(`docker run failed: ${r.stderr || r.stdout}`);
    this.containerId = r.stdout.trim();
  }

  async exec(cmd: string, opts: ExecOptions = {}): Promise<ExecResult> {
    if (!this.containerId) throw new Error("sandbox not started");
    const envArgs = Object.entries(opts.env ?? {}).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
    const r = await this.docker(["exec", ...envArgs, "-w", "/workspace", this.containerId, "bash", "-lc", cmd], opts.timeoutMs);
    if (r.timedOut) await this.docker(["exec", this.containerId, "bash", "-c", "pkill -KILL -f . || true"], 10_000);
    return r;
  }

  async dispose() {
    if (this.containerId) await this.docker(["rm", "-f", this.containerId], 30_000);
    this.containerId = null;
  }
}
