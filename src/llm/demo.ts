// Demo provider: a scripted model that plays a realistic run on the bundled demo repo
// (two parallel attempts, one wrong fix caught by QA and repaired by the debugger).
// It lets you try the UI with no API key. It is NOT a real model.
import { ScriptedProvider, call, respond } from "./scripted.ts";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function demoProvider(delayMs = 600) {
  return new ScriptedProvider(async (req, turn) => {
    await pause(delayMs);
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
      const id = String(req.messages[1].content).match(/## (a_\S+_2)/)?.[1] ?? String(req.messages[1].content).match(/## (a_\S+)/)![1];
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
  });
}
