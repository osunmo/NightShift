import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RoleMark, StatusIcon, StatusLabel } from "@/components/status";
import { fmtClock, fmtDuration } from "@/lib/format";
import { parseDiff, ROLE_LABEL, type Run } from "@/lib/model";
import { setQuery } from "@/lib/router";
import { cn } from "@/lib/utils";
import { runStatusOf, type TaskModel } from "./TaskPage";

interface Row {
  key: string;
  depth: 0 | 1;
  label: string;
  sub?: string;
  run?: Run;
  start: number;
  end: number | null;
  status: Run["status"];
  attemptId: string | null;
  runId?: string;
  shipped?: boolean;
}

/** Waterfall of every agent run across attempts, like a distributed trace. Click a span to open its logs. */
export function Trace({ model }: { model: TaskModel }) {
  const { top, attempts, runs, t0, task } = model;
  const [hover, setHover] = useState<string | null>(null);

  const rows = useMemo(() => {
    const out: Row[] = [];
    if (top.plan) out.push({ key: "plan", depth: 0, label: "Plan attempts", sub: "orchestrator", run: top.plan, start: top.plan.start, end: top.plan.end, status: top.plan.status, attemptId: null });
    for (const a of attempts) {
      const rs = runs[a.id] ?? [];
      if (!rs.length) continue;
      const end = rs.some((r) => r.end === null) ? null : Math.max(...rs.map((r) => r.end!));
      out.push({ key: a.id, depth: 0, label: `#${a.index} ${a.strategy.name}`, sub: `attempt ${a.index}`, start: rs[0].start, end, status: runStatusOf(a), attemptId: a.id, shipped: task.winnerAttemptId === a.id });
      for (const r of rs) out.push({ key: r.key, depth: 1, label: r.label, sub: ROLE_LABEL[r.role], run: r, start: r.start, end: r.end, status: r.status, attemptId: a.id, runId: r.runId });
    }
    if (top.evaluate) out.push({ key: "evaluate", depth: 0, label: "Evaluate attempts", sub: "orchestrator", run: top.evaluate, start: top.evaluate.start, end: top.evaluate.end, status: top.evaluate.status, attemptId: null });
    if (top.pr) out.push({ key: "pr", depth: 0, label: task.prUrl ? "Pull request opened" : "Pull request ready", sub: "orchestrator", start: top.pr.start, end: top.pr.end, status: "success", attemptId: top.pr.attemptId });
    return out;
  }, [top, attempts, runs, task]);

  const steers = model.events.filter((e) => e.kind === "steer");
  const tEnd = Math.max(t0 + 1000, ...rows.map((r) => r.end ?? Date.now()), model.live ? Date.now() : 0);
  const span = tEnd - t0;
  const step = niceStep(span);
  const ticks = Array.from({ length: Math.floor(span / step) + 1 }, (_, i) => i * step);
  const pct = (t: number) => `${((t - t0) / span) * 100}%`;
  const w = (s: number, e: number | null) => `max(2px, ${(((e ?? Date.now()) - s) / span) * 100}%)`;

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="border-b">
        <div className="grid h-8 grid-cols-[260px_minmax(0,1fr)_72px] items-center border-b px-3 text-[11px] font-medium text-muted-foreground">
          <span>Span</span>
          <div className="relative h-full">
            {ticks.map((t) => (
              <span key={t} className="tabular absolute top-1/2 -translate-x-1/2 -translate-y-1/2 font-mono font-normal" style={{ left: `${(t / span) * 100}%` }}>
                {fmtTick(t)}
              </span>
            ))}
          </div>
          <span className="text-right">Duration</span>
        </div>
        <div className="relative">
          {/* grid lines + steering markers */}
          <div className="pointer-events-none absolute inset-y-0 right-[84px] left-[272px]">
            {ticks.map((t) => (
              <div key={t} className="absolute inset-y-0 w-px bg-border/60" style={{ left: `${(t / span) * 100}%` }} />
            ))}
            {steers.map((s) => (
              <div key={s.id} className="absolute inset-y-0 w-px border-l border-dashed border-brand" style={{ left: pct(new Date(s.ts).getTime()) }} />
            ))}
          </div>
          {rows.map((r) => (
            <button
              key={r.key}
              onMouseEnter={() => setHover(r.key)}
              onMouseLeave={() => setHover(null)}
              onClick={() => r.attemptId && setQuery({ attempt: r.attemptId, run: r.runId ?? null, tab: r.key === "pr" ? "pr" : null })}
              className={cn(
                "grid h-8 w-full grid-cols-[260px_minmax(0,1fr)_72px] items-center px-3 text-left text-[13px]",
                hover === r.key && "bg-muted/60",
                r.depth === 0 && r.attemptId && "border-t"
              )}
            >
              <span className={cn("flex min-w-0 items-center gap-2", r.depth === 1 && "pl-6")}>
                {r.run ? <RoleMark role={r.run.role} /> : <StatusIcon status={r.status} paused={model.paused} className="size-3.5" />}
                <span className={cn("truncate", r.depth === 0 && "font-medium")}>{r.label}</span>
                {r.shipped && <Sparkles className="size-3 shrink-0 text-success" />}
                {r.depth === 1 && r.status !== "success" && <StatusIcon status={r.status} className="size-3 shrink-0" paused={model.paused} />}
              </span>
              <div className="relative h-full">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className={cn(
                        "absolute top-1/2 -translate-y-1/2 rounded-[3px]",
                        r.depth === 0 ? "h-1.5" : "h-3.5",
                        barTone(r),
                        r.status === "running" && r.depth === 1 && !model.paused && "bar-live"
                      )}
                      style={{ left: pct(r.start), width: w(r.start, r.end) }}
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    {r.label} · {r.sub} · starts {fmtClock(r.start - t0)} · {fmtDuration((r.end ?? Date.now()) - r.start)}
                  </TooltipContent>
                </Tooltip>
              </div>
              <span className="tabular text-right font-mono text-[11px] text-muted-foreground">{fmtDuration((r.end ?? Date.now()) - r.start)}</span>
            </button>
          ))}
          {!rows.length && <div className="px-3 py-8 text-center text-xs text-muted-foreground">No spans yet.</div>}
        </div>
        <div className="flex items-center gap-4 border-t px-3 py-2 text-[11px] text-muted-foreground">
          <Legend className="bg-success/70">passed</Legend>
          <Legend className="bg-danger/70">rejected or failed</Legend>
          <Legend className="bar-live bg-brand">running</Legend>
          {steers.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="h-3 border-l border-dashed border-brand" /> your message
            </span>
          )}
        </div>
      </div>
      <Comparison model={model} />
    </div>
  );
}

function barTone(r: Row) {
  if (r.depth === 0) return r.status === "success" ? "bg-success/40" : r.status === "failure" ? "bg-danger/40" : r.status === "running" ? "bg-brand/40" : "bg-foreground/20";
  return r.status === "success" ? "bg-success/70" : r.status === "failure" ? "bg-danger/70" : r.status === "running" ? "bg-brand" : "bg-foreground/25";
}

function Legend({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-2.5 w-4 rounded-[2px]", className)} /> {children}
    </span>
  );
}

function niceStep(ms: number) {
  const target = ms / 6;
  for (const s of [500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000]) if (s >= target) return s;
  return 900000;
}
function fmtTick(ms: number) {
  return ms < 60000 ? `${ms / 1000}s` : `${Math.floor(ms / 60000)}m${ms % 60000 ? ` ${(ms % 60000) / 1000}s` : ""}`;
}

function Comparison({ model }: { model: TaskModel }) {
  const { attempts, task, events } = model;
  if (!attempts.length) return null;
  return (
    <div className="p-3">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-[13px] font-medium">Attempts</h3>
        <span className="text-xs text-muted-foreground">The orchestrator ships the highest-scoring attempt that passed QA.</span>
      </div>
      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/50 text-[11px] text-muted-foreground">
            <tr className="[&>th]:h-8 [&>th]:px-3 [&>th]:text-left [&>th]:font-medium">
              <th>Attempt</th>
              <th>Status</th>
              <th className="!text-right">Score</th>
              <th className="!text-right">Fix rounds</th>
              <th>Tests</th>
              <th className="!text-right">Changes</th>
              <th className="!text-right">Setup</th>
            </tr>
          </thead>
          <tbody>
            {attempts.map((a) => {
              const files = parseDiff(a.diff);
              const add = files.reduce((n, f) => n + f.additions, 0);
              const del = files.reduce((n, f) => n + f.deletions, 0);
              const verdict = [...events].reverse().find((e) => e.kind === "verdict" && e.attemptId === a.id);
              const winner = task.winnerAttemptId === a.id;
              return (
                <tr key={a.id} onClick={() => setQuery({ attempt: a.id, tab: "diff", run: null })} className="cursor-pointer border-t hover:bg-muted/50 [&>td]:h-9 [&>td]:px-3">
                  <td>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">#{a.index}</span>
                      <span className="font-medium">{a.strategy.name}</span>
                      {winner && <span className="rounded-sm bg-success-soft px-1 text-[10px] font-medium text-success">shipped</span>}
                    </span>
                  </td>
                  <td>
                    <StatusLabel status={runStatusOf(a)} paused={model.paused} text={a.status === "passed" ? "Passed QA" : a.status === "failed" ? "Rejected" : undefined} />
                  </td>
                  <td className="tabular text-right font-mono">{a.score ?? "–"}</td>
                  <td className="tabular text-right font-mono">{a.fixRounds}</td>
                  <td className="text-xs">
                    {verdict ? (verdict.data.testsPassed === null ? <span className="text-muted-foreground">none</span> : verdict.data.testsPassed ? <span className="text-success">passing</span> : <span className="text-danger">failing</span>) : <span className="text-muted-foreground">–</span>}
                  </td>
                  <td className="tabular text-right font-mono text-xs">
                    {a.diff ? (
                      <>
                        <span className="text-success">+{add}</span> <span className="text-danger">−{del}</span> <span className="text-muted-foreground">· {files.length} file{files.length === 1 ? "" : "s"}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">–</span>
                    )}
                  </td>
                  <td className="tabular text-right font-mono text-xs text-muted-foreground">
                    {a.setupMs == null
                      ? "–"
                      : a.setupCached
                        ? `${fmtDuration(a.setupMs)} · cached`
                        : events.find((e) => e.kind === "setup" && e.attemptId === a.id)?.data.ran
                          ? fmtDuration(a.setupMs)
                          : "none needed"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
