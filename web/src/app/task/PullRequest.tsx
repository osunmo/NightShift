import { ExternalLink, GitMerge, GitPullRequest } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { api, type Attempt } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Empty } from "./Logs";
import type { TaskModel } from "./TaskPage";

export function PullRequest({ model, attempt }: { model: TaskModel; attempt: Attempt | null }) {
  const { task, events, live } = model;
  const pr = [...events].reverse().find((e) => e.kind === "pr" && (!attempt || e.attemptId === attempt.id));
  if (!pr) {
    if (live) return <Empty title="No pull request yet" body="The orchestrator writes the pull request after it compares the attempts that passed QA." />;
    if (attempt && attempt.status === "passed")
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="text-[13px] font-medium">Attempt {attempt.index} passed QA but was not shipped</div>
          <p className="max-w-sm text-xs text-muted-foreground">You can ship it instead. Nightshift commits it on its own branch and opens a pull request with its QA review.</p>
          <Button size="sm" variant="outline" onClick={() => api.select(task.id, attempt.id).then(model.refresh)}>
            <GitMerge /> Ship attempt {attempt.index} instead
          </Button>
        </div>
      );
    return <Empty title="No pull request" body={task.status === "failed" ? "No attempt passed QA, so nothing was shipped." : "This attempt was not shipped."} />;
  }
  const d = pr.data;
  const branch = model.attempts.find((a) => a.id === pr.attemptId)?.branch ?? "";
  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-3xl px-6 py-6">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg leading-snug font-semibold tracking-tight">{d.title}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className={cn("inline-flex h-6 items-center gap-1 rounded-full px-2 font-medium", d.url ? "bg-success text-white" : "bg-muted text-foreground")}>
                <GitPullRequest className="size-3.5" /> {d.url ? "Open" : "Not opened"}
              </span>
              <span>
                <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono">{branch}</span> into <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono">{task.baseBranch}</span>
              </span>
              <CopyButton text={branch} variant="ghost" size="icon-xs" />
              {!d.url && d.reason && <span>· {d.reason}</span>}
            </div>
          </div>
          {d.url && (
            <Button size="sm" asChild>
              <a href={d.url} target="_blank" rel="noreferrer">
                Open on GitHub <ExternalLink className="size-3" />
              </a>
            </Button>
          )}
        </div>
        <div className="mt-6 rounded-md border">
          <div className="flex h-9 items-center border-b bg-muted/50 px-3 text-xs text-muted-foreground">Description written by the orchestrator</div>
          <Markdown src={d.body} />
        </div>
      </div>
    </div>
  );
}

/** Small renderer for the PR body the orchestrator writes: headings, bold, code, tables, lists, details blocks. */
function Markdown({ src }: { src: string }) {
  const out: React.ReactNode[] = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("```")) {
      const buf: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith("```"); i++) buf.push(lines[i]);
      out.push(
        <pre key={i} className="my-2 max-h-72 overflow-auto rounded-md border bg-code p-3 font-mono text-xs leading-5 scrollbar-thin">
          {buf.join("\n")}
        </pre>
      );
    } else if (l.startsWith("## ")) out.push(<h3 key={i} className="mt-5 mb-2 text-sm font-semibold first:mt-0">{inline(l.slice(3))}</h3>);
    else if (l.startsWith("|")) {
      const rows: string[] = [];
      for (; i < lines.length && lines[i].startsWith("|"); i++) rows.push(lines[i]);
      i--;
      const data = rows.filter((r) => !/^\|[\s|:-]+\|$/.test(r)).map((r) => r.split("|").slice(1, -1).map((c) => c.trim()));
      out.push(
        <table key={i} className="my-2 w-full overflow-hidden rounded-md border text-xs">
          <tbody>
            {data.map((cells, k) => (
              <tr key={k} className={cn(k === 0 ? "bg-muted/50 font-medium" : "border-t")}>
                {cells.map((c, j) => (
                  <td key={j} className="px-3 py-1.5">
                    {inline(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    } else if (/^\d+\. /.test(l) || /^\s{2,}\S/.test(l)) out.push(<p key={i} className="pl-4 text-[13px] leading-6">{inline(l.trim())}</p>);
    else if (/^<\/?details>$/.test(l.trim())) continue;
    else if (/^(<details>)?<summary>/.test(l.trim())) out.push(<div key={i} className="mt-5 mb-1 text-sm font-semibold">{l.replace(/<\/?(details|summary)>/g, "").trim()}</div>);
    else if (l.trim()) out.push(<p key={i} className="text-[13px] leading-6">{inline(l)}</p>);
  }
  return <div className="px-4 py-4">{out}</div>;
}

function inline(s: string): React.ReactNode {
  const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_)/g);
  return parts.map((p, i) =>
    p.startsWith("**") ? (
      <strong key={i}>{p.slice(2, -2)}</strong>
    ) : p.startsWith("`") ? (
      <code key={i} className="rounded-sm bg-muted px-1 font-mono text-[12px]">
        {p.slice(1, -1)}
      </code>
    ) : p.startsWith("_") && p.endsWith("_") && p.length > 2 ? (
      <span key={i} className="text-muted-foreground">
        {p.slice(1, -1)}
      </span>
    ) : (
      p
    )
  );
}
