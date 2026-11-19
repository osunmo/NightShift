import { homedir } from "node:os";
import { join } from "node:path";
import { parseSandboxMode, type SandboxMode } from "./sandbox/index.ts";

export interface AppConfig {
  home: string;
  port: number;
  host: string;
  sandboxMode: SandboxMode;
  githubToken?: string;
  dryRunPR: boolean;
  maxConcurrentTasks: number;
  resumeOnStart: boolean;
  apiToken?: string;
}

export function configFromEnv(env = process.env): AppConfig {
  return {
    home: env.NIGHTSHIFT_HOME || join(homedir(), ".nightshift"),
    port: Number(env.NIGHTSHIFT_PORT || 4100),
    // Loopback by default: on a cloud VM, reach the app through an SSH tunnel (or set 0.0.0.0 and
    // NIGHTSHIFT_API_TOKEN deliberately).
    host: env.NIGHTSHIFT_HOST || "127.0.0.1",
    sandboxMode: parseSandboxMode(env.NIGHTSHIFT_SANDBOX),
    githubToken: env.NIGHTSHIFT_GITHUB_TOKEN || env.GITHUB_TOKEN || undefined,
    dryRunPR: env.NIGHTSHIFT_DRY_RUN_PR === "1",
    maxConcurrentTasks: Number(env.NIGHTSHIFT_MAX_TASKS || 2),
    resumeOnStart: env.NIGHTSHIFT_RESUME !== "0",
    apiToken: env.NIGHTSHIFT_API_TOKEN || undefined,
  };
}
