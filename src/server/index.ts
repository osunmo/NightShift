// Start the Nightshift server: `npm start` (or `nightshift serve`).
import { join } from "node:path";
import { Bus } from "../bus.ts";
import { Orchestrator } from "../agents/orchestrator.ts";
import { configFromEnv } from "../config.ts";
import { createGitHubAppSettings } from "./github-app-settings.ts";
import { createModelSettings } from "./model-settings.ts";
import { demoProvider } from "../llm/demo.ts";
import { Store } from "../store/db.ts";
import { createApp } from "./app.ts";

export async function serve(opts: { demoDelayMs?: number } = {}) {
  const cfg = configFromEnv();
  const demo = process.env.NIGHTSHIFT_PROVIDER === "demo";
  const modelSettings = createModelSettings(cfg.home, demo ? demoProvider(opts.demoDelayMs ?? 600) : undefined);
  const { provider } = modelSettings;
  const store = new Store(join(cfg.home, "nightshift.db"));
  const bus = new Bus(store);
  const githubApp = createGitHubAppSettings(cfg.home);
  const orch = new Orchestrator({
    store,
    bus,
    provider,
    home: cfg.home,
    sandboxMode: cfg.sandboxMode,
    githubToken: demo ? undefined : cfg.githubToken,
    githubAppToken: demo ? undefined : githubApp?.tokenForRepo,
    dryRunPR: demo || cfg.dryRunPR,
  });
  const runtime = cfg.sandboxMode === "kubernetes" ? process.env.NIGHTSHIFT_K8S_RUNTIME_CLASS : cfg.sandboxMode === "docker" ? process.env.NIGHTSHIFT_DOCKER_RUNTIME : undefined;
  const info = {
    ...modelSettings.status(),
    sandbox: runtime ? `${cfg.sandboxMode} · ${runtime}` : cfg.sandboxMode,
    demo,
    prs: demo || cfg.dryRunPR ? "dry-run" : githubApp ? "github-app" : cfg.githubToken ? "github" : "dry-run",
    githubConfigured: Boolean(cfg.githubToken),
  };
  const server = createApp({ orch, maxConcurrentTasks: cfg.maxConcurrentTasks, resumeOnStart: cfg.resumeOnStart, apiToken: cfg.apiToken, modelSettings, githubApp, info });
  server.listen(cfg.port, cfg.host, () => {
    console.log(`Nightshift running at http://localhost:${cfg.port}${cfg.host === "127.0.0.1" ? "" : ` (listening on ${cfg.host})`}`);
    if (cfg.host !== "127.0.0.1" && cfg.host !== "localhost" && !cfg.apiToken) console.warn("  warning: reachable from the network without NIGHTSHIFT_API_TOKEN set");
    console.log(`  provider: ${info.provider}${demo ? " (scripted demo, not a real model)" : ""}, sandbox: ${info.sandbox}, PRs: ${info.prs}`);
  });
  return { server, orch, store, home: cfg.home };
}

if (import.meta.url === `file://${process.argv[1]}`) serve();
