// The facts the homepage tells its story with, all read from the recorded run
// (data/recorded-run.json, captured from `nightshift demo`). Nothing here is typed in by hand:
// if the recording changes, the page changes with it.
import type { EventRow } from "@/lib/api";
import { logLines, type LogLine } from "@/lib/model";
import { RECORDED, snapshot } from "./run";

const run = RECORDED;
const ev = run.events;
const at = (e: EventRow | undefined) => (e ? new Date(e.ts).getTime() - run.t0 : 0);
const find = (pred: (e: EventRow) => boolean) => ev.find(pred);
const all = (pred: (e: EventRow) => boolean) => ev.filter(pred);

const [a1, a2] = run.attempts;
const byId = (id: string | null | undefined) => run.attempts.find((a) => a.id === id);

const final = snapshot(run, run.duration);
const runsOf = (attemptId: string) => final.runs[attemptId] ?? [];
const linesOf = (attemptId: string, runId: string): LogLine[] => {
  const r = runsOf(attemptId).find((x) => x.runId === runId);
  return r ? logLines(r) : [];
};

const setupCfg = find((e) => e.kind === "setup" && e.data.phase === "config");
const plan = find((e) => e.kind === "plan");
const steer = find((e) => e.kind === "steer");
const winnerEval = find((e) => e.kind === "evaluation" && e.data.decision === "winner");
const pr = find((e) => e.kind === "pr");
const diagnosis = find((e) => e.kind === "diagnosis");
const verdicts = all((e) => e.kind === "verdict").map((e) => ({
  attempt: byId(e.attemptId)!,
  at: at(e),
  pass: !!e.data.pass,
  score: e.data.score as number,
  testsPassed: !!e.data.testsPassed,
  problems: (e.data.problems ?? []) as string[],
  summary: e.data.summary as string,
}));
/** The diff attempt 1 first submitted (before the debugger repaired it), as QA saw it. */
const firstQaDiff = find((e) => e.kind === "tool.result" && e.attemptId === a1.id && e.data.name === "view_diff");

export const STORY = {
  run,
  prompt: run.task.prompt,
  repo: run.task.repo.split("/").pop() ?? run.task.repo,
  attempts: run.attempts,
  a1,
  a2,
  winner: byId(run.task.winnerAttemptId)!,
  duration: run.duration,
  recordedWith: (RECORDED as unknown as { recordedWith?: string }).recordedWith,
  setup: {
    test: setupCfg?.data.config?.test as string,
    install: (setupCfg?.data.config?.setup as string | null) ?? null,
    source: setupCfg?.data.config?.source as string,
  },
  plan: (plan?.data.strategies ?? []) as { name: string; instructions: string }[],
  steer: {
    text: steer?.data.text as string,
    at: at(steer),
    deliveries: all((e) => e.kind === "steer.delivered").map((e) => ({ runId: e.data.runId as string, attempt: byId(e.attemptId)!, at: at(e) })),
  },
  verdicts,
  rejected: verdicts.find((v) => !v.pass)!,
  wrongDiff: (firstQaDiff?.data.output as string) ?? "",
  wrongDiffAt: at(firstQaDiff),
  diagnosis: {
    rootCause: diagnosis?.data.root_cause as string,
    fix: diagnosis?.data.fix as string,
    at: at(diagnosis),
  },
  winnerReason: winnerEval?.data.reason as string,
  evaluations: all((e) => e.kind === "evaluation").map((e) => ({
    attempt: byId(e.attemptId ?? e.data.attemptId)!,
    decision: e.data.decision as string,
    reason: e.data.reason as string,
    at: at(e),
  })),
  pr: { title: pr?.data.title as string, body: (pr?.data.body as string) ?? "", dryRun: !!pr?.data.dryRun, at: at(pr) },
  lines: {
    coder1: linesOf(a1.id, "coder"),
    coder2: linesOf(a2.id, "coder"),
    qa1: linesOf(a1.id, "qa-1"),
    qa1b: linesOf(a1.id, "qa-2"),
    qa2: linesOf(a2.id, "qa-1"),
    debugger: linesOf(a1.id, "debugger-1"),
  },
  runsOf,
};
