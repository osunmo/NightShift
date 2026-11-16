// Checks the eval harness mechanics with a scripted "sloppy" model: its first fix only satisfies the
// visible test. Without review the sloppy fix ships; with review, QA flags the edge case and the
// debugger applies the real fix. (The real numbers come from running `npm run eval` with an API key.)
import test from "node:test";
import assert from "node:assert/strict";
import { FIXTURES } from "../src/eval/fixtures.ts";
import { runEval, toMarkdown } from "../src/eval/run.ts";
import { ScriptedProvider, call, respond } from "../src/llm/scripted.ts";

const fx = FIXTURES.find((f) => f.name === "py-median-even")!;

test("eval harness: hidden checks separate a sloppy fix from a reviewed one", async () => {
  const provider = new ScriptedProvider((req, turn) => {
    if (req.role === "coder") {
      // Sloppy: special-cases the visible test only, ignores the even-length requirement.
      if (turn === 0) return respond("", call("search_replace", { path: "stats.py", old_string: "return s[len(s) // 2]", new_string: "return s[(len(s) - 1) // 2]" }));
      return respond("", call("finish", { summary: "fixed median" }));
    }
    if (req.role === "qa") {
      const round = req.meta?.agentRun;
      if (round === "qa-1") return respond("", call("submit_verdict", { pass: false, score: 3, tests_passed: true, problems: ["median([4,1,3,2]) returns 2, expected 2.5"], summary: "Even case still wrong." }));
      return respond("", call("submit_verdict", { pass: true, score: 9, tests_passed: true, problems: [], summary: "Even and odd cases correct." }));
    }
    if (req.role === "debugger") {
      if (turn === 0) return respond("", call("write_file", { path: "stats.py", content: fx.solution["stats.py"] }));
      return respond("", call("submit_diagnosis", { root_cause: "even-length lists need the mean of two middle values", fix: "average the middle pair", fixed: true }));
    }
    throw new Error("unexpected " + req.role);
  });
  const { rows, summary } = await runEval({ provider, fixtures: [fx] });
  assert.equal(summary["no-review"].solved, 0, "without review the sloppy fix ships and fails hidden tests");
  assert.equal(rows.find((r) => r.mode === "no-review")!.shipped, true);
  assert.equal(summary["review"].solved, 1, "with review QA catches it and the debugger fixes it");
  assert.equal(rows.find((r) => r.mode === "review")!.fixRounds, 1);
  const md = toMarkdown(rows, summary);
  assert.match(md, /\*\*0\/1\*\* \| \*\*1\/1\*\*/);
});
