// Product panels: small, faithful pieces of the Nightshift run view, rendered from real run data.
// The hero, feature plates, role showcase and workflow all compose these, so the page has one
// visual vocabulary and every pixel of "product" on it traces back to an event in the recording.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { argSummary, fmtClock } from "@/lib/format";
import { parseDiff, type LogLine, type RunStatus } from "@/lib/model";
import { STORY } from "../lib/story";

export function Frame({ name, meta, children, className, bodyClass }: { name?: ReactNode; meta?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <div className={cn("panel overflow-hidden", className)}>
      {name != null && (
        <div className="flex h-8 items-center gap-2 border-b border-line px-3">
          <span className="size-1.5 rounded-full bg-line-2" aria-hidden />
          <span className="truncate font-mono text-[10.5px] text-mute">{name}</span>
          {meta != null && <span className="ml-auto shrink-0 font-mono text-[10.5px] text-dim tabular">{meta}</span>}
        </div>
      )}
      <div className={cn("p-3", bodyClass)}>{children}</div>
    </div>
  );
}

/** The mono caption that floats above a panel in the hero, like a file name over a clip. */
export function Caption({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 font-mono text-[10.5px] text-dim">{children}</div>;
}

export function Glyph({ status, className }: { status: RunStatus; className?: string }) {
  const c = cn("size-3 shrink-0", className);
  if (status === "success")
    return (
      <svg viewBox="0 0 16 16" className={cn(c, "text-ok")} aria-label="passed" role="img">
        <circle cx="8" cy="8" r="7" fill="currentColor" />
        <path d="M5 8.25 7 10.25 11 6" fill="none" stroke="var(--bg)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (status === "failure")
    return (
      <svg viewBox="0 0 16 16" className={cn(c, "text-bad")} aria-label="rejected" role="img">
        <circle cx="8" cy="8" r="7" fill="currentColor" />
        <path d="M5.75 5.75 10.25 10.25M10.25 5.75 5.75 10.25" stroke="var(--bg)" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  if (status === "running")
    return (
      <svg viewBox="0 0 16 16" className={cn(c, "text-fg")} aria-label="running" role="img">
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.2" />
        <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="0.9s" repeatCount="indefinite" />
        </path>
      </svg>
    );
  return (
    <svg viewBox="0 0 16 16" className={cn(c, "text-dim")} aria-label="waiting" role="img">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.5 2.5" />
    </svg>
  );
}

export function LineBody({ l }: { l: LogLine }) {
  switch (l.kind) {
    case "say":
      return <span className="truncate text-mute">{l.text}</span>;
    case "call": {
      const code = l.output?.match(/^exit_code: (\d+)/)?.[1];
      return (
        <span className="truncate">
          <span className="text-fg">{l.name}</span> <span className="text-dim">{l.name === "run_command" ? `$ ${l.args?.command}` : argSummary(l.name, l.args)}</span>
          {code !== undefined && <span className={cn("ml-2 rounded-[3px] px-1 text-[10px]", code === "0" ? "bg-ok/15 text-ok" : "bg-bad/15 text-bad")}>exit {code}</span>}
        </span>
      );
    }
    case "check":
      return <span className={l.ok ? "text-ok" : "text-bad"}>orchestrator re-ran tests: {l.ok ? "passing" : "failing"}</span>;
    case "verdict":
      return (
        <span className={cn("truncate", l.data.pass ? "text-ok" : "text-bad")}>
          QA {l.data.pass ? "approved" : "rejected"} {l.data.score}/10 · {l.data.pass ? l.data.summary : l.data.problems?.[0]}
        </span>
      );
    case "diagnosis":
      return <span className="truncate text-fg">root cause: {l.data.root_cause}</span>;
    case "report":
      return <span className="truncate text-mute">→ orchestrator: {l.text}</span>;
    case "steer":
      return <span className="truncate text-accent">read your message: “{l.text}”</span>;
    default:
      return <span className="truncate text-dim">{l.kind}</span>;
  }
}

/** Log lines with run-relative timestamps. `count` reveals the first n lines (for scripted reveals). */
export function LogList({ lines, count, caret, className }: { lines: LogLine[]; count?: number; caret?: boolean; className?: string }) {
  const shown = count == null ? lines : lines.slice(0, count);
  return (
    <div className={cn("t-code min-w-0", className)}>
      {shown.map((l) => (
        <div key={`${l.id}-${l.kind}`} className="flex min-w-0 gap-3">
          <span className="shrink-0 text-dim tabular">{fmtClock(l.ts - STORY.run.t0)}</span>
          <LineBody l={l} />
        </div>
      ))}
      {caret && <span className="caret mt-1 inline-block h-3 w-1.5 bg-accent align-middle" aria-hidden />}
    </div>
  );
}

export function DiffBlock({ diff, className, max = 12 }: { diff: string; className?: string; max?: number }) {
  const files = parseDiff(diff);
  return (
    <div className={cn("t-code overflow-x-auto", className)}>
      {files.map((f) => (
        <div key={f.path} className="mb-2 last:mb-0">
          <div className="mb-1 flex items-center gap-2 text-fg-2">
            {f.path}
            <span className="text-ok">+{f.additions}</span>
            <span className="text-bad">−{f.deletions}</span>
          </div>
          {f.lines
            .filter((l) => l.type !== "hunk")
            .slice(0, max)
            .map((l, i) => (
              <div key={i} className={cn("flex gap-3 rounded-[2px] px-1", l.type === "add" && "bg-ok/10 text-ok", l.type === "del" && "bg-bad/10 text-bad", l.type === "ctx" && "text-mute")}>
                <span className="w-3 shrink-0 select-none opacity-70">{l.type === "add" ? "+" : l.type === "del" ? "−" : ""}</span>
                <span className="whitespace-pre">{l.text || " "}</span>
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

export function VerdictBlock({ v, className }: { v: (typeof STORY.verdicts)[number]; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center gap-2">
        <Glyph status={v.pass ? "success" : "failure"} />
        <span className="text-[13px] text-fg">{v.pass ? "Approved" : "Rejected"}</span>
        <span className="ml-auto font-mono text-[11px] text-mute tabular">{v.score}/10</span>
      </div>
      <p className="text-[12.5px] leading-snug text-fg-2">{v.pass ? v.summary : v.problems[0]}</p>
      <div className={cn("font-mono text-[10.5px]", v.testsPassed ? "text-ok" : "text-bad")}>tests {v.testsPassed ? "passing" : "failing"} · re-run by orchestrator</div>
    </div>
  );
}

export function DiagnosisBlock({ className }: { className?: string }) {
  const d = STORY.diagnosis;
  return (
    <div className={cn("flex flex-col gap-1.5 text-[12.5px] leading-snug", className)}>
      <div>
        <span className="t-label mr-2">root cause</span>
        <span className="text-fg">{d.rootCause}</span>
      </div>
      <div>
        <span className="t-label mr-2">fix</span>
        <span className="text-fg-2">{d.fix}</span>
      </div>
    </div>
  );
}

export function SteerBlock({ className, typed }: { className?: string; typed?: string }) {
  const s = STORY.steer;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center gap-2">
        <span className="grid size-5 place-items-center rounded-full bg-fg font-mono text-[9px] text-on-fg">you</span>
        <span className="font-mono text-[10.5px] text-dim">to all attempts · {fmtClock(s.at)}</span>
      </div>
      <p className="text-[13px] leading-snug text-fg">
        {typed ?? s.text}
        {typed != null && typed.length < s.text.length && <span className="caret ml-0.5 inline-block h-3.5 w-[2px] bg-accent align-middle" aria-hidden />}
      </p>
    </div>
  );
}

export function Deliveries({ className, count }: { className?: string; count?: number }) {
  const d = count == null ? STORY.steer.deliveries : STORY.steer.deliveries.slice(0, count);
  return (
    <div className={cn("flex flex-col gap-1 font-mono text-[10.5px]", className)}>
      {d.map((x) => (
        <div key={x.runId + x.attempt.id} className="flex items-center gap-2 text-mute">
          <span className="text-accent">↳</span> read by {x.runId.replace(/-\d+$/, "")} on #{x.attempt.index} {x.attempt.strategy.name}
          <span className="ml-auto text-dim tabular">{fmtClock(x.at)}</span>
        </div>
      ))}
    </div>
  );
}

export function PRBlock({ className }: { className?: string }) {
  const w = STORY.winner;
  const v = STORY.verdicts.find((x) => x.attempt.id === w.id && x.pass);
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-start gap-2">
        <svg viewBox="0 0 16 16" className="mt-0.5 size-3.5 shrink-0 text-ok" aria-hidden>
          <path d="M5 3.5v9M5 3.5a1.5 1.5 0 1 0 0-.01M11 12.5a1.5 1.5 0 1 0 0 .01M11 11V7a2 2 0 0 0-2-2H7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <span className="text-[13px] leading-snug text-fg">{STORY.pr.title.replace(/^Nightshift: /, "")}</span>
      </div>
      <div className="font-mono text-[10.5px] text-mute">{w.branch}</div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10.5px] text-dim">
        <span>#{w.index} {w.strategy.name}</span>
        <span className="text-ok">QA {v?.score}/10</span>
        <span className="text-ok">tests passing</span>
        <span>{STORY.attempts.length} attempts compared</span>
      </div>
    </div>
  );
}

export function PlanBlock({ className, count }: { className?: string; count?: number }) {
  const p = count == null ? STORY.plan : STORY.plan.slice(0, count);
  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      {p.map((s, i) => (
        <div key={s.name} className="flex gap-3">
          <span className="font-mono text-[11px] text-dim">#{i + 1}</span>
          <div className="min-w-0">
            <div className="font-mono text-[12px] text-fg">{s.name}</div>
            <div className="text-[12.5px] leading-snug text-mute">{s.instructions}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Attempt lanes: the trace waterfall from the app, reduced to bars. `ms` is the playhead; bars grow up
 * to it. Coder, QA and debugger runs are shaded differently so the review loop reads at a glance.
 */
export function Lanes({ ms, className, labels = true }: { ms: number; className?: string; labels?: boolean }) {
  const span = STORY.duration;
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {STORY.attempts.map((a) => {
        const runs = STORY.runsOf(a.id).filter((r) => r.runId !== "setup");
        return (
          <div key={a.id} className="flex items-center gap-3">
            {labels && <span className="w-[92px] shrink-0 truncate font-mono text-[10.5px] text-mute">#{a.index} {a.strategy.name}</span>}
            <div className="relative h-5 flex-1">
              <div className="absolute inset-x-0 top-1/2 h-px bg-line" />
              {runs.map((r) => {
                const start = r.start - STORY.run.t0;
                if (start > ms) return null;
                const end = Math.min((r.end ?? r.start) - STORY.run.t0, ms);
                const live = ms < (r.end ?? r.start) - STORY.run.t0;
                const tone = r.role === "qa" ? (r.status === "failure" && !live ? "bg-bad/80" : "bg-fg-2") : r.role === "debugger" ? "bg-accent" : "bg-mute";
                return (
                  <div
                    key={r.key}
                    title={r.label}
                    className={cn("absolute top-1 h-3 rounded-[2px]", tone)}
                    style={{ left: `${(start / span) * 100}%`, width: `max(3px, ${((end - start) / span) * 100}%)` }}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
      {labels && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-dim sm:pl-[104px]">
          <Key tone="bg-mute">coder</Key>
          <Key tone="bg-fg-2">QA</Key>
          <Key tone="bg-accent">debugger</Key>
          <Key tone="bg-bad/80">rejected</Key>
        </div>
      )}
    </div>
  );
}

function Key({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-2 w-3 rounded-[2px]", tone)} />
      {children}
    </span>
  );
}
