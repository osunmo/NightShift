// Steering mid-run, blocked child -> orchestrator guidance, pause/resume, cancel, setup cache.
import test from "node:test";
import assert from "node:assert/strict";
import { FIXTURES, makeRepo } from "../src/eval/fixtures.ts";
import { ScriptedProvider, call, respond } from "../src/llm/scripted.ts";
import { setup, tmp } from "./helpers.ts";

const fx = FIXTURES.find((f) => f.name === "py-add")!;
const fixedCall = () => call("search_replace", { path: "calc.py", old_string: "return a - b", new_string: "return a + b" });
const qaPass = () => respond("", call("submit_verdict", { pass: true, score: 8, tests_passed: true, problems: [], summary: "ok" }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("steering: a message sent mid-run reaches the running coder on its next step", async () => {
  const repo = await tmp();
  await makeRepo(repo, fx.files);
  let orchRef: any, taskId = "";
  let sawSteer = false;
  const provider = new ScriptedProvider(async (req, turn) => {
    if (req.role === "coder") {
      if (turn === 0) {
        orchRef.steer(taskId, "Also add a docstring to add().");
        return respond("", call("read_file", { path: "calc.py" }));
      }
      if (turn === 1) {
        const last = req.messages.filter((m) => m.role === "user").at(-1)!;
        sawSteer = /docstring/.test((last as any).content);
        return respond("", fixedCall());
      }
      return respond("", call("finish", { summary: "done" }));
    }
    if (req.role === "qa") {
      // Broadcast steering is delivered once per attempt, so QA does not see it again.
      assert.ok(!req.messages.some((m) => m.role === "user" && /New instruction/.test((m as any).content)));
      return qaPass();
    }
    throw new Error("unexpected");
  });
  const { store, orch } = await setup(provider);
  orchRef = orch;
  const task = store.createTask({ prompt: fx.task, repo, baseBranch: "main", numAttempts: 1 });
  taskId = task.id;
  await orch.runTask(task.id);
  assert.ok(sawSteer, "coder saw the steering message");
  const ev = store.listEvents(task.id);
  assert.ok(ev.some((e) => e.kind === "steer"));
  assert.ok(ev.some((e) => e.kind === "steer.delivered" && e.role === "coder"));
});

test("child reports blocked -> orchestrator answers with guidance in the child's inbox", async () => {
  const repo = await tmp();
  await makeRepo(repo, fx.files);
  let guidanceSeen = false;
  const provider = new ScriptedProvider(async (req, turn) => {
    if (req.meta?.kind === "unblock") {
      assert.match(req.messages[1].content as string, /cannot find the add function/);
      return respond("", call("send_guidance", { guidance: "It is in calc.py at the repo root." }));
    }
    if (req.role === "coder") {
      if (turn === 0) return respond("", call("report", { status: "blocked", message: "I cannot find the add function." }));
      if (turn === 1) {
        await sleep(100); // let the orchestrator answer
        return respond("", call("list_dir", {}));
      }
      if (turn === 2) {
        guidanceSeen = req.messages.some((m) => m.role === "user" && /in calc\.py at the repo root/.test((m as any).content));
        return respond("", fixedCall());
      }
      return respond("", call("finish", { summary: "fixed after guidance" }));
    }
    if (req.role === "qa") return qaPass();
    throw new Error("unexpected " + req.role);
  });
  const { store, orch } = await setup(provider);
  const task = store.createTask({ prompt: fx.task, repo, baseBranch: "main", numAttempts: 1 });
  const done = await orch.runTask(task.id);
  assert.equal(done.status, "done");
  assert.ok(guidanceSeen, "coder received orchestrator guidance");
  assert.ok(store.listEvents(task.id).some((e) => e.kind === "evaluation" && e.data.decision === "guidance"));
});

test("pause holds the agent between steps; resume continues; cancel stops", async () => {
  const repo = await tmp();
  await makeRepo(repo, fx.files);
  let steps = 0;
  const provider = new ScriptedProvider(async (req) => {
    if (req.role === "coder") {
      steps++;
      return respond("", call("list_dir", {}));
    }
    throw new Error("unexpected");
  });
  const { store, orch } = await setup(provider, { maxSteps: { coder: 1000, qa: 5, debugger: 5 } });
  const task = store.createTask({ prompt: fx.task, repo, baseBranch: "main", numAttempts: 1 });
  const run = orch.runTask(task.id);
  while (steps < 3) await sleep(10);
  orch.pause(task.id);
  await sleep(50);
  const frozen = steps;
  await sleep(150);
  assert.ok(steps <= frozen + 1, `paused: ${frozen} -> ${steps}`);
  orch.resume(task.id);
  await sleep(100);
  assert.ok(steps > frozen + 1, "resumed");
  orch.cancel(task.id);
  const done = await run;
  assert.equal(done.status, "cancelled");
  assert.equal(store.listAttempts(task.id)[0].status, "cancelled");
});

test("fast setup: dependency install is cached by lockfile hash and reused across tasks and attempts", async () => {
  const repo = await tmp();
  await makeRepo(repo, {
    ...fx.files,
    ".nightshift.json": JSON.stringify({
      setup: "sleep 1 && mkdir -p node_modules/dep && echo 'installed' > node_modules/dep/index.js",
      test: "python3 -m unittest discover -q && test -f node_modules/dep/index.js",
      cachePaths: ["node_modules"],
      lockfiles: [".nightshift.json"],
    }),
  });
  const provider = new ScriptedProvider((req, turn) => {
    if (req.meta?.kind === "plan") return respond("", call("make_plan", { strategies: [{ name: "a", instructions: "x" }, { name: "b", instructions: "y" }] }));
    if (req.meta?.kind === "select") return respond("", call("select_winner", { attempt_id: req.messages[1].content.toString().match(/## (a_\S+)/)![1], reason: "first" }));
    if (req.role === "coder") return turn === 0 ? respond("", fixedCall()) : respond("", call("finish", { summary: "ok" }));
    if (req.role === "qa") return qaPass();
    throw new Error("unexpected");
  });
  const { store, orch } = await setup(provider);
  const setupEvents = (id: string) => store.listEvents(id).filter((e) => e.kind === "setup" && e.data.phase !== "config").map((e) => e.data);

  const t1 = store.createTask({ prompt: fx.task, repo, baseBranch: "main", numAttempts: 2 });
  assert.equal((await orch.runTask(t1.id)).status, "done");
  const s1 = setupEvents(t1.id);
  assert.equal(s1[0].phase, "base");
  assert.equal(s1[0].cached, false);
  assert.ok(s1[0].ms >= 1000, "cold install ran");
  assert.ok(s1.filter((s) => s.phase === "attempt").every((s) => s.cached), "attempts restored from cache");

  const t2 = store.createTask({ prompt: fx.task, repo, baseBranch: "main", numAttempts: 2 });
  assert.equal((await orch.runTask(t2.id)).status, "done");
  const s2 = setupEvents(t2.id);
  assert.ok(s2.every((s) => s.cached), "second task never re-ran setup");
  assert.ok(s2[0].ms < 1000, `cached setup was fast (${s2[0].ms}ms)`);
  // node_modules must not end up in the diff/PR.
  for (const a of store.listAttempts(t2.id)) assert.ok(!a.diff?.includes("node_modules"));
});
