// Run views built on the application's own derivations (attemptRuns, taskRuns, logLines in
// web/src/lib/model.ts): what you see here is what the app's run view shows for the same events.
import { cn } from "@/lib/utils";
import { fmtClock, fmtDuration } from "@/lib/format";
import { ROLE_LABEL, type Run } from "@/lib/model";
import { activeRun, useSnapshot, type RunData } from "../lib/run";
import { Frame, Glyph, LineBody } from "./panels";

/** Hero centerpiece: the task, both attempts as lanes, and the live log of whichever agent is busy. */
export function HeroRun({ run, ms, className }: { run: RunData; ms: number; className?: string }) {
  const snap = useSnapshot(run, ms);
  const now = run.t0 + ms;
  const { run: active, lines } = activeRun(snap, now, 5);
  const done = ms >= run.duration;
  return (
    <Frame name={`${run.task.repo.split("/").pop()} · task ${run.task.id.replace(/^t_/, "")}`} meta={fmtClock(ms)} bodyClass="p-0">
      <div className="border-b border-line px-4 py-3 text-[13.5px] leading-snug text-fg">{run.task.prompt}</div>
      <div className="flex flex-col gap-1.5 border-b border-line px-4 py-3">
        {snap.attempts.map((a) => (
          <div key={a.id} className="flex items-center gap-2 text-[12px]">
            <Glyph status={a.status === "passed" ? "success" : a.status === "failed" ? "failure" : "running"} />
            <span className="font-mono text-fg-2">
              #{a.index} {a.strategy.name}
            </span>
            <span className="ml-auto font-mono text-[10.5px] text-dim">{a.status === "passed" ? (done && a.id === run.task.winnerAttemptId ? "shipped" : "passed") : a.status}</span>
          </div>
        ))}
        {!snap.attempts.length && <div className="font-mono text-[11px] text-dim">planning attempts…</div>}
      </div>
      <div className="h-[132px] overflow-hidden px-4 py-2.5">
        <div className="mb-1 flex items-center gap-2 font-mono text-[10.5px] text-dim">
          {active ? (
            <>
              <span className="text-mute">{ROLE_LABEL[active.role]}</span> · attempt {snap.attempts.find((a) => a.id === active.attemptId)?.index}
            </>
          ) : (
            "orchestrator"
          )}
        </div>
        <div className="t-code">
          {done ? (
            <div className="text-ok">pull request ready · {run.attempts.find((a) => a.id === run.task.winnerAttemptId)?.branch}</div>
          ) : (
            lines.map((l) => (
              <div key={`${l.id}-${l.kind}`} className="flex min-w-0 gap-3">
                <span className="shrink-0 text-dim tabular">{fmtClock(l.ts - run.t0)}</span>
                <LineBody l={l} />
              </div>
            ))
          )}
        </div>
      </div>
    </Frame>
  );
}

/** The full replay: jobs, active log, and a trace timeline, as in the app's run view. */
export function ReplayWindow({ run, ms, className }: { run: RunData; ms: number; className?: string }) {
  const snap = useSnapshot(run, ms);
  const now = run.t0 + ms;
  const live = ms < run.duration;
  const { run: active, lines } = activeRun(snap, now, 9);
  const span = run.duration;
  const steers = snap.events.filter((e) => e.kind === "steer");

  return (
    <div className={cn("panel overflow-hidden text-[12px]", className)}>
      <div className="flex h-10 items-center gap-2 border-b border-line px-4">
        <span className="font-mono text-[11px] text-dim">tasks /</span>
        <span className="font-mono text-[11px] text-mute">{run.task.id.replace(/^t_/, "")}</span>
        <span className={cn("ml-2 rounded-[3px] px-1.5 py-0.5 font-mono text-[10px] uppercase", live ? "bg-fg/10 text-fg" : "bg-ok/15 text-ok")}>{live ? snap.task.status : "completed"}</span>
        <span className="ml-auto font-mono text-[11px] text-dim tabular">{fmtClock(ms)}</span>
      </div>
      <div className="border-b border-line px-4 py-3 text-[13.5px] text-fg">{run.task.prompt}</div>

      <div className="grid md:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
        <div className="border-line py-2 max-md:hidden md:border-r" aria-label="Jobs">
          <Job status={snap.top.plan?.status ?? "queued"} label="Plan attempts" dur={snap.top.plan ? (snap.top.plan.end ?? now) - snap.top.plan.start : null} />
          {snap.attempts.map((a) => (
            <div key={a.id} className="mt-1">
              <Job status={a.status === "passed" ? "success" : a.status === "failed" ? "failure" : "running"} label={`#${a.index} ${a.strategy.name}`} strong winner={!live && a.id === run.task.winnerAttemptId} />
              {(snap.runs[a.id] ?? [])
                .filter((r) => r.runId !== "setup")
                .map((r) => (
                  <Job key={r.key} status={r.status} label={r.label} dur={(r.end ?? now) - r.start} child active={active?.key === r.key && live} />
                ))}
            </div>
          ))}
          {snap.top.evaluate && <Job status={snap.top.evaluate.status} label="Evaluate attempts" />}
          {snap.top.pr && <Job status="success" label="Pull request ready" />}
        </div>

        <div className="flex min-h-[264px] flex-col">
          <div className="flex h-8 items-center gap-2 border-b border-line px-4 text-[11px] text-mute">
            {active ? (
              <>
                <Glyph status={active.status} />
                <span className="text-fg">{active.label}</span>
                <span className="truncate">
                  · {ROLE_LABEL[active.role]} agent · attempt {snap.attempts.find((a) => a.id === active.attemptId)?.index}
                </span>
              </>
            ) : (
              <span>Planning…</span>
            )}
          </div>
          <div className="t-code flex-1 overflow-hidden px-4 py-2" aria-live="off">
            {lines.map((l) => (
              <div key={`${active?.key}-${l.id}-${l.kind}`} className="flex min-w-0 gap-3">
                <span className="shrink-0 text-dim tabular">{fmtClock(l.ts - run.t0)}</span>
                <LineBody l={l} />
              </div>
            ))}
            {live && <span className="caret mt-1 inline-block h-3 w-1.5 bg-accent align-middle" aria-hidden />}
          </div>
        </div>
      </div>

      <div className="border-t border-line px-4 py-3">
        <div className="relative flex flex-col gap-1.5">
          {snap.attempts.map((a) => (
            <div key={a.id} className="flex items-center gap-3">
              <span className="w-24 shrink-0 truncate font-mono text-[10px] text-dim">
                #{a.index} {a.strategy.name}
              </span>
              <div className="relative h-2 flex-1">
                {(snap.runs[a.id] ?? [])
                  .filter((r) => r.runId !== "setup")
                  .map((r) => (
                    <div
                      key={r.key}
                      className={cn("absolute top-0 h-2 rounded-[2px]", r.status === "success" ? "bg-ok/70" : r.status === "failure" ? "bg-bad/70" : "bg-fg")}
                      style={{ left: `${((r.start - run.t0) / span) * 100}%`, width: `max(2px, ${(((r.end ?? now) - r.start) / span) * 100}%)` }}
                    />
                  ))}
              </div>
            </div>
          ))}
          {steers.map((s) => (
            <div
              key={s.id}
              className="pointer-events-none absolute -top-1 -bottom-1 border-l border-dashed border-accent"
              style={{ left: `calc(108px + (100% - 108px) * ${(new Date(s.ts).getTime() - run.t0) / span})` }}
              aria-hidden
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Job({ status, label, dur, child, strong, active, winner }: { status: Run["status"]; label: string; dur?: number | null; child?: boolean; strong?: boolean; active?: boolean; winner?: boolean }) {
  return (
    <div className={cn("flex h-7 items-center gap-2 px-4", child && "pl-8 text-mute", active && "bg-fg/[0.06] text-fg")}>
      <Glyph status={status} />
      <span className={cn("truncate", strong && "font-medium text-fg")}>{label}</span>
      {winner && <span className="rounded-[3px] bg-ok/15 px-1 font-mono text-[9px] text-ok uppercase">shipped</span>}
      {dur != null && <span className="ml-auto font-mono text-[10.5px] text-dim tabular">{fmtDuration(dur)}</span>}
    </div>
  );
}
