import { CircleCheck, CircleX, ListTodo, Loader, Moon, Pause, Play, Plus, Square, Sun } from "lucide-react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command";
import { StatusIcon } from "@/components/status";
import { api, isLive, type Task } from "@/lib/api";
import { shortId, shortRepo } from "@/lib/format";
import { taskRunStatus } from "@/lib/model";
import { navigate } from "@/lib/router";

export function CommandMenu(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tasks: Task[];
  taskId: string | null;
  onNew: () => void;
  theme: { dark: boolean; toggle: () => void };
  onChanged: () => void;
}) {
  const run = (fn: () => void) => () => {
    props.onOpenChange(false);
    fn();
  };
  const current = props.tasks.find((t) => t.id === props.taskId);
  return (
    <CommandDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      className="sm:max-w-[560px]"
      showCloseButton={false}
      filter={(value, search) => (search.trim().toLowerCase().split(/\s+/).every((w) => value.toLowerCase().includes(w)) ? 1 : 0)}
    >
      <CommandInput placeholder="Search tasks or run a command…" />
      <CommandList className="max-h-[380px]">
        <CommandEmpty>No results.</CommandEmpty>
        {current && isLive(current.status) && (
          <CommandGroup heading="This task">
            {current.paused ? (
              <CommandItem onSelect={run(() => api.resume(current.id).then(props.onChanged))}>
                <Play /> Resume agents
              </CommandItem>
            ) : (
              <CommandItem onSelect={run(() => api.pause(current.id).then(props.onChanged))}>
                <Pause /> Pause agents
              </CommandItem>
            )}
            <CommandItem onSelect={run(() => api.cancel(current.id).then(props.onChanged))}>
              <Square /> Cancel task
            </CommandItem>
          </CommandGroup>
        )}
        <CommandGroup heading="Actions">
          <CommandItem onSelect={run(props.onNew)}>
            <Plus /> New task <CommandShortcut>C</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(() => navigate("/tasks"))}>
            <ListTodo /> All tasks
          </CommandItem>
          <CommandItem onSelect={run(() => navigate("/tasks", { filter: "active" }))}>
            <Loader /> Active tasks
          </CommandItem>
          <CommandItem onSelect={run(() => navigate("/tasks", { filter: "done" }))}>
            <CircleCheck /> Completed tasks
          </CommandItem>
          <CommandItem onSelect={run(() => navigate("/tasks", { filter: "failed" }))}>
            <CircleX /> Failed tasks
          </CommandItem>
          <CommandItem onSelect={run(props.theme.toggle)}>
            {props.theme.dark ? <Sun /> : <Moon />} Switch to {props.theme.dark ? "light" : "dark"} theme
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Tasks">
          {props.tasks.slice(0, 30).map((t) => (
            <CommandItem key={t.id} value={`${t.id} ${t.prompt} ${t.repo}`} onSelect={run(() => navigate(`/tasks/${t.id}`))}>
              <StatusIcon status={taskRunStatus(t.status, t.paused)} paused={t.paused} className="size-3.5" />
              <span className="truncate">{t.prompt.split("\n")[0]}</span>
              <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
                {shortRepo(t.repo)} · {shortId(t.id)}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
