import { GitPullRequest, LayoutList, Scale, Sparkles } from "lucide-react";
import { StatusIcon } from "@/components/status";
import type { Attempt } from "@/lib/api";
import { fmtDuration } from "@/lib/format";
import type { Run } from "@/lib/model";
import { setQuery } from "@/lib/router";
import { cn } from "@/lib/utils";
import { runStatusOf, type Tab, type TaskModel } from "./TaskPage";

const dur = (r: Run | null) => (r ? fmtDuration((r.end ?? Date.now()) - r.start) : "");

/** Left column, in the spirit of a CI run's job list: orchestrator steps and every attempt with its agent runs. */
export function Jobs({ model, attemptId, runId, tab }: { model: TaskModel; attemptId: string | null; runId: string | null; tab: Tab }) {
  const { top, attempts, runs, task } = model;
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-sidebar/40 py-2 scrollbar-thin">
      <Item active={tab === "trace"} onClick={() => setQuery({ tab: "trace", run: null })} icon={<LayoutList className="size-4 text-muted-foreground" />} label="Summary" />

      <Section>Orchestrator</Section>
      {top.plan ? (
        <Item icon={<StatusIcon status={top.plan.status} />} label={top.plan.label} meta={dur(top.plan)} onClick={() => setQuery({ tab: "trace", run: null })} />
      ) : (
        <Item icon={<StatusIcon status="queued" />} label="Plan attempts" muted />
      )}

      <Section>
        Attempts <span className="ml-1 font-normal text-muted-foreground/70">{attempts.length || task.numAttempts}</span>
      </Section>
      {!attempts.length && <div className="px-4 py-1 text-xs text-muted-foreground">Waiting for the plan…</div>}
      {attempts.map((a) => (
        <AttemptBlock key={a.id} a={a} runs={runs[a.id] ?? []} winner={task.winnerAttemptId === a.id} selected={a.id === attemptId} runId={runId} tab={tab} paused={model.paused} />
      ))}

      <Section>Result</Section>
      {top.evaluate ? (
        <Item icon={<StatusIcon status={top.evaluate.status} />} label={top.evaluate.label} meta={dur(top.evaluate)} onClick={() => setQuery({ tab: "trace", run: null })} />
      ) : (
        <Item icon={<Scale className="size-4 text-muted-foreground/60" />} label="Evaluate attempts" muted />
      )}
      {top.pr ? (
        <Item
          icon={<GitPullRequest className="size-4 text-success" />}
          label={task.prUrl ? "Pull request opened" : "Pull request ready"}
          active={tab === "pr"}
          onClick={() => setQuery({ tab: "pr", attempt: task.winnerAttemptId, run: null })}
        />
      ) : (
        <Item icon={<GitPullRequest className="size-4 text-muted-foreground/60" />} label="Open pull request" muted />
      )}
    </div>
  );
}

function AttemptBlock(props: { a: Attempt; runs: Run[]; winner: boolean; selected: boolean; runId: string | null; tab: Tab; paused: boolean }) {
  const { a, runs } = props;
  const start = runs[0]?.start;
  const end = runs.length ? Math.max(...runs.map((r) => r.end ?? Date.now())) : undefined;
  return (
    <div className={cn("mx-2 mb-1 rounded-md", props.selected && "bg-accent/60")}>
      <button
        onClick={() => setQuery({ attempt: a.id, run: null, tab: props.tab === "trace" ? null : props.tab })}
        className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-accent"
      >
        <StatusIcon status={runStatusOf(a)} paused={props.paused} />
        <span className="font-mono text-xs text-muted-foreground">#{a.index}</span>
        <span className={cn("truncate", props.selected && "font-medium")}>{a.strategy.name}</span>
        {props.winner && (
          <span className="flex shrink-0 items-center gap-0.5 rounded-sm bg-success-soft px-1 text-[10px] font-medium text-success">
            <Sparkles className="size-2.5" /> shipped
          </span>
        )}
        <span className="tabular ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">{start && end ? fmtDuration(end - start) : ""}</span>
      </button>
      {runs.length > 0 && (
        <div className="relative pb-1 pl-[15px]">
          <div className="absolute top-0 bottom-2 left-[15px] w-px bg-border" />
          {runs.map((r) => {
            const active = props.selected && props.runId === r.runId && props.tab === "logs";
            return (
              <button
                key={r.key}
                onClick={() => setQuery({ attempt: a.id, run: r.runId, tab: null })}
                className={cn(
                  "relative flex h-7 w-full items-center gap-2 rounded-md pr-2 pl-4 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground",
                  active && "bg-accent text-foreground"
                )}
              >
                <StatusIcon status={r.status} className="size-3.5" paused={props.paused} />
                <span className="truncate">{r.label}</span>
                <span className="tabular ml-auto font-mono text-[11px]">{dur(r)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return <div className="px-4 pt-4 pb-1 text-[11px] font-medium text-muted-foreground">{children}</div>;
}

function Item(props: { icon: React.ReactNode; label: string; meta?: string; active?: boolean; muted?: boolean; onClick?: () => void }) {
  return (
    <button
      disabled={!props.onClick}
      onClick={props.onClick}
      className={cn(
        "mx-2 flex h-8 w-[calc(100%-16px)] items-center gap-2 rounded-md px-2 text-left text-[13px] enabled:hover:bg-accent",
        props.active && "bg-accent font-medium",
        props.muted && "text-muted-foreground"
      )}
    >
      {props.icon}
      <span className="truncate">{props.label}</span>
      {props.meta && <span className="tabular ml-auto font-mono text-[11px] text-muted-foreground">{props.meta}</span>}
    </button>
  );
}
