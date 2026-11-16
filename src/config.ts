import { homedir } from "node:os";
import { join } from "node:path";
import type { SandboxMode } from "./sandbox/index.ts";

export interface AppConfig {
  home: string;
  port: number;
  sandboxMode: SandboxMode;
  githubToken?: string;
  dryRunPR: boolean;
  maxConcurrentTasks: number;
  apiToken?: string;
}

export function configFromEnv(env = process.env): AppConfig {
  return {
    home: env.NIGHTSHIFT_HOME || join(homedir(), ".nightshift"),
    port: Number(env.NIGHTSHIFT_PORT || 4100),
    sandboxMode: (env.NIGHTSHIFT_SANDBOX as SandboxMode) || "local",
    githubToken: env.NIGHTSHIFT_GITHUB_TOKEN || env.GITHUB_TOKEN || undefined,
    dryRunPR: env.NIGHTSHIFT_DRY_RUN_PR === "1",
    maxConcurrentTasks: Number(env.NIGHTSHIFT_MAX_TASKS || 2),
    apiToken: env.NIGHTSHIFT_API_TOKEN || undefined,
  };
}
