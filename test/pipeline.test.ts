// End-to-end pipeline tests with a scripted model: orchestrator -> coders -> QA -> debugger -> QA -> PR.
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { FIXTURES, makeRepo } from "../src/eval/fixtures.ts";
import { ScriptedProvider, call, respond } from "../src/llm/scripted.ts";
import { git } from "../src/git/workspace.ts";
import { setup, tmp } from "./helpers.ts";

const addFixture = FIXTURES.find((f) => f.name === "py-add")!;

test("coder makes a wrong fix, QA rejects, debugger fixes, QA passes, PR body is built", async () => {
  const repo = await tmp("ns-repo-");
  await makeRepo(repo, addFixture.files);

  const provider = new ScriptedProvider((req, turn) => {
    const run = req.meta?.agentRun;
    if (req.role === "coder") {
      if (turn === 0) return respond("Looking at calc.py", call("read_file", { path: "calc.py" }));
      if (turn === 1)
        return respond("", call("search_replace", { path: "calc.py", old_string: "return a - b", new_string: "return a * b" }));
      return respond("", call("finish", { summary: "Changed add to use the right operator." }));
    }
    if (req.role === "qa" && run === "qa-1") {
      if (turn === 0) return respond("", call("view_diff", {}), call("run_command", { command: "python3 -m unittest discover -q" }));
      return respond("", call("submit_verdict", { pass: false, score: 2, tests_passed: false, problems: ["add(2,3) returns 6, test_add fails"], summary: "Wrong operator." }));
    }
    if (req.role === "debugger") {
      // The debugger must receive QA's problems in its prompt.
      assert.match(req.messages[1].content as string, /add\(2,3\) returns 6/);
      if (turn === 0) return respond("", call("run_command", { command: "python3 -m unittest discover -q" }));
      if (turn === 1)
        return respond("", call("search_replace", { path: "calc.py", old_string: "return a * b\n\n\ndef mul", new_string: "return a + b\n\n\ndef mul" }));
      return respond("", call("submit_diagnosis", { root_cause: "add used * instead of +", fix: "use +", fixed: true }));
    }
    if (req.role === "qa" && run === "qa-2") {
      if (turn === 0) return respond("", call("run_command", { command: "python3 -m unittest discover -q" }));
      return respond("", call("submit_verdict", { pass: true, score: 9, tests_passed: true, problems: [], summary: "add() fixed, tests pass." }));
    }
    throw new Error(`unexpected call ${req.role} ${run} ${turn}`);
  });

  const { store, orch } = await setup(provider);
  const task = store.createTask({ prompt: addFixture.task, repo, baseBranch: "main", numAttempts: 1 });
  const done = await orch.runTask(task.id);

  assert.equal(done.status, "done", done.summary ?? "");
  const [attempt] = store.listAttempts(task.id);
  assert.equal(attempt.status, "passed");
  assert.equal(attempt.fixRounds, 1);
  assert.match(attempt.diff!, /\+    return a \+ b/);

  const events = store.listEvents(task.id);
  const kinds = events.map((e) => e.kind);
  for (const k of ["plan", "setup", "verdict", "diagnosis", "evaluation", "pr", "report"]) assert.ok(kinds.includes(k as any), `missing ${k}`);
  const verdicts = events.filter((e) => e.kind === "verdict");
  assert.equal(verdicts[0].data.pass, false);
  assert.equal(verdicts[1].data.pass, true);
  assert.equal(verdicts[1].data.testsPassed, true, "orchestrator ran the tests itself");

  const pr = events.find((e) => e.kind === "pr")!.data;
  assert.equal(pr.dryRun, true);
  assert.match(pr.body, /Debugging rounds/);
  assert.match(pr.body, /add used \* instead of \+/);

  // The fix is committed on the attempt branch.
  const log = await git(attempt.workdir, ["log", "--oneline", "-1"]);
  assert.match(log, /add\(\) function/);
  assert.equal((await readFile(join(attempt.workdir, "calc.py"), "utf8")).includes("return a + b"), true);
});

test("QA saying pass does not override failing tests", async () => {
  const repo = await tmp("ns-repo-");
  await makeRepo(repo, addFixture.files);
  const provider = new ScriptedProvider((req, turn) => {
    if (req.role === "coder") return respond("", call("finish", { summary: "did nothing" }));
    if (req.role === "qa") return respond("", call("submit_verdict", { pass: true, score: 10, tests_passed: true, problems: [], summary: "lgtm" }));
    if (req.role === "debugger") return respond("", call("submit_diagnosis", { root_cause: "?", fix: "none", fixed: false }));
    throw new Error("unexpected");
  });
  const { store, orch } = await setup(provider, { maxFixRounds: 1 });
  const task = store.createTask({ prompt: addFixture.task, repo, baseBranch: "main", numAttempts: 1 });
  const done = await orch.runTask(task.id);
  assert.equal(done.status, "failed");
  const v = store.listEvents(task.id).filter((e) => e.kind === "verdict");
  assert.equal(v.length, 2, "one QA round, one debugger round, one more QA round");
  assert.equal(v[0].data.pass, false);
  assert.ok(v[0].data.problems.some((p: string) => /Test suite fails|No changes/.test(p)));
});

test("parallel attempts: planned strategies, both pass, orchestrator selects winner", async () => {
  const repo = await tmp("ns-repo-");
  await makeRepo(repo, addFixture.files);
  const concurrent = { now: 0, max: 0 };
  const provider = new ScriptedProvider(async (req, turn) => {
    if (req.meta?.kind === "plan")
      return respond("", call("make_plan", { strategies: [{ name: "minimal", instructions: "one-line fix" }, { name: "with-tests", instructions: "fix and add tests" }] }));
    if (req.meta?.kind === "select") {
      assert.match(req.messages[1].content as string, /with-tests/);
      const id = (req.messages[1].content as string).match(/## (a_\S+_2)/)![1];
      return respond("", call("select_winner", { attempt_id: id, reason: "Adds a regression test." }));
    }
    if (req.role === "coder") {
      concurrent.now++;
      concurrent.max = Math.max(concurrent.max, concurrent.now);
      await new Promise((r) => setTimeout(r, 30));
      concurrent.now--;
      if (turn === 0) return respond("", call("search_replace", { path: "calc.py", old_string: "return a - b", new_string: "return a + b" }));
      if (turn === 1 && req.meta!.attemptId.endsWith("_2"))
        return respond("", call("write_file", { path: "tests/test_more.py", content: "import unittest\nfrom calc import add\n\nclass M(unittest.TestCase):\n    def test_neg(self):\n        self.assertEqual(add(-1, -1), -2)\n" }));
      return respond("", call("finish", { summary: "fixed" }));
    }
    if (req.role === "qa") return respond("", call("submit_verdict", { pass: true, score: 8, tests_passed: true, problems: [], summary: "ok" }));
    throw new Error("unexpected " + req.role);
  });
  const { store, orch } = await setup(provider);
  const task = store.createTask({ prompt: addFixture.task, repo, baseBranch: "main", numAttempts: 2 });
  const done = await orch.runTask(task.id);
  assert.equal(done.status, "done");
  const attempts = store.listAttempts(task.id);
  assert.deepEqual(attempts.map((a) => a.strategy.name), ["minimal", "with-tests"]);
  assert.equal(done.winnerAttemptId, attempts[1].id);
  assert.equal(concurrent.max, 2, "coders ran in parallel");
  assert.notEqual(attempts[0].branch, attempts[1].branch);
  const pr = store.listEvents(task.id).find((e) => e.kind === "pr")!.data;
  assert.match(pr.body, /All attempts/);
  assert.match(pr.body, /Adds a regression test/);

  // User overrides the choice: finalize with attempt 1 instead.
  const again = await orch.finalize(task.id, attempts[0].id);
  assert.equal(again.winnerAttemptId, attempts[0].id);
});
