// Seed a fresh demo install with a realistic task history (succeeded, debugged, failed, cancelled)
// so the UI opens on populated screens. Only used by `nightshift demo` on an empty database.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Orchestrator } from "../agents/orchestrator.ts";
import { FIXTURES, makeRepo } from "../eval/fixtures.ts";
import { DEMO_SCENARIOS } from "../llm/demo.ts";

const PLAN: { fixture: string; cancelAfterMs?: number }[] = [
  { fixture: "py-median-even" },
  { fixture: "js-dates" },
  { fixture: "py-retry" },
  { fixture: "js-debounce" },
  { fixture: "py-slugify" },
  { fixture: "py-paginate", cancelAfterMs: 4000 },
];

export async function demoRepo(home: string, fixture: string): Promise<string> {
  const fx = FIXTURES.find((f) => f.name === fixture)!;
  const dir = join(home, "demo-repos", fixture);
  if (!existsSync(dir)) await makeRepo(dir, fx.files);
  return dir;
}

export async function seedDemo(orch: Orchestrator, home: string, opts: { timeScale?: number } = {}): Promise<void> {
  const k = opts.timeScale ?? 1;
  const { store, bus } = orch;
  if (store.listTasks().length) return;
  await demoRepo(home, "py-add");
  const runs: Promise<unknown>[] = [];
  for (const [i, p] of PLAN.entries()) {
    const fx = FIXTURES.find((f) => f.name === p.fixture)!;
    const repo = await demoRepo(home, p.fixture);
    const task = store.createTask({ prompt: fx.task, repo, baseBranch: "main", numAttempts: DEMO_SCENARIOS[p.fixture]?.length ?? 1 });
    bus.emit(task.id, null, "user", "task.created", { prompt: task.prompt, repo: task.repo, numAttempts: task.numAttempts });
    // Stagger starts so the list has a natural spread of start times.
    runs.push(
      new Promise((r) => setTimeout(r, i * 700 * k)).then(() => {
        if (p.cancelAfterMs) setTimeout(() => orch.cancel(task.id), p.cancelAfterMs * k);
        return orch.runTask(task.id);
      })
    );
  }
  await Promise.all(runs);
}
