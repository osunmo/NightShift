import test from "node:test";
import assert from "node:assert/strict";
import { headline } from "../src/agents/orchestrator.ts";

test("PR titles use the first sentence or cut at a word boundary", () => {
  assert.equal(headline("Fix the parser. It crashes on empty input."), "Fix the parser");
  assert.equal(headline("short task"), "short task");
  const long = "median() in stats.py is wrong for lists with an even number of items and it should return the mean of the two middle values";
  const h = headline(long);
  assert.ok(h.length <= 72 && h.endsWith("…") && !h.includes("  "), h);
  assert.ok(!/\s…$/.test(h));
});
