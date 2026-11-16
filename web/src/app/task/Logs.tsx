import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, CornerDownRight, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RoleMark, StatusIcon } from "@/components/status";
import type { Attempt } from "@/lib/api";
import { argSummary, fmtClock, fmtDuration } from "@/lib/format";
import { lineText, logLines, ROLE_LABEL, type LogLine, type Run } from "@/lib/model";
import { cn } from "@/lib/utils";
import type { TaskModel } from "./TaskPage";

export function Logs({ model, attempt, focusRun }: { model: TaskModel; attempt: Attempt | null; focusRun: string | null }) {
  const runs = attempt ? model.runs[attempt.id] ?? [] : [];
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [follow, setFollow] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const needle = q.trim().toLowerCase();

  const groups = useMemo(
    () =>
      runs.map((r) => {
        const lines = logLines(r);
        const shown = needle ? lines.filter((l) => lineText(l).toLowerCase().includes(needle)) : lines;
        return { run: r, lines, shown };
      }),
    [runs, needle]
  );
  const matches = needle ? groups.reduce((n, g) => n + g.shown.length, 0) : 0;
  const totalLines = groups.reduce((n, g) => n + g.lines.length, 0);

  // Jump to the run picked in the jobs list.
  useEffect(() => {
    if (!focusRun) return;
    setCollapsed((c) => {
      const n = new Set(c);
      n.delete(focusRun);
      return n;
    });
    requestAnimationFrame(() => document.getElementById(`run-${focusRun}`)?.scrollIntoView({ block: "start" }));
    setFollow(false);
  }, [focusRun, attempt?.id]);

  // Follow new output while live.
  useEffect(() => {
    if (follow && model.live && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [totalLines, follow, model.live]);

  if (!attempt)
    return <Empty title="No attempt selected" body="The orchestrator is still planning. Attempts appear here as soon as they start." />;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <span className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">#{attempt.index} {attempt.strategy.name}</span> · <span className="font-mono">{attempt.branch}</span>
        </span>
        <div className="ml-auto flex items-center gap-1">
          {needle && <span className="tabular mr-1 text-xs text-muted-foreground">{matches} match{matches === 1 ? "" : "es"}</span>}
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search logs" className="h-7 w-52 pr-7 pl-7 text-xs" />
            {q && (
              <button onClick={() => setQ("")} className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search">
                <X className="size-3" />
              </button>
            )}
          </div>
          <IconBtn label={collapsed.size ? "Expand all" : "Collapse all"} onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(runs.map((r) => r.runId)))}>
            {collapsed.size ? <ChevronsUpDown /> : <ChevronsDownUp />}
          </IconBtn>
          {model.live && (
            <IconBtn label={follow ? "Following output" : "Follow output"} onClick={() => setFollow((f) => !f)} active={follow}>
              <ArrowDownToLine />
            </IconBtn>
          )}
        </div>
      </div>

      <div
        ref={scroller}
        onWheel={() => model.live && scroller.current && scroller.current.scrollTop + scroller.current.clientHeight < scroller.current.scrollHeight - 40 && setFollow(false)}
        className="min-h-0 flex-1 overflow-y-auto font-mono text-xs scrollbar-thin"
      >
        {groups.map(({ run, shown }) => {
          if (needle && !shown.length) return null;
          const open = !collapsed.has(run.runId) || !!needle;
          return (
            <section key={run.key} id={`run-${run.runId}`} className="border-b">
              <button
                onClick={() =>
                  setCollapsed((c) => {
                    const n = new Set(c);
                    n.has(run.runId) ? n.delete(run.runId) : n.add(run.runId);
                    return n;
                  })
                }
                className={cn(
                  "sticky top-0 z-10 flex h-9 w-full items-center gap-2 bg-background px-3 text-left font-sans text-[13px] hover:bg-muted/60",
                  open && "border-b border-border/60"
                )}
              >
                {open ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
                <StatusIcon status={run.status} paused={model.paused} />
                <span className="font-medium">{run.label}</span>
                <span className="text-xs text-muted-foreground">{ROLE_LABEL[run.role]} agent</span>
                <span className="tabular ml-auto font-mono text-[11px] text-muted-foreground">{fmtDuration((run.end ?? Date.now()) - run.start)}</span>
              </button>
              {open && (
                <div className="py-1">
                  {shown.map((l, i) => (
                    <Line key={l.id + l.kind} n={i + 1} l={l} t0={model.t0} needle={needle} />
                  ))}
                  {!shown.length && <div className="px-3 py-1 pl-[100px] text-muted-foreground">{run.status === "running" ? "Starting…" : "No output"}</div>}
                  {run.status === "running" && shown.length > 0 && (
                    <div className="flex items-center gap-2 py-1 pl-[100px] text-muted-foreground">
                      <span className="size-1.5 animate-ns-pulse rounded-full bg-brand" /> {model.paused ? "Paused before the next step" : "Working"}
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
        {!runs.length && <Empty title="Waiting to start" body="This attempt has not produced any output yet." />}
      </div>
    </div>
  );
}

function Line({ l, n, t0, needle }: { l: LogLine; n: number; t0: number; needle: string }) {
  const [open, setOpen] = useState(false);
  const hasOutput = (l.kind === "call" && !!l.output) || l.kind === "check";
  const body = render(l, needle);
  const tone =
    l.kind === "error" || (l.kind === "call" && l.error) || (l.kind === "check" && !l.ok)
      ? "text-danger"
      : l.kind === "steer"
        ? "bg-brand-soft/60"
        : "";
  return (
    <Fragment>
      <div
        onClick={() => hasOutput && setOpen((o) => !o)}
        className={cn("group grid grid-cols-[32px_56px_minmax(0,1fr)] items-start gap-2 px-3 py-[3px] leading-5 hover:bg-muted/50", hasOutput && "cursor-pointer", tone)}
      >
        <span className="tabular text-right text-muted-foreground/60 select-none">{n}</span>
        <span className="tabular text-muted-foreground select-none">{fmtClock(l.ts - t0)}</span>
        <div className="flex min-w-0 items-start gap-1.5">
          {hasOutput && (open ? <ChevronDown className="mt-[3px] size-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-[3px] size-3 shrink-0 text-muted-foreground" />)}
          <div className="min-w-0 flex-1 break-words whitespace-pre-wrap">{body}</div>
        </div>
      </div>
      {open && hasOutput && (
        <pre className="mx-3 my-1 ml-[108px] max-h-80 overflow-auto rounded-md border bg-code px-3 py-2 leading-5 whitespace-pre-wrap text-foreground/90 scrollbar-thin">
          {hl(l.kind === "call" ? l.output ?? "" : l.kind === "check" ? l.output : "", needle)}
        </pre>
      )}
    </Fragment>
  );
}

function exitCode(out?: string) {
  const m = out?.match(/^exit_code: (\d+)/);
  return m ? Number(m[1]) : null;
}

function render(l: LogLine, needle: string): React.ReactNode {
  switch (l.kind) {
    case "say":
      return <span className="text-muted-foreground">{hl(l.text, needle)}</span>;
    case "call": {
      const code = l.name === "run_command" ? exitCode(l.output) : null;
      return (
        <span>
          <span className="font-medium">{l.name}</span> <span className="text-muted-foreground">{hl(l.name === "run_command" ? `$ ${l.args?.command}` : argSummary(l.name, l.args), needle)}</span>
          {code !== null && <span className={cn("ml-2 rounded-sm px-1 text-[10px]", code === 0 ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>exit {code}</span>}
          {l.error && code === null && <span className="ml-2 rounded-sm bg-danger-soft px-1 text-[10px] text-danger">error</span>}
          {l.output === undefined && <span className="ml-2 text-muted-foreground/60">…</span>}
        </span>
      );
    }
    case "check":
      return (
        <span className={l.ok ? "text-success" : "text-danger"}>
          Orchestrator re-ran the test suite: {l.ok ? "passing" : "failing"}
        </span>
      );
    case "report":
      return (
        <span className="inline-flex items-start gap-1.5">
          <CornerDownRight className="mt-[3px] size-3 shrink-0 text-muted-foreground" />
          <span>
            <span className="text-muted-foreground">to orchestrator ({l.status}):</span> {hl(l.text, needle)}
          </span>
        </span>
      );
    case "steer":
      return (
        <span className="inline-flex items-center gap-1.5">
          <RoleMark role="user" /> <span className="text-brand">Received your message:</span> {hl(l.text, needle)}
        </span>
      );
    case "verdict":
      return (
        <div className={cn("my-1 rounded-md border px-3 py-2 font-sans text-[13px]", l.data.pass ? "border-success/30 bg-success-soft/50" : "border-danger/30 bg-danger-soft/50")}>
          <div className="flex items-center gap-2">
            <StatusIcon status={l.data.pass ? "success" : "failure"} className="size-3.5" />
            <span className="font-medium">QA verdict: {l.data.pass ? "approved" : "changes needed"}</span>
            <span className="text-xs text-muted-foreground">
              score {l.data.score}/10 · tests {l.data.testsPassed === null ? "n/a" : l.data.testsPassed ? "passing" : "failing"}
            </span>
          </div>
          {l.data.summary && <p className="mt-1 text-muted-foreground">{hl(l.data.summary, needle)}</p>}
          {l.data.problems?.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {l.data.problems.map((p: string, i: number) => (
                <li key={i}>{hl(p, needle)}</li>
              ))}
            </ul>
          )}
        </div>
      );
    case "diagnosis":
      return (
        <div className="my-1 rounded-md border px-3 py-2 font-sans text-[13px]">
          <div className="flex items-center gap-2">
            <StatusIcon status={l.data.fixed ? "success" : "failure"} className="size-3.5" />
            <span className="font-medium">Diagnosis {l.data.fixed ? "and fix" : "(not fixed)"}</span>
          </div>
          <p className="mt-1">
            <span className="text-muted-foreground">Root cause: </span>
            {hl(l.data.root_cause, needle)}
          </p>
          <p>
            <span className="text-muted-foreground">Fix: </span>
            {hl(l.data.fix, needle)}
          </p>
        </div>
      );
    case "setup":
      return (
        <span className="text-muted-foreground">
          Environment ready in {fmtDuration(l.data.ms)}
          {l.data.cached ? " (restored from dependency cache)" : l.data.ran ? " (dependencies installed)" : " (no install step)"}
        </span>
      );
    case "error":
      return <span>{hl(l.text, needle)}</span>;
  }
}

function hl(text: string, needle: string): React.ReactNode {
  if (!needle || !text) return text;
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  let i = 0;
  for (let j = lower.indexOf(needle); j !== -1; j = lower.indexOf(needle, i)) {
    parts.push(text.slice(i, j), <mark key={j} className="rounded-[2px] bg-warning/40 text-foreground">{text.slice(j, j + needle.length)}</mark>);
    i = j + needle.length;
  }
  parts.push(text.slice(i));
  return parts;
}

function IconBtn({ label, children, onClick, active }: { label: string; children: React.ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" className={cn("size-7 text-muted-foreground", active && "bg-accent text-foreground")} onClick={onClick} aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center gap-1 p-8 text-center font-sans">
      <div className="text-[13px] font-medium">{title}</div>
      <p className="max-w-sm text-xs text-muted-foreground">{body}</p>
    </div>
  );
}

export type { Run };
