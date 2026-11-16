// Start the Nightshift server: `npm start` (or `nightshift serve`).
import { join } from "node:path";
import { Bus } from "../bus.ts";
import { Orchestrator } from "../agents/orchestrator.ts";
import { configFromEnv } from "../config.ts";
import { providerFromEnv } from "../llm/index.ts";
import { demoProvider } from "../llm/demo.ts";
import { Store } from "../store/db.ts";
import { createApp } from "./app.ts";

export async function serve(opts: { demoDelayMs?: number } = {}) {
  const cfg = configFromEnv();
  const demo = process.env.NIGHTSHIFT_PROVIDER === "demo";
  const provider = demo ? demoProvider(opts.demoDelayMs ?? 600) : providerFromEnv();
  const store = new Store(join(cfg.home, "nightshift.db"));
  const bus = new Bus(store);
  const orch = new Orchestrator({
    store,
    bus,
    provider,
    home: cfg.home,
    sandboxMode: cfg.sandboxMode,
    githubToken: demo ? undefined : cfg.githubToken,
    dryRunPR: demo || cfg.dryRunPR,
  });
  const info = { provider: provider.name, sandbox: cfg.sandboxMode, demo, prs: demo || cfg.dryRunPR || !cfg.githubToken ? "dry-run" : "github" };
  const server = createApp({ orch, maxConcurrentTasks: cfg.maxConcurrentTasks, apiToken: cfg.apiToken, info });
  server.listen(cfg.port, () => {
    console.log(`Nightshift running at http://localhost:${cfg.port}`);
    console.log(`  provider: ${info.provider}${demo ? " (scripted demo, not a real model)" : ""}, sandbox: ${info.sandbox}, PRs: ${info.prs}`);
  });
  return { server, orch, store, home: cfg.home };
}

if (import.meta.url === `file://${process.argv[1]}`) serve();
