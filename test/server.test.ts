import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.ts";
import { demoProvider } from "../src/llm/demo.ts";
import { FIXTURES, makeRepo } from "../src/eval/fixtures.ts";
import { setup, tmp } from "./helpers.ts";

test("API: create task, stream events over SSE, steer, finish, override winner", async () => {
  const repo = await tmp();
  await makeRepo(repo, FIXTURES.find((f) => f.name === "py-add")!.files);
  const { orch, store } = await setup(demoProvider(5));
  const server = createApp({ orch, maxConcurrentTasks: 2, apiToken: "secret", info: { provider: "demo" } });
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const auth = { authorization: "Bearer secret", "content-type": "application/json" };
  try {
    assert.equal((await fetch(`${base}/api/tasks`)).status, 401, "token required");
    assert.match(await (await fetch(base + "/")).text(), /Nightshift/);

    const res = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ repo, prompt: "add() is wrong, fix it", numAttempts: 2 }),
    });
    assert.equal(res.status, 201);
    const task = await res.json();

    // Read the SSE stream until the PR event shows up.
    const kinds: string[] = [];
    const sse = await fetch(`${base}/api/tasks/${task.id}/stream?token=secret`);
    const reader = sse.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let steered = false;
    while (!kinds.includes("pr")) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
      for (const chunk of buf.split("\n\n").slice(0, -1)) {
        const line = chunk.split("\n").find((l) => l.startsWith("data: "));
        if (line) kinds.push(JSON.parse(line.slice(6)).kind);
      }
      buf = buf.slice(buf.lastIndexOf("\n\n") + 2);
      if (!steered && kinds.includes("tool.call")) {
        steered = true;
        const s = await fetch(`${base}/api/tasks/${task.id}/steer`, { method: "POST", headers: auth, body: JSON.stringify({ text: "keep it small" }) });
        assert.equal(s.status, 200);
      }
    }
    await reader.cancel();
    for (const k of ["plan", "attempt.created", "tool.call", "verdict", "diagnosis", "steer", "steer.delivered", "evaluation", "pr"])
      assert.ok(kinds.includes(k), `stream had ${k}`);

    const detail = await (await fetch(`${base}/api/tasks/${task.id}`, { headers: auth })).json();
    assert.equal(detail.task.status, "done");
    assert.equal(detail.attempts.length, 2);
    const other = detail.attempts.find((a: any) => a.id !== detail.task.winnerAttemptId);
    assert.equal(other.status, "passed");
    const sel = await (await fetch(`${base}/api/tasks/${task.id}/select`, { method: "POST", headers: auth, body: JSON.stringify({ attemptId: other.id }) })).json();
    assert.equal(sel.winnerAttemptId, other.id);
    assert.equal(store.listTasks().length, 1);
  } finally {
    server.close();
  }
});
