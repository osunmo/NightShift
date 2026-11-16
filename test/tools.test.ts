import test from "node:test";
import assert from "node:assert/strict";
import { LocalSandbox } from "../src/sandbox/local.ts";
import { runTool, specsFor, type ToolContext } from "../src/tools/index.ts";
import { tmp } from "./helpers.ts";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

async function ctx(role: ToolContext["role"] = "coder") {
  const dir = await tmp();
  await writeFile(join(dir, "a.txt"), "one\ntwo\ntwo\n");
  const sandbox = new LocalSandbox(dir);
  await sandbox.start();
  return { sandbox, role, getDiff: async () => "", report: () => {}, commandTimeoutMs: 10_000 } as ToolContext;
}

test("path guard blocks escapes and .git", async () => {
  const c = await ctx();
  for (const p of ["../x", "/etc/passwd/../../../x", "sub/../../x", ".git/config"]) {
    const r = await runTool("read_file", { path: p }, c);
    assert.ok(r.error, `should block ${p}`);
  }
  assert.equal((await runTool("read_file", { path: "/workspace/a.txt" }, c)).error, false);
});

test("search_replace requires a unique match", async () => {
  const c = await ctx();
  assert.match((await runTool("search_replace", { path: "a.txt", old_string: "two", new_string: "2" }, c)).output, /matches 2 times/);
  assert.match((await runTool("search_replace", { path: "a.txt", old_string: "nope", new_string: "2" }, c)).output, /not found/);
  assert.equal((await runTool("search_replace", { path: "a.txt", old_string: "one", new_string: "$& 1" }, c)).error, false);
  assert.equal(await c.sandbox.readFile("a.txt"), "$& 1\ntwo\ntwo\n", "replacement is literal");
});

test("policy blocks git push and rm -rf /", async () => {
  const c = await ctx();
  assert.ok((await runTool("run_command", { command: "git push origin main" }, c)).error);
  assert.ok((await runTool("run_command", { command: "rm -rf / " }, c)).error);
  assert.match((await runTool("run_command", { command: "echo hi" }, c)).output, /exit_code: 0[\s\S]*hi/);
});

test("roles get the right tools", () => {
  const names = (r: any) => specsFor(r).map((t) => t.name);
  assert.ok(!names("qa").includes("write_file") && !names("qa").includes("search_replace"), "QA cannot edit");
  assert.ok(names("qa").includes("submit_verdict") && !names("coder").includes("submit_verdict"));
  assert.ok(names("debugger").includes("submit_diagnosis") && names("debugger").includes("view_diff"));
  assert.ok(names("coder").includes("report") && names("coder").includes("finish"));
});

test("command timeout kills the process", async () => {
  const c = await ctx();
  const r = await runTool("run_command", { command: "sleep 5", timeout_seconds: 1 }, c);
  assert.match(r.output, /timed out/);
});
