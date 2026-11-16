import { useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useInfo, useTasks } from "@/lib/api";
import { navigate, useRoute } from "@/lib/router";
import { Sidebar } from "./Sidebar";
import { TasksPage } from "./TasksPage";
import { TaskPage } from "./task/TaskPage";
import { NewTaskDialog } from "./NewTaskDialog";
import { CommandMenu } from "./CommandMenu";

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("ns.theme", dark ? "dark" : "light");
    } catch {}
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

export function App() {
  const route = useRoute();
  const info = useInfo();
  const { tasks, refresh } = useTasks();
  const theme = useTheme();
  const [newOpen, setNewOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /input|textarea|select/i.test((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((o) => !o);
      } else if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key === "c") {
        e.preventDefault();
        setNewOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const [section, id] = route.path;
  const taskId = section === "tasks" && id ? id : null;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full overflow-hidden">
        <Sidebar
          tasks={tasks}
          info={info}
          activeTaskId={taskId}
          filter={taskId ? null : route.query.get("filter") ?? "all"}
          onNew={() => setNewOpen(true)}
          onSearch={() => setCmdOpen(true)}
          theme={theme}
        />
        <main className="flex min-w-0 flex-1 flex-col bg-background">
          {taskId ? (
            <TaskPage key={taskId} id={taskId} query={route.query} onChanged={refresh} />
          ) : (
            <TasksPage tasks={tasks} filter={route.query.get("filter") ?? "all"} q={route.query.get("q") ?? ""} onNew={() => setNewOpen(true)} />
          )}
        </main>
      </div>
      <NewTaskDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        tasks={tasks ?? []}
        onCreated={(t) => {
          refresh();
          navigate(`/tasks/${t.id}`);
        }}
      />
      <CommandMenu open={cmdOpen} onOpenChange={setCmdOpen} tasks={tasks ?? []} taskId={taskId} onNew={() => setNewOpen(true)} theme={theme} onChanged={refresh} />
    </TooltipProvider>
  );
}
