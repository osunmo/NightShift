// Demo provider: a scripted model that plays realistic runs so the UI can be explored with no API key.
// It is NOT a real model. It recognises the bundled eval fixtures by their task text and plays one
// scenario per attempt: "clean" (fixes it), "sloppy" (superficial edit, QA rejects, debugger fixes)
// or "fail" (nobody manages to fix it). Unknown prompts fall back to the calc.py add() story.
import { FIXTURES, type Fixture } from "../eval/fixtures.ts";
import type { LLMRequest } from "../types.ts";
import { ScriptedProvider, call, respond } from "./scripted.ts";

type Scenario = "clean" | "sloppy" | "fail";

/** Scenario per attempt (index 0 = attempt 1). */
export const DEMO_SCENARIOS: Record<string, Scenario[]> = {
  "py-median-even": ["sloppy", "clean"],
  "js-dates": ["clean"],
  "py-retry": ["clean", "sloppy", "clean"],
  "js-debounce": ["fail"],
  "py-slugify": ["clean", "sloppy"],
  "py-paginate": ["clean", "clean"],
};

const NOTES: Record<string, { problem: string; cause: string }> = {
  "py-median-even": {
    problem: "median([4, 1, 3, 2]) returns 3. Even-length input should average the two middle values (2.5).",
    cause: "Even-length lists took the upper middle element instead of averaging the middle pair.",
  },
  "py-retry": {
    problem: "retry() returns None after the final failure instead of re-raising the last exception.",
    cause: "The last exception was swallowed by a bare except; it is now kept and re-raised after the loop.",
  },
  "js-debounce": {
    problem: "Three rapid calls still fire fn three times. Expected one call with the latest arguments.",
    cause: "Each call scheduled its own timer and earlier timers were never cleared.",
  },
  "py-slugify": {
    problem: "slugify('Hello,  World!') returns 'hello,--world!'. Runs of punctuation should collapse to one hyphen.",
    cause: "Only spaces were replaced; any run of non-alphanumeric characters must become a single hyphen.",
  },
  "py-paginate": { problem: "Page 1 skips the first items.", cause: "Pages are 1-based but the offset treated them as 0-based." },
  "js-dates": { problem: "Wrong day count across a DST change.", cause: "Local-time milliseconds were divided by 24h; UTC dates fix it." },
};

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const text = (req: LLMRequest) => req.messages.map((m) => ("content" in m ? String(m.content) : "")).join("\n");

function fixtureFor(req: LLMRequest): Fixture | null {
  const t = text(req);
  return FIXTURES.find((f) => f.name !== "py-add" && t.includes(f.task)) ?? null;
}

function testCommand(req: LLMRequest, fallback: string) {
  const sys = req.messages.find((m) => m.role === "system");
  return (sys && "content" in sys ? String(sys.content).match(/Test command: `([^`]+)`/)?.[1] : undefined) ?? fallback;
}

export function demoProvider(delayMs = 600) {
  return new ScriptedProvider(async (req, turn) => {
    await pause(delayMs * (0.6 + Math.random() * 0.8));
    const fx = fixtureFor(req);
    return fx ? fixtureScript(req, turn, fx) : addStory(req, turn);
  });
}

// ---------------- generic fixture scenarios ----------------
function fixtureScript(req: LLMRequest, turn: number, fx: Fixture) {
  const scenarios = DEMO_SCENARIOS[fx.name] ?? ["clean", "clean"];
  const idx = Number(String(req.meta?.attemptId ?? "_1").split("_").pop()) - 1;
  const scenario: Scenario = scenarios[idx] ?? "clean";
  const [file, solution] = Object.entries(fx.solution)[0];
  const original = fx.files[file];
  const comment = file.endsWith(".py") ? "# " : "// ";
  const test = testCommand(req, file.endsWith(".py") ? "python3 -m unittest discover -q" : "npm test");
  const note = NOTES[fx.name] ?? { problem: "The change does not handle the case described in the task.", cause: "The original logic did not cover that case." };
  const run = String(req.meta?.agentRun ?? "");
  const step = <T,>(steps: (() => T)[]) => (steps[turn] ?? steps.at(-1)!)();

  if (req.meta?.kind === "plan") {
    const names = [
      { name: "minimal-fix", instructions: "Find the faulty expression and change only that." },
      { name: "test-first", instructions: "Write a failing test for the reported case first, then fix it." },
      { name: "root-cause", instructions: "Trace the behavior to its root cause before editing; fix it there." },
    ];
    return respond(`Planning ${scenarios.length} approaches for ${file}.`, call("make_plan", { strategies: names.slice(0, Math.max(2, scenarios.length)) }));
  }
  if (req.meta?.kind === "select") {
    const ids = [...String(req.messages[1] && "content" in req.messages[1] ? req.messages[1].content : "").matchAll(/## (a_\S+)/g)].map((m) => m[1]);
    const pick = ids.find((id) => (scenarios[Number(id.split("_").pop()) - 1] ?? "clean") === "clean") ?? ids[0];
    return respond("", call("select_winner", { attempt_id: pick, reason: "Smallest correct change with no extra debugging rounds." }));
  }
  if (req.meta?.kind === "unblock") return respond("", call("send_guidance", { guidance: `The logic lives in ${file}.` }));

  if (req.role === "coder") {
    if (scenario === "clean")
      return step([
        () => respond("Looking at the repository layout.", call("list_dir", {})),
        () => respond("", call("read_file", { path: file })),
        () => respond("", call("report", { status: "progress", message: `Found the faulty logic in ${file}.` })),
        () => respond("Rewriting the function to handle the reported case.", call("write_file", { path: file, content: solution })),
        () => respond("", call("run_command", { command: test })),
        () => respond("", call("finish", { summary: `Fixed ${file}; visible tests pass.` })),
      ]);
    return step([
      () => respond("Looking at the repository layout.", call("list_dir", {})),
      () => respond("", call("read_file", { path: file })),
      () => respond("Adding a guard for the reported case.", call("write_file", { path: file, content: `${comment}handle edge case reported in task\n${original}` })),
      () => respond("", call("run_command", { command: test })),
      () => respond("", call("finish", { summary: `Updated ${file}. Visible tests pass.` })),
    ]);
  }

  if (req.role === "qa") {
    const round = Number(run.split("-")[1] ?? 1);
    const failing = scenario === "fail" || (scenario === "sloppy" && round === 1);
    return step([
      () => respond("Reviewing the diff before running anything.", call("view_diff", {})),
      () => respond("", call("run_command", { command: test })),
      () => respond("", call("read_file", { path: file })),
      () =>
        failing
          ? respond("", call("submit_verdict", { pass: false, score: 3, tests_passed: true, problems: [note.problem], summary: "Visible tests pass but the reported behavior is still wrong." }))
          : respond("", call("submit_verdict", { pass: true, score: scenario === "clean" ? 9 : 8, tests_passed: true, problems: [], summary: `The reported case in ${file} is handled and the existing tests pass.` })),
    ]);
  }

  if (req.role === "debugger") {
    if (scenario === "fail")
      return step([
        () => respond("Reproducing the reported behavior.", call("run_command", { command: test })),
        () => respond("", call("read_file", { path: file })),
        () => respond("", call("report", { status: "blocked", message: "The failure depends on timer ordering and I cannot reproduce it deterministically." })),
        () => respond("", call("submit_diagnosis", { root_cause: "Timer ordering in the test environment; not reproduced deterministically.", fix: "No safe change found.", fixed: false })),
      ]);
    return step([
      () => respond("Reproducing the failure QA reported.", call("run_command", { command: test })),
      () => respond("", call("read_file", { path: file })),
      () => respond(`Root cause: ${note.cause}`, call("write_file", { path: file, content: solution })),
      () => respond("", call("run_command", { command: test })),
      () => respond("", call("submit_diagnosis", { root_cause: note.cause, fix: `Rewrote the logic in ${file} and removed the placeholder comment.`, fixed: true })),
    ]);
  }
  return respond("", call("finish", { summary: "noop" }));
}

// ---------------- calc.py add() story (default for unknown prompts) ----------------
function addStory(req: LLMRequest, turn: number) {
  const attempt = String(req.meta?.attemptId ?? "");
  const second = attempt.endsWith("_2");
  if (req.meta?.kind === "plan")
    return respond(
      "Two approaches: a quick targeted fix, and a test-first fix that also covers edge cases.",
      call("make_plan", {
        strategies: [
          { name: "minimal-fix", instructions: "Find the faulty expression and change only that." },
          { name: "test-first", instructions: "Add a failing test for negative and float inputs first, then fix." },
        ],
      })
    );
  if (req.meta?.kind === "select") {
    const c = String(req.messages[1] && "content" in req.messages[1] ? req.messages[1].content : "");
    const id = c.match(/## (a_\S+_2)/)?.[1] ?? c.match(/## (a_\S+)/)![1];
    return respond("", call("select_winner", { attempt_id: id, reason: "Same fix, but it adds regression tests for negative and float inputs." }));
  }
  if (req.meta?.kind === "unblock") return respond("", call("send_guidance", { guidance: "Look at calc.py." }));

  if (req.role === "coder" && !second) {
    const steps = [
      () => respond("Let me look at the code first.", call("list_dir", {})),
      () => respond("", call("read_file", { path: "calc.py" })),
      () => respond("", call("report", { status: "progress", message: "Found it: add() uses the wrong operator." })),
      () => respond("Swapping the operator.", call("search_replace", { path: "calc.py", old_string: "return a - b", new_string: "return a * b" })),
      () => respond("", call("finish", { summary: "Fixed the operator in add()." })),
    ];
    return (steps[turn] ?? steps.at(-1)!)();
  }
  if (req.role === "coder" && second) {
    const steps = [
      () => respond("Writing a test that captures the bug first.", call("read_file", { path: "tests/test_visible.py" })),
      () =>
        respond(
          "",
          call("write_file", {
            path: "tests/test_add_edges.py",
            content:
              "import unittest\nfrom calc import add\n\n\nclass AddEdges(unittest.TestCase):\n    def test_negative(self):\n        self.assertEqual(add(-2, -3), -5)\n\n    def test_float(self):\n        self.assertAlmostEqual(add(0.1, 0.2), 0.3)\n",
          })
        ),
      () => respond("", call("run_command", { command: "python3 -m unittest discover -q" })),
      () => respond("", call("report", { status: "progress", message: "New tests fail as expected. Fixing add()." })),
      () => respond("", call("search_replace", { path: "calc.py", old_string: "return a - b", new_string: "return a + b" })),
      () => respond("", call("run_command", { command: "python3 -m unittest discover -q" })),
      () => respond("", call("finish", { summary: "Added edge-case tests, fixed add() to use +. All tests pass." })),
    ];
    return (steps[turn] ?? steps.at(-1)!)();
  }
  if (req.role === "qa") {
    const firstRound = req.meta?.agentRun === "qa-1";
    if (turn === 0) return respond("Checking the diff and running the tests myself.", call("view_diff", {}));
    if (turn === 1) return respond("", call("run_command", { command: "python3 -m unittest discover -q" }));
    if (!second && firstRound)
      return respond(
        "",
        call("submit_verdict", {
          pass: false,
          score: 2,
          tests_passed: false,
          problems: ["add() now multiplies: add(2, 3) returns 6 and test_add fails."],
          summary: "The change swaps - for *, which is still wrong.",
        })
      );
    return respond(
      "",
      call("submit_verdict", {
        pass: true,
        score: second ? 9 : 7,
        tests_passed: true,
        problems: [],
        summary: second ? "add() is correct and new tests cover negatives and floats." : "add() is now correct; tests pass.",
      })
    );
  }
  if (req.role === "debugger") {
    const steps = [
      () => respond("Reproducing the failure.", call("run_command", { command: "python3 -m unittest discover -q" })),
      () => respond("", call("read_file", { path: "calc.py" })),
      () => respond("Root cause: add() multiplies instead of adding.", call("search_replace", { path: "calc.py", old_string: "def add(a, b):\n    return a * b", new_string: "def add(a, b):\n    return a + b" })),
      () => respond("", call("run_command", { command: "python3 -m unittest discover -q" })),
      () => respond("", call("submit_diagnosis", { root_cause: "add() used * instead of +.", fix: "Changed the operator to +.", fixed: true })),
    ];
    return (steps[turn] ?? steps.at(-1)!)();
  }
  return respond("", call("finish", { summary: "noop" }));
}
