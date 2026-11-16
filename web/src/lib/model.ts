// Derive runs (jobs), log lines, trace spans and diff structure from the raw event log.
import type { Attempt, AttemptStatus, EventRow, Role, Task, TaskStatus } from "./api";
import { isLive } from "./api";

export type RunStatus = "queued" | "running" | "success" | "failure" | "cancelled" | "skipped";

export interface Run {
  key: string;
  attemptId: string | null;
  runId: string; // coder | qa-1 | debugger-1 | setup | plan | evaluate | pr
  role: Role;
  label: string;
  start: number;
  end: number | null; // null while running
  status: RunStatus;
  events: EventRow[];
}

export function taskRunStatus(s: TaskStatus, paused = false): RunStatus {
  if (s === "done") return "success";
  if (s === "failed") return "failure";
  if (s === "cancelled") return "cancelled";
  if (s === "queued") return "queued";
  // Paused tasks stay "running"; callers pass `paused` to the icon/label to show the paused state.
  void paused;
  return "running";
}

export function attemptRunStatus(s: AttemptStatus): RunStatus {
  if (s === "passed") return "success";
  if (s === "failed") return "failure";
  if (s === "cancelled") return "cancelled";
  if (s === "pending") return "queued";
  return "running";
}

const t = (e: EventRow) => new Date(e.ts).getTime();

function label(runId: string): string {
  if (runId === "coder") return "Code";
  const [kind, n] = runId.split("-");
  if (kind === "qa") return `QA review ${n}`;
  if (kind === "debugger") return `Debug round ${n}`;
  return runId;
}

/** Runs for one attempt, in order: setup, coder, qa-1, debugger-1, qa-2, ... */
export function attemptRuns(events: EventRow[], attempt: Attempt, taskStatus: TaskStatus): Run[] {
  const mine = events.filter((e) => e.attemptId === attempt.id);
  const live = isLive(taskStatus) && !["passed", "failed", "cancelled"].includes(attempt.status);
  const runs = new Map<string, Run>();

  // Setup: from the "setup" status change to the setup event.
  const setupStart = mine.find((e) => e.kind === "attempt.status" && e.data.status === "setup");
  const setupDone = mine.find((e) => e.kind === "setup" && e.data.phase === "attempt");
  if (setupStart)
    runs.set("setup", {
      key: `${attempt.id}:setup`,
      attemptId: attempt.id,
      runId: "setup",
      role: "orchestrator",
      label: "Set up environment",
      start: t(setupStart),
      end: setupDone ? t(setupDone) : live ? null : t(setupStart),
      status: setupDone ? "success" : live ? "running" : "cancelled",
      events: setupDone ? [setupDone] : [],
    });

  let lastQa: Run | null = null;
  for (const e of mine) {
    let runId: string | undefined = e.data?.runId;
    if (e.kind === "verdict") runId = `qa-${(e.data.round ?? 0) + 1}`;
    if (e.kind === "diagnosis") runId = `debugger-${e.data.round ?? 1}`;
    if (e.kind === "tool.result" && e.data?.name === "orchestrator_tests" && lastQa) runId = lastQa.runId;
    if (!runId) continue;
    let r = runs.get(runId);
    if (!r) {
      r = {
        key: `${attempt.id}:${runId}`,
        attemptId: attempt.id,
        runId,
        role: (runId.startsWith("qa") ? "qa" : runId.startsWith("debugger") ? "debugger" : "coder") as Role,
        label: label(runId),
        start: t(e),
        end: t(e),
        status: "running",
        events: [],
      };
      runs.set(runId, r);
    }
    r.events.push(e);
    r.end = t(e);
    if (r.role === "qa") lastQa = r;
  }

  const ordered = [...runs.values()].sort((a, b) => a.start - b.start);
  ordered.forEach((r, i) => {
    if (r.runId === "setup") return;
    const isLast = i === ordered.length - 1;
    const report = r.events.find((e) => e.kind === "report" && e.data.runId === r.runId && e.data.status !== "progress");
    const verdict = r.events.find((e) => e.kind === "verdict");
    const diag = r.events.find((e) => e.kind === "diagnosis");
    if (r.role === "qa" && verdict) r.status = verdict.data.pass ? "success" : "failure";
    else if (r.role === "debugger" && diag) r.status = diag.data.fixed ? "success" : "failure";
    else if (r.role === "coder" && report) r.status = report.data.status === "done" ? "success" : "failure";
    else if (live && isLast) {
      r.status = "running";
      r.end = null;
    } else r.status = attempt.status === "cancelled" ? "cancelled" : "failure";
  });
  return ordered;
}

/** Task-level steps owned by the orchestrator. */
export function taskRuns(events: EventRow[], task: Task): { plan: Run | null; evaluate: Run | null; pr: Run | null } {
  const top = events.filter((e) => !e.attemptId || e.kind === "evaluation" || e.kind === "pr");
  const first = (pred: (e: EventRow) => boolean) => top.find(pred);
  const planningAt = first((e) => e.kind === "task.status" && e.data.status === "planning");
  const planEv = first((e) => e.kind === "plan");
  const live = isLive(task.status);
  const plan: Run | null = planningAt
    ? {
        key: "plan",
        attemptId: null,
        runId: "plan",
        role: "orchestrator",
        label: "Plan attempts",
        start: t(planningAt),
        end: planEv ? t(planEv) : live ? null : t(planningAt),
        status: planEv ? "success" : live ? "running" : taskRunStatus(task.status),
        events: top.filter((e) => e.kind === "plan" || (e.kind === "setup" && e.data.phase !== "attempt")),
      }
    : null;
  const evalAt = first((e) => e.kind === "task.status" && e.data.status === "evaluating");
  const decision = first((e) => e.kind === "evaluation" && (e.data.decision === "winner" || e.data.decision === "no-winner"));
  const evaluate: Run | null = evalAt
    ? {
        key: "evaluate",
        attemptId: null,
        runId: "evaluate",
        role: "orchestrator",
        label: "Evaluate attempts",
        start: t(evalAt),
        end: decision ? t(decision) : live ? null : t(evalAt),
        status: decision ? (decision.data.decision === "winner" ? "success" : "failure") : live ? "running" : "cancelled",
        events: decision ? [decision] : [],
      }
    : null;
  const prEv = [...top].reverse().find((e) => e.kind === "pr");
  const pr: Run | null = prEv
    ? { key: "pr", attemptId: prEv.attemptId, runId: "pr", role: "orchestrator", label: "Open pull request", start: t(prEv), end: t(prEv), status: "success", events: [prEv] }
    : null;
  return { plan, evaluate, pr };
}

// ---------------- log lines ----------------
export type LogLine =
  | { id: number; ts: number; role: Role; kind: "say"; text: string }
  | { id: number; ts: number; role: Role; kind: "call"; name: string; args: any; output?: string; error?: boolean }
  | { id: number; ts: number; role: Role; kind: "check"; ok: boolean; output: string }
  | { id: number; ts: number; role: Role; kind: "report"; status: string; text: string }
  | { id: number; ts: number; role: Role; kind: "steer"; text: string }
  | { id: number; ts: number; role: Role; kind: "verdict"; data: any }
  | { id: number; ts: number; role: Role; kind: "diagnosis"; data: any }
  | { id: number; ts: number; role: Role; kind: "setup"; data: any }
  | { id: number; ts: number; role: Role; kind: "error"; text: string };

export function logLines(run: Run): LogLine[] {
  const out: LogLine[] = [];
  const calls = new Map<string, Extract<LogLine, { kind: "call" }>>();
  for (const e of run.events) {
    const base = { id: e.id, ts: t(e), role: e.role };
    const d = e.data ?? {};
    switch (e.kind) {
      case "llm.text":
        out.push({ ...base, kind: "say", text: d.text });
        break;
      case "tool.call": {
        if (d.name === "report") break; // shown as the report line instead
        const line = { ...base, kind: "call" as const, name: d.name, args: d.args };
        calls.set(d.id, line);
        out.push(line);
        break;
      }
      case "tool.result":
        if (d.name === "orchestrator_tests") out.push({ ...base, role: "orchestrator", kind: "check", ok: !d.error, output: d.output });
        else {
          const c = calls.get(d.id);
          if (c) Object.assign(c, { output: d.output, error: d.error });
        }
        break;
      case "report":
        out.push({ ...base, kind: "report", status: d.status, text: d.message });
        break;
      case "steer.delivered":
        out.push({ ...base, kind: "steer", text: d.text });
        break;
      case "verdict":
        out.push({ ...base, kind: "verdict", data: d });
        break;
      case "diagnosis":
        out.push({ ...base, kind: "diagnosis", data: d });
        break;
      case "setup":
        out.push({ ...base, kind: "setup", data: d });
        break;
      case "error":
        out.push({ ...base, kind: "error", text: d.message });
        break;
    }
  }
  return out;
}

export function lineText(l: LogLine): string {
  switch (l.kind) {
    case "say":
    case "report":
    case "steer":
    case "error":
      return l.text;
    case "call":
      return `${l.name} ${JSON.stringify(l.args)} ${l.output ?? ""}`;
    case "check":
      return `tests ${l.ok ? "passing" : "failing"} ${l.output}`;
    case "verdict":
      return `${l.data.summary} ${(l.data.problems ?? []).join(" ")}`;
    case "diagnosis":
      return `${l.data.root_cause} ${l.data.fix}`;
    case "setup":
      return "environment ready";
  }
}

// ---------------- diff ----------------
export interface DiffLine {
  type: "add" | "del" | "ctx" | "hunk";
  text: string;
  old?: number;
  new?: number;
}
export interface DiffFile {
  path: string;
  status: "added" | "deleted" | "modified";
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

export function parseDiff(diff: string | null): DiffFile[] {
  if (!diff) return [];
  const files: DiffFile[] = [];
  let f: DiffFile | null = null;
  let o = 0,
    n = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      const m = raw.match(/ b\/(.+)$/);
      f = { path: m ? m[1] : raw, status: "modified", additions: 0, deletions: 0, lines: [] };
      files.push(f);
      continue;
    }
    if (!f) continue;
    if (raw.startsWith("new file mode")) f.status = "added";
    else if (raw.startsWith("deleted file mode")) f.status = "deleted";
    else if (/^(index |--- |\+\+\+ |similarity|rename |old mode|new mode)/.test(raw)) continue;
    else if (raw.startsWith("@@")) {
      const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
      o = m ? Number(m[1]) : 0;
      n = m ? Number(m[2]) : 0;
      f.lines.push({ type: "hunk", text: raw });
    } else if (raw.startsWith("+")) {
      f.additions++;
      f.lines.push({ type: "add", text: raw.slice(1), new: n++ });
    } else if (raw.startsWith("-")) {
      f.deletions++;
      f.lines.push({ type: "del", text: raw.slice(1), old: o++ });
    } else if (raw.startsWith(" ") || (raw === "" && f.lines.length)) {
      if (raw === "" && !f.lines.length) continue;
      f.lines.push({ type: "ctx", text: raw.slice(1), old: o++, new: n++ });
    } else if (raw.startsWith("\\")) continue;
  }
  // Trailing empty context line produced by the final newline.
  for (const file of files) {
    const last = file.lines[file.lines.length - 1];
    if (last && last.type === "ctx" && last.text === "") file.lines.pop();
  }
  return files;
}

export const ROLE_LABEL: Record<string, string> = {
  orchestrator: "Orchestrator",
  coder: "Coder",
  qa: "QA",
  debugger: "Debugger",
  user: "You",
  system: "System",
};
