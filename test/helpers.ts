import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Bus } from "../src/bus.ts";
import { Orchestrator, type OrchestratorOptions } from "../src/agents/orchestrator.ts";
import { Store } from "../src/store/db.ts";
import type { LLMProvider } from "../src/types.ts";

export async function tmp(prefix = "ns-") {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function setup(provider: LLMProvider, extra: Partial<OrchestratorOptions> = {}) {
  const home = await tmp("ns-home-");
  const store = new Store(join(home, "db.sqlite"));
  const bus = new Bus(store);
  const orch = new Orchestrator({ store, bus, provider, home, sandboxMode: "local", dryRunPR: true, ...extra });
  return { home, store, bus, orch };
}
