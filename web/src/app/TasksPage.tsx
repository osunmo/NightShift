import { useEffect, useMemo, useRef } from "react";
import { GitBranch, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusIcon } from "@/components/status";
import { isLive, useTick, type AttemptSummary, type Task } from "@/lib/api";
import { fmtAgo, fmtDuration, shortId, shortRepo } from "@/lib/format";
import { attemptRunStatus, taskRunStatus } from "@/lib/model";
import { navigate, setQuery } from "@/lib/router";
import { cn } from "@/lib/utils";
import { FILTERS, type FilterKey } from "./Sidebar";

const COLS = "grid grid-cols-[16px_minmax(0,1fr)_minmax(0,180px)_96px_minmax(0,220px)_72px_80px] items-center gap-4";

export function TasksPage({ tasks, filter, q, onNew }: { tasks: Task[] | null; filter: string; q: string; onNew: () => void }) {
  const search = useRef<HTMLInputElement>(null);
  const key = (filter in FILTERS ? filter : "all") as FilterKey;
  const anyLive = tasks?.some((t) => isLive(t.status)) ?? false;
  useTick(anyLive);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (tasks ?? [])
      .filter(FILTERS[key].match)
      .filter((t) => !needle || `${t.id} ${t.prompt} ${t.repo} ${t.attempts?.map((a) => a.strategy).join(" ")}`.toLowerCase().includes(needle));
  }, [tasks, key, q]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <h1 className="text-sm font-medium">{FILTERS[key].label}</h1>
        <span className="tabular text-xs text-muted-foreground">{rows.length}</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={search}
              value={q}
              onChange={(e) => setQuery({ q: e.target.value || null })}
              placeholder="Filter by task, repo, strategy or ID"
              className="h-8 w-72 pr-8 pl-8 text-[13px]"
            />
            {q ? (
              <button onClick={() => setQuery({ q: null })} className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear filter">
                <X className="size-3.5" />
              </button>
            ) : (
              <Kbd className="absolute top-1/2 right-1.5 -translate-y-1/2">/</Kbd>
            )}
          </div>
          <Button size="sm" onClick={onNew}>
            <Plus /> New task
          </Button>
        </div>
      </header>

      <div className={cn(COLS, "h-8 shrink-0 border-b px-4 text-[11px] font-medium text-muted-foreground")}>
        <span />
        <span>Task</span>
        <span>Repository</span>
        <span>Attempts</span>
        <span>Result</span>
        <span className="text-right">Duration</span>
        <span className="text-right">Started</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {!tasks &&
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={cn(COLS, "h-11 border-b px-4")}>
              <Skeleton className="size-4 rounded-full" />
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-3 w-32" />
              <Skeleton className="ml-auto h-3 w-10" />
              <Skeleton className="ml-auto h-3 w-12" />
            </div>
          ))}
        {tasks && rows.map((t) => <Row key={t.id} t={t} />)}
        {tasks && !rows.length && (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <div className="text-sm font-medium">{tasks.length ? "No tasks match this view" : "No tasks yet"}</div>
            <p className="max-w-sm text-xs text-muted-foreground">
              {tasks.length
                ? "Try a different filter or clear the search."
                : "Describe a bug or small feature. Coder agents work on it in parallel, QA reviews each change, and the best one becomes a pull request."}
            </p>
            {tasks.length ? (
              <Button variant="outline" size="sm" onClick={() => navigate("/tasks")}>
                Clear filters
              </Button>
            ) : (
              <Button size="sm" onClick={onNew}>
                <Plus /> New task
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ t }: { t: Task }) {
  const live = isLive(t.status);
  const status = taskRunStatus(t.status, t.paused);
  const end = live ? Date.now() : new Date(t.updatedAt).getTime();
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => navigate(`/tasks/${t.id}`)}
      onKeyDown={(e) => e.key === "Enter" && navigate(`/tasks/${t.id}`)}
      className={cn(COLS, "h-11 cursor-pointer border-b px-4 text-[13px] transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none")}
    >
      <StatusIcon status={status} paused={t.paused} />
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{shortId(t.id)}</span>
        <span className="truncate font-medium">{t.prompt.split("\n")[0]}</span>
      </div>
      <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <GitBranch className="size-3.5 shrink-0" />
        <span className="truncate font-mono text-xs">{shortRepo(t.repo)}</span>
      </div>
      <AttemptMatrix attempts={t.attempts ?? []} total={t.numAttempts} winner={t.winnerAttemptId} />
      <div className="truncate text-xs text-muted-foreground">{result(t)}</div>
      <div className="tabular text-right font-mono text-xs text-muted-foreground">{fmtDuration(end - new Date(t.createdAt).getTime())}</div>
      <div className="text-right text-xs text-muted-foreground">{fmtAgo(t.createdAt)}</div>
    </div>
  );
}

function result(t: Task): React.ReactNode {
  const a = t.attempts ?? [];
  const w = a.find((x) => x.id === t.winnerAttemptId);
  if (t.status === "done" && w)
    return (
      <>
        <span className="text-foreground">#{w.index} {w.strategy}</span> shipped{t.prUrl ? " · PR open" : ""}
      </>
    );
  if (t.status === "failed") return <span className="text-danger">{a.length ? "No attempt passed QA" : "Failed before attempts started"}</span>;
  if (t.status === "cancelled") return "Cancelled";
  if (t.status === "planning" || t.status === "queued") return "Planning attempts";
  if (t.status === "evaluating") return "Choosing the best attempt";
  const phases = a.map((x) => x.status).filter((s) => !["passed", "failed", "cancelled"].includes(s));
  const passed = a.filter((x) => x.status === "passed").length;
  return `${phases.length} running${passed ? ` · ${passed} passed` : ""}${t.paused ? " · paused" : ""}`;
}

function AttemptMatrix({ attempts, total, winner }: { attempts: AttemptSummary[]; total: number; winner: string | null }) {
  const cells = Array.from({ length: total }, (_, i) => attempts.find((a) => a.index === i + 1));
  return (
    <div className="flex items-center gap-1">
      {cells.map((a, i) => (
        <Tooltip key={i}>
          <TooltipTrigger asChild>
            <span
              className={cn(
                "size-2.5 rounded-[3px] border",
                !a && "border-dashed",
                a && attemptRunStatus(a.status) === "success" && "border-success bg-success",
                a && attemptRunStatus(a.status) === "failure" && "border-danger bg-danger",
                a && attemptRunStatus(a.status) === "running" && "animate-ns-pulse border-brand bg-brand",
                a && attemptRunStatus(a.status) === "cancelled" && "bg-muted",
                a && a.id === winner && "ring-2 ring-success/30 ring-offset-1 ring-offset-background"
              )}
            />
          </TooltipTrigger>
          <TooltipContent>
            {a ? `Attempt ${a.index} · ${a.strategy} · ${a.status}${a.score != null ? ` · score ${a.score}` : ""}${a.id === winner ? " · shipped" : ""}` : `Attempt ${i + 1} · not started`}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
