import { useEffect, useMemo } from "react";
import { ChevronRight, Clock, ExternalLink, FileText, GitBranch, GitPullRequest, Layers, Pause, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusIcon, StatusLabel } from "@/components/status";
import { api, isLive, useTaskStream, useTick, type Attempt, type EventRow, type Task } from "@/lib/api";
import { fmtAgo, fmtDuration, shortId, shortRepo } from "@/lib/format";
import { attemptRuns, taskRunStatus, taskRuns, type Run } from "@/lib/model";
import { navigate, setQuery } from "@/lib/router";
import { cn } from "@/lib/utils";
import { Jobs } from "./Jobs";
import { Logs } from "./Logs";
import { Trace } from "./Trace";
import { DiffView } from "./DiffView";
import { PullRequest } from "./PullRequest";
import { Inspector } from "./Inspector";

export type Tab = "logs" | "trace" | "diff" | "pr";

export interface TaskModel {
  task: Task;
  attempts: Attempt[];
  paused: boolean;
  events: EventRow[];
  live: boolean;
  t0: number;
  runs: Record<string, Run[]>;
  top: ReturnType<typeof taskRuns>;
  refresh: () => void;
}

export function TaskPage({ id, query, onChanged }: { id: string; query: URLSearchParams; onChanged: () => void }) {
  const { detail, events, connected, refresh } = useTaskStream(id);
  const live = detail ? isLive(detail.task.status) : false;
  useTick(live, 500);

  const model = useMemo<TaskModel | null>(() => {
    if (!detail) return null;
    const { task, attempts, paused } = detail;
    return {
      task,
      attempts,
      paused,
      events,
      live: isLive(task.status),
      t0: new Date(task.createdAt).getTime(),
      runs: Object.fromEntries(attempts.map((a) => [a.id, attemptRuns(events, a, task.status)])),
      top: taskRuns(events, task),
      refresh: () => (refresh(), onChanged()),
    };
  }, [detail, events, refresh, onChanged]);

  // Selection lives in the URL so views are linkable.
  const attempts = model?.attempts ?? [];
  const firstRunning = attempts.find((a) => !["passed", "failed", "cancelled"].includes(a.status));
  const attemptId = query.get("attempt") ?? model?.task.winnerAttemptId ?? firstRunning?.id ?? attempts[0]?.id ?? null;
  const tab = (query.get("tab") as Tab) ?? "logs";
  const runId = query.get("run");
  const panel = query.get("panel") ?? (live ? "messages" : "details");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/input|textarea/i.test((e.target as HTMLElement)?.tagName)) return;
      if (e.key === "Escape") navigate("/tasks");
      const n = Number(e.key);
      if (!e.metaKey && !e.ctrlKey && n >= 1 && n <= attempts.length) setQuery({ attempt: attempts[n - 1].id, run: null });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [attempts]);

  if (!model)
    return (
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="mt-4 h-64 w-full" />
      </div>
    );

  const { task } = model;
  const attempt = attempts.find((a) => a.id === attemptId) ?? null;
  const status = taskRunStatus(task.status, model.paused);
  const end = model.live ? Date.now() : new Date(task.updatedAt).getTime();
  const winner = attempts.find((a) => a.id === task.winnerAttemptId);

  const act = (fn: () => Promise<unknown>) => () => fn().then(model.refresh);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* breadcrumb + actions */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <button onClick={() => navigate("/tasks")} className="text-[13px] text-muted-foreground hover:text-foreground">
          Tasks
        </button>
        <ChevronRight className="size-3.5 text-muted-foreground" />
        <span className="font-mono text-xs">{shortId(task.id)}</span>
        <CopyButton text={task.id} variant="ghost" size="icon-xs" className="text-muted-foreground" />
        <div className="ml-auto flex items-center gap-2">
          {model.live && connected && (
            <span className="mr-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-1.5 animate-ns-pulse rounded-full bg-brand" /> Live
            </span>
          )}
          {model.live && (
            <>
              {model.paused ? (
                <Button variant="outline" size="sm" onClick={act(() => api.resume(task.id))}>
                  <Play /> Resume
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={act(() => api.pause(task.id))}>
                  <Pause /> Pause
                </Button>
              )}
              <Button variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={act(() => api.cancel(task.id))}>
                <Square /> Cancel
              </Button>
            </>
          )}
          {!model.live && winner && (
            <>
              <CopyButton text={winner.branch} variant="outline" size="sm" className="font-normal">
                Copy branch
              </CopyButton>
              {task.prUrl ? (
                <Button size="sm" asChild>
                  <a href={task.prUrl} target="_blank" rel="noreferrer">
                    <GitPullRequest /> View pull request <ExternalLink className="size-3" />
                  </a>
                </Button>
              ) : (
                <Button size="sm" onClick={() => setQuery({ tab: "pr", attempt: winner.id })}>
                  <GitPullRequest /> Review pull request
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* title + meta */}
      <div className="shrink-0 border-b px-4 py-3">
        <div className="flex items-start gap-2">
          <StatusIcon status={status} paused={model.paused} className="mt-0.5" />
          <h1 className="line-clamp-2 text-[15px] leading-snug font-semibold tracking-tight">{task.prompt}</h1>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 pl-6 text-xs text-muted-foreground">
          <StatusLabel status={status} paused={model.paused} text={task.status === "done" ? "Completed" : undefined} />
          <Meta icon={GitBranch}>
            <span className="font-mono">{shortRepo(task.repo)}</span>
            <span className="text-muted-foreground/60">on</span>
            <span className="font-mono">{task.baseBranch}</span>
          </Meta>
          <Meta icon={Layers}>
            {task.numAttempts} parallel attempt{task.numAttempts > 1 ? "s" : ""}
          </Meta>
          <Meta icon={Clock}>
            <span className="tabular font-mono">{fmtDuration(end - model.t0)}</span>
            <span className="text-muted-foreground/60">· started {fmtAgo(task.createdAt)}</span>
          </Meta>
          {task.summary && !model.live && (
            <Meta icon={FileText}>
              <span className={cn("max-w-[420px] truncate", task.status === "failed" && "text-danger")}>{task.summary}</span>
            </Meta>
          )}
        </div>
      </div>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={248} minSize={200} maxSize={360}>
          <Jobs model={model} attemptId={attemptId} runId={runId} tab={tab} />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel minSize={360}>
          <div className="flex h-full min-h-0 flex-col">
            <Tabs value={tab} onValueChange={(v) => setQuery({ tab: v === "logs" ? null : v })} className="gap-0">
              <div className="flex h-10 items-center gap-3 border-b px-3">
                <TabsList variant="line" className="h-10 gap-3">
                  <TabsTrigger value="logs" className="px-0 text-[13px]">
                    Logs
                  </TabsTrigger>
                  <TabsTrigger value="trace" className="px-0 text-[13px]">
                    Trace
                  </TabsTrigger>
                  <TabsTrigger value="diff" className="px-0 text-[13px]">
                    Diff
                  </TabsTrigger>
                  <TabsTrigger value="pr" className="px-0 text-[13px]">
                    Pull request
                  </TabsTrigger>
                </TabsList>
                {tab !== "trace" && attempts.length > 1 && (
                  <div className="ml-auto flex items-center gap-1">
                    <span className="mr-1 text-xs text-muted-foreground">Attempt</span>
                    {attempts.map((a) => (
                      <Tooltip key={a.id}>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => setQuery({ attempt: a.id, run: null })}
                            className={cn(
                              "flex h-6 items-center gap-1 rounded-md border px-1.5 font-mono text-[11px] transition-colors",
                              a.id === attemptId ? "border-foreground/20 bg-accent text-foreground" : "border-transparent text-muted-foreground hover:bg-accent"
                            )}
                          >
                            <StatusIcon status={runStatusOf(a)} className="size-3" />
                            {a.index}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {a.strategy.name} · press {a.index}
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                )}
              </div>
            </Tabs>
            <div className="min-h-0 flex-1">
              {tab === "logs" && <Logs model={model} attempt={attempt} focusRun={runId} />}
              {tab === "trace" && <Trace model={model} />}
              {tab === "diff" && <DiffView attempt={attempt} />}
              {tab === "pr" && <PullRequest model={model} attempt={attempt} />}
            </div>
          </div>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={340} minSize={280} maxSize={520}>
          <Inspector model={model} attempt={attempt} panel={panel} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

function Meta({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <Icon className="size-3.5" />
      {children}
    </span>
  );
}

export function runStatusOf(a: Attempt) {
  return a.status === "passed" ? "success" : a.status === "failed" ? "failure" : a.status === "cancelled" ? "cancelled" : a.status === "pending" ? "queued" : "running";
}
