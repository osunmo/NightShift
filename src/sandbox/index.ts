import { DockerSandbox, dockerConfigFromEnv } from "./docker.ts";
import { LocalSandbox } from "./local.ts";
import type { Sandbox } from "./sandbox.ts";

export type SandboxMode = "local" | "docker";

export function createSandbox(mode: SandboxMode, workdir: string, name: string): Sandbox {
  if (mode === "docker") return new DockerSandbox(workdir, dockerConfigFromEnv(), `nightshift-${name}`);
  return new LocalSandbox(workdir);
}

export { Sandbox } from "./sandbox.ts";
