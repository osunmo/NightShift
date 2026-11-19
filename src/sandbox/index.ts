import { DockerSandbox, dockerConfigFromEnv } from "./docker.ts";
import { KubernetesSandbox, kubernetesConfigFromEnv } from "./kubernetes.ts";
import { LocalSandbox } from "./local.ts";
import type { Sandbox } from "./sandbox.ts";

export type SandboxMode = "local" | "docker" | "kubernetes";
export const SANDBOX_MODES: SandboxMode[] = ["local", "docker", "kubernetes"];

export function parseSandboxMode(s: string | undefined): SandboxMode {
  const m = (s || "local").toLowerCase();
  if (m === "k8s") return "kubernetes";
  if (!SANDBOX_MODES.includes(m as SandboxMode)) throw new Error(`Unknown sandbox "${s}". Use one of: ${SANDBOX_MODES.join(", ")}.`);
  return m as SandboxMode;
}

export function createSandbox(mode: SandboxMode, workdir: string, name: string): Sandbox {
  if (mode === "docker") return new DockerSandbox(workdir, dockerConfigFromEnv(), `nightshift-${name}`);
  if (mode === "kubernetes") return new KubernetesSandbox(workdir, kubernetesConfigFromEnv(), name);
  return new LocalSandbox(workdir);
}

export { Sandbox } from "./sandbox.ts";
