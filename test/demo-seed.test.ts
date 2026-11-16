import test from "node:test";
import assert from "node:assert/strict";
import { demoProvider } from "../src/llm/demo.ts";
import { seedDemo } from "../src/demo/seed.ts";
import { setup } from "./helpers.ts";

test("demo seed produces succeeded, debugged, failed and cancelled tasks", async () => {
  const { orch, store, home } = await setup(demoProvider(40));
  await seedDemo(orch, home, { timeScale: 0.06 });
  const tasks = store.listTasks();
  assert.equal(tasks.length, 6);
  const by = (name: string) => tasks.find((t) => t.repo.endsWith(name))!;
  assert.equal(by("py-median-even").status, "done");
  assert.equal(by("js-dates").status, "done");
  assert.equal(by("js-debounce").status, "failed");
  assert.equal(by("py-paginate").status, "cancelled");
  const median = store.listAttempts(by("py-median-even").id);
  assert.equal(median[0].fixRounds, 1, "sloppy attempt went through the debugger");
  assert.equal(median[0].status, "passed");
  assert.equal(by("py-median-even").winnerAttemptId, median[1].id, "clean attempt shipped");
  await seedDemo(orch, home); // no-op when tasks exist
  assert.equal(store.listTasks().length, 6);
});
