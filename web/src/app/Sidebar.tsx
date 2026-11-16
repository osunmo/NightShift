import { CircleCheck, CircleX, ListTodo, Moon, Plus, Search, Sun, Loader } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusIcon } from "@/components/status";
import { isLive, type Info, type Task } from "@/lib/api";
import { taskRunStatus } from "@/lib/model";
import { navigate } from "@/lib/router";
import { cn } from "@/lib/utils";

export const FILTERS = {
  all: { label: "All tasks", icon: ListTodo, match: (_t: Task) => true },
  active: { label: "Active", icon: Loader, match: (t: Task) => isLive(t.status) },
  done: { label: "Completed", icon: CircleCheck, match: (t: Task) => t.status === "done" },
  failed: { label: "Failed", icon: CircleX, match: (t: Task) => t.status === "failed" || t.status === "cancelled" },
} as const;
export type FilterKey = keyof typeof FILTERS;

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-5", className)} aria-hidden>
      <rect width="32" height="32" rx="7" className="fill-foreground" />
      <path d="M20.5 8.5a8 8 0 1 0 3 12.6A7 7 0 0 1 20.5 8.5z" className="fill-background" />
    </svg>
  );
}

export function Sidebar(props: {
  tasks: Task[] | null;
  info: Info | null;
  activeTaskId: string | null;
  filter: string | null;
  onNew: () => void;
  onSearch: () => void;
  theme: { dark: boolean; toggle: () => void };
}) {
  const tasks = props.tasks ?? [];
  const recent = tasks.slice(0, 7);
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex h-12 items-center gap-2 px-4">
        <Logo />
        <span className="text-sm font-semibold tracking-tight">Nightshift</span>
        {props.info?.demo && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="ml-auto rounded-sm border px-1.5 py-px font-mono text-[10px] text-muted-foreground uppercase">demo</span>
            </TooltipTrigger>
            <TooltipContent side="right">Scripted demo model, no API key in use</TooltipContent>
          </Tooltip>
        )}
      </div>

      <div className="flex flex-col gap-2 px-2 pb-2">
        <button
          onClick={props.onSearch}
          className="flex h-8 items-center gap-2 rounded-md border bg-background px-2 text-left text-muted-foreground shadow-xs transition-colors hover:text-foreground"
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-[13px]">Search</span>
          <Kbd>⌘K</Kbd>
        </button>
        <Button size="sm" className="justify-start" onClick={props.onNew}>
          <Plus />
          New task
          <Kbd className="ml-auto bg-primary-foreground/15 text-primary-foreground/80">C</Kbd>
        </Button>
      </div>

      <nav className="flex flex-col gap-px px-2 py-2">
        {(Object.keys(FILTERS) as FilterKey[]).map((k) => {
          const f = FILTERS[k];
          const n = tasks.filter(f.match).length;
          const active = props.filter === k;
          return (
            <button
              key={k}
              onClick={() => navigate("/tasks", { filter: k === "all" ? null : k })}
              className={cn(
                "flex h-8 items-center gap-2 rounded-md px-2 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                active && "bg-accent font-medium text-foreground"
              )}
            >
              <f.icon className="size-4" />
              <span className="flex-1 text-left">{f.label}</span>
              <span className="tabular text-xs text-muted-foreground">{n}</span>
            </button>
          );
        })}
      </nav>

      <div className="px-4 pt-4 pb-1 text-[11px] font-medium text-muted-foreground">Recent</div>
      <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 scrollbar-thin">
        {recent.map((t) => (
          <button
            key={t.id}
            onClick={() => navigate(`/tasks/${t.id}`)}
            className={cn(
              "flex h-8 items-center gap-2 rounded-md px-2 text-left text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              props.activeTaskId === t.id && "bg-accent text-foreground"
            )}
          >
            <StatusIcon status={taskRunStatus(t.status, t.paused)} paused={t.paused} className="size-3.5" />
            <span className="truncate">{t.prompt.split("\n")[0]}</span>
          </button>
        ))}
        {!recent.length && <div className="px-2 py-1 text-xs text-muted-foreground">No tasks yet</div>}
      </div>

      <div className="border-t border-sidebar-border p-2">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-2 py-2 text-xs">
          <dt className="text-muted-foreground">Model</dt>
          <dd className="truncate font-mono">{props.info ? (props.info.demo ? "scripted demo" : props.info.provider) : "…"}</dd>
          <dt className="text-muted-foreground">Sandbox</dt>
          <dd className="font-mono">{props.info?.sandbox ?? "…"}</dd>
          <dt className="text-muted-foreground">Pull requests</dt>
          <dd className="font-mono">{props.info?.prs ?? "…"}</dd>
        </dl>
        <div className="flex items-center gap-1 px-1">
          <span className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
            <span className={cn("size-1.5 rounded-full", props.tasks ? "bg-success" : "bg-muted-foreground")} />
            {props.tasks ? "Connected" : "Connecting"}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="ml-auto size-7" onClick={props.theme.toggle} aria-label="Toggle theme">
                {props.theme.dark ? <Sun /> : <Moon />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Toggle theme</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </aside>
  );
}
