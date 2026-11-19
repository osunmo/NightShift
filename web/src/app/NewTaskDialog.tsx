import { useEffect, useMemo, useRef, useState } from "react";
import { FolderGit2, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, type Task } from "@/lib/api";
import { readPreferences } from "@/lib/preferences";
import { shortRepo } from "@/lib/format";

const STRATEGY_HINT: Record<number, string> = {
  1: "One coder, then QA. Fastest and cheapest.",
  2: "Two coders with different approaches run in parallel. The orchestrator ships the better one.",
  3: "Three parallel approaches. Good for ambiguous bugs.",
  4: "Four parallel approaches. Highest cost.",
};

export function NewTaskDialog(props: { open: boolean; onOpenChange: (o: boolean) => void; tasks: Task[]; onCreated: (t: Task) => void }) {
  const recentRepos = useMemo(() => [...new Set(props.tasks.map((t) => t.repo))].slice(0, 4), [props.tasks]);
  const [repo, setRepo] = useState(() => localStorage.getItem("ns.repo") ?? "");
  const [branch, setBranch] = useState(() => localStorage.getItem("ns.base") ?? "main");
  const [attempts, setAttempts] = useState("2");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (props.open) {
      setError(null);
      if (!repo && recentRepos[0]) setRepo(recentRepos[0]);
      setTimeout(() => promptRef.current?.focus(), 50);
    }
  }, [props.open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    if (!prompt.trim() || !repo.trim() || busy) return setError(!repo.trim() ? "Repository is required." : !prompt.trim() ? "Describe the task." : null);
    setBusy(true);
    try {
      const preferences = readPreferences();
      const t = await api.create({
        prompt: preferences.rules ? `${prompt.trim()}\n\nAgent rules:\n${preferences.rules}` : prompt.trim(),
        repo: repo.trim(),
        baseBranch: branch.trim() || "main",
        numAttempts: Number(attempts),
        pullRequest: preferences.autoDraft ? "draft" : "off",
      });
      localStorage.setItem("ns.repo", repo.trim());
      localStorage.setItem("ns.base", branch.trim() || "main");
      setPrompt("");
      props.onOpenChange(false);
      props.onCreated(t);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-[600px]" onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && submit()}>
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="text-sm">New task</DialogTitle>
          <DialogDescription className="text-xs">The orchestrator plans attempts, runs them in sandboxes, and prepares the reviewed result.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 px-4 py-4">
          <Textarea
            ref={promptRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the change. For example: paginate() skips the first page of results. Fix it and add a regression test."
            className="min-h-28 resize-none border-0 px-0 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <div className="grid grid-cols-[1fr_140px] gap-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Repository</span>
              <div className="relative">
                <FolderGit2 className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="https://github.com/org/repo or a local path" className="h-8 pl-8 font-mono text-xs" />
              </div>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Base branch</span>
              <div className="relative">
                <GitBranch className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={branch} onChange={(e) => setBranch(e.target.value)} className="h-8 pl-8 font-mono text-xs" />
              </div>
            </label>
          </div>
          {recentRepos.length > 0 && (
            <div className="-mt-2 flex flex-wrap items-center gap-1">
              <span className="mr-1 text-xs text-muted-foreground">Recent</span>
              {recentRepos.map((r) => (
                <button key={r} onClick={() => setRepo(r)} className="rounded-sm border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground" title={r}>
                  {shortRepo(r)}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Parallel attempts</span>
            <div className="flex items-center gap-3">
              <ToggleGroup type="single" variant="outline" size="sm" value={attempts} onValueChange={(v) => v && setAttempts(v)}>
                {["1", "2", "3", "4"].map((n) => (
                  <ToggleGroupItem key={n} value={n} className="w-9 font-mono text-xs">
                    {n}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <span className="text-xs text-muted-foreground">{STRATEGY_HINT[Number(attempts)]}</span>
            </div>
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
        <DialogFooter className="items-center border-t px-4 py-3">
          <span className="mr-auto flex items-center gap-1 text-xs text-muted-foreground">
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd> to start
          </span>
          <Button variant="ghost" size="sm" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy}>
            {busy ? "Starting…" : "Start task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
