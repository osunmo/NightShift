// Recovery: the process dies mid-task (simulated by an LLM call that never returns), a new
// orchestrator starts on the same database and workspaces, and the task continues from its last
// recoverable step instead of being lost or started over.
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { FIXTURES, makeRepo } from "../src/eval/fixtures.ts";
import { ScriptedProvider, call, respond, type ScriptFn } from "../src/llm/scripted.ts";
import { Bus } from "../src/bus.ts";
import { Orchestrator } from "../src/agents/orchestrator.ts";
import { git } from "../src/git/workspace.ts";
import { createApp } from "../src/server/app.ts";
import type { LLMRequest } from "../src/types.ts";
import { setup, tmp } from "./helpers.ts";

const fx = FIXTURES.find((f) => f.name === "py-add")!;
const TEST = "python3 -m unittest discover -q";
const hang = () => new Promise<never>(() => {}); // the process "dies" here: this call never returns
const settle = () => new Promise((r) => setTimeout(r, 200));
const run = (req: LLMRequest) => String(req.meta?.agentRun ?? "");

const coderRight: ScriptFn = (_req, turn) =>
  turn === 0
    ? respond("", call("search_replace", { path: "calc.py", old_string: "return a - b", new_string: "return a + b" }))
    : respond("", call("finish", { summary: "Fixed add()." }));
const qaPass = (turn: number) =>
  turn === 0 ? respond("", call("run_command", { command: TEST })) : respond("", call("submit_verdict", { pass: true, score: 9, tests_passed: true, problems: [], summary: "Correct." }));

/** Start a task that hangs where `script` says, then "restart": a new orchestrator on the same store. */
async function crashThenResume(first: ScriptFn, second: ScriptFn, numAttempts = 1) {
  const repo = await tmp("ns-repo-");
  await makeRepo(repo, fx.files);
  const a = await setup(new ScriptedProvider(first));
  const task = a.store.createTask({ prompt: fx.task, repo, baseBranch: "main", numAttempts });
  void a.orch.runTask(task.id); // never finishes
  for (let i = 0; i < 100 && !a.store.listEvents(task.id).some((e) => e.kind === "attempt.status"); i++) await settle();
  await settle();
  await settle();
  const before = { task: a.store.getTask(task.id)!, attempts: a.store.listAttempts(task.id) };

  const provider = new ScriptedProvider(second);
  const orch = new Orchestrator({ store: a.store, bus: new Bus(a.store), provider, home: a.home, sandboxMode: "local", dryRunPR: true });
  const done = await orch.resumeTask(task.id);
  return { ...a, task, before, done, provider, events: a.store.listEvents(task.id) };
}

test("crash during QA: resumes at QA, the coder is not run again", async () => {
  const r = await crashThenResume(
    (req, turn) => (req.role === "coder" ? coderRight(req, turn) : hang()),
    (req, turn) => {
      assert.notEqual(req.role, "coder", "coder must not rerun after it finished");
      return qaPass(turn);
    }
  );
  assert.equal(r.before.task.status, "running");
  assert.equal(r.before.attempts[0].status, "qa");
  assert.equal(r.done.status, "done", r.done.summary ?? "");
  assert.equal(r.store.listAttempts(r.task.id)[0].status, "passed");
  assert.ok(r.events.some((e) => e.kind === "recovery"));
  assert.match(r.store.listAttempts(r.task.id)[0].diff!, /\+    return a \+ b/);
});

test("crash mid-coder: a resumed coder keeps the work on disk and is told what it already did", async () => {
  const r = await crashThenResume(
    (req, turn) => {
      if (req.role !== "coder") return hang();
      return turn === 0 ? coderRight(req, 0) : hang(); // edited the file, then died before finishing
    },
    (req, turn) => {
      if (req.role === "coder") {
        assert.equal(run(req), "coder-2");
        const prompt = String(req.messages[1].content);
        assert.match(prompt, /resuming this task after an interruption/);
        assert.match(prompt, /search_replace/, "history of the interrupted run is in the prompt");
        return respond("", call("finish", { summary: "Edit was already in place; finished." }));
      }
      return qaPass(turn);
    }
  );
  assert.equal(r.before.attempts[0].status, "coding");
  assert.equal(r.done.status, "done", r.done.summary ?? "");
  assert.match(r.store.listAttempts(r.task.id)[0].diff!, /\+    return a \+ b/, "the edit made before the crash survived");
});

test("crash after QA rejected: resumes with the debugger, not another review", async () => {
  const r = await crashThenResume(
    (req, turn) => {
      if (req.role === "coder")
        return turn === 0
          ? respond("", call("search_replace", { path: "calc.py", old_string: "return a - b", new_string: "return a * b" }))
          : respond("", call("finish", { summary: "Changed operator." }));
      if (req.role === "qa") return turn === 0 ? respond("", call("submit_verdict", { pass: false, score: 2, tests_passed: false, problems: ["add multiplies"], summary: "Wrong." })) : hang();
      return hang(); // debugger
    },
    (req, turn) => {
      if (req.role === "debugger") {
        assert.match(String(req.messages[1].content), /add multiplies/, "debugger gets the verdict from before the crash");
        return turn === 0
          ? respond("", call("search_replace", { path: "calc.py", old_string: "return a * b\n\n\ndef mul", new_string: "return a + b\n\n\ndef mul" }))
          : respond("", call("submit_diagnosis", { root_cause: "used *", fix: "use +", fixed: true }));
      }
      assert.equal(run(req), "qa-2", "first review is not repeated");
      return qaPass(turn);
    }
  );
  assert.equal(r.before.attempts[0].status, "debugging");
  assert.equal(r.done.status, "done", r.done.summary ?? "");
  const [a] = r.store.listAttempts(r.task.id);
  assert.equal(a.fixRounds, 1);
  assert.deepEqual(r.events.filter((e) => e.kind === "verdict").map((e) => e.data.pass), [false, true]);
});

test("an attempt that passed before the crash is re-verified, not reviewed again", async () => {
  let firstQa: string | undefined;
  const reviewedAfter = new Set<string>();
  const r = await crashThenResume(
    (req, turn) => {
      if (req.role === "orchestrator" && req.meta?.kind === "plan")
        return respond("", call("make_plan", { strategies: [{ name: "one", instructions: "fix" }, { name: "two", instructions: "fix" }] }));
      if (req.role === "coder") return coderRight(req, turn);
      if (req.role === "qa") {
        firstQa ??= req.meta?.attemptId;
        return req.meta?.attemptId === firstQa ? qaPass(turn) : hang(); // one attempt passes, the other dies in review
      }
      return hang();
    },
    (req, turn) => {
      if (req.role === "qa") {
        reviewedAfter.add(String(req.meta?.attemptId));
        return qaPass(turn);
      }
      if (req.role === "orchestrator") return respond("", call("select_winner", { attempt_id: firstQa, reason: "first" }));
      throw new Error(`unexpected ${req.role}`);
    },
    2
  );
  const passed = r.before.attempts.find((a) => a.status === "passed");
  assert.ok(passed, "setup: one attempt had passed before the crash");
  assert.ok(r.before.attempts.some((a) => a.status === "qa"), "setup: the other was mid-review");
  assert.equal(r.done.status, "done", r.done.summary ?? "");
  assert.ok(!reviewedAfter.has(passed!.id), "the passed attempt is not reviewed again");
  assert.equal(reviewedAfter.size, 1, "the interrupted one is");
  const recheck = r.events.filter((e) => e.attemptId === passed!.id && e.kind === "tool.result" && e.data.name === "orchestrator_tests");
  assert.ok(recheck.length >= 2, "its tests ran again after the recovery");
  assert.deepEqual(r.store.listAttempts(r.task.id).map((a) => a.status), ["passed", "passed"]);
});

test("crash during planning: the task starts over", async () => {
  let planned = 0;
  const r = await crashThenResume(
    () => hang(),
    (req, turn) => {
      if (req.role === "orchestrator" && req.meta?.kind === "plan") {
        planned++;
        return respond("", call("make_plan", { strategies: [{ name: "a", instructions: "fix" }, { name: "b", instructions: "fix" }] }));
      }
      if (req.role === "orchestrator") return respond("", call("select_winner", { attempt_id: "", reason: "" }));
      if (req.role === "coder") return coderRight(req, turn);
      return qaPass(turn);
    },
    2
  );
  assert.equal(r.before.task.status, "planning");
  assert.equal(planned, 1);
  assert.equal(r.done.status, "done", r.done.summary ?? "");
  assert.equal(r.store.listAttempts(r.task.id).length, 2);
});

test("checkpoints save the attempt's code to a hidden ref without touching its branch or index", async () => {
  const repo = await tmp("ns-repo-");
  await makeRepo(repo, fx.files);
  const { store, orch } = await setup(new ScriptedProvider((req, turn) => (req.role === "coder" ? coderRight(req, turn) : qaPass(turn))));
  const task = store.createTask({ prompt: fx.task, repo, baseBranch: "main", numAttempts: 1 });
  await orch.runTask(task.id);
  const [a] = store.listAttempts(task.id);
  const ck = store.listEvents(task.id).filter((e) => e.kind === "checkpoint");
  assert.equal(ck.length, 1, "one checkpoint after the coder (nothing changed after QA)");
  const ref = `refs/nightshift/checkpoints/${a.id}`;
  const file = await git(a.workdir, ["show", `${ref}:calc.py`]);
  assert.match(file, /return a \+ b/);
  const log = await git(a.workdir, ["log", "--format=%s", "-1", ref]);
  assert.match(log, /checkpoint .*after coder/);
});

test("server restart resumes interrupted tasks through the normal queue", async () => {
  const repo = await tmp("ns-repo-");
  await makeRepo(repo, fx.files);
  const a = await setup(new ScriptedProvider((req, turn) => (req.role === "coder" ? coderRight(req, turn) : hang())));
  const task = a.store.createTask({ prompt: fx.task, repo, baseBranch: "main", numAttempts: 1 });
  void a.orch.runTask(task.id);
  for (let i = 0; i < 100 && a.store.listAttempts(task.id)[0]?.status !== "qa"; i++) await settle();

  // "Restart": a new orchestrator and server on the same store.
  const orch = new Orchestrator({ store: a.store, bus: new Bus(a.store), provider: new ScriptedProvider((_req, turn) => qaPass(turn)), home: a.home, sandboxMode: "local", dryRunPR: true });
  const server = createApp({ orch, maxConcurrentTasks: 1, info: {} });
  try {
    for (let i = 0; i < 150 && a.store.getTask(task.id)!.status !== "done"; i++) await settle();
    assert.equal(a.store.getTask(task.id)!.status, "done");
  } finally {
    server.close();
  }
});
