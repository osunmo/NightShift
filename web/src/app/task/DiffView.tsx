import { useMemo, useState } from "react";
import { FileCode2 } from "lucide-react";
import { CopyButton } from "@/components/ui/copy-button";
import type { Attempt } from "@/lib/api";
import { parseDiff } from "@/lib/model";
import { cn } from "@/lib/utils";
import { Empty } from "./Logs";

export function DiffView({ attempt }: { attempt: Attempt | null }) {
  const files = useMemo(() => parseDiff(attempt?.diff ?? null), [attempt?.diff]);
  const [active, setActive] = useState<string | null>(null);
  if (!attempt) return <Empty title="No attempt selected" body="Pick an attempt to see its changes." />;
  if (!attempt.diff)
    return (
      <Empty
        title="No diff yet"
        body={["passed", "failed", "cancelled"].includes(attempt.status) ? "This attempt finished without changes." : "The diff is captured once QA finishes reviewing this attempt."}
      />
    );
  const add = files.reduce((n, f) => n + f.additions, 0);
  const del = files.reduce((n, f) => n + f.deletions, 0);
  return (
    <div className="flex h-full min-h-0">
      <div className="w-60 shrink-0 overflow-y-auto border-r py-2 scrollbar-thin">
        <div className="flex items-center gap-2 px-3 pb-2 text-xs text-muted-foreground">
          {files.length} file{files.length === 1 ? "" : "s"} changed
          <span className="tabular ml-auto font-mono">
            <span className="text-success">+{add}</span> <span className="text-danger">−{del}</span>
          </span>
        </div>
        {files.map((f) => (
          <button
            key={f.path}
            onClick={() => {
              setActive(f.path);
              document.getElementById(`file-${f.path}`)?.scrollIntoView({ block: "start" });
            }}
            className={cn("mx-1 flex h-7 w-[calc(100%-8px)] items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-accent", active === f.path && "bg-accent")}
          >
            <span className={cn("w-3 shrink-0 font-mono text-[10px] font-semibold", f.status === "added" ? "text-success" : f.status === "deleted" ? "text-danger" : "text-warning")}>
              {f.status === "added" ? "A" : f.status === "deleted" ? "D" : "M"}
            </span>
            <span className="truncate font-mono" title={f.path}>
              {f.path}
            </span>
            <span className="tabular ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
              +{f.additions} −{f.deletions}
            </span>
          </button>
        ))}
      </div>
      <div className="min-w-0 flex-1 overflow-auto scrollbar-thin">
        <div className="flex flex-col gap-3 p-3">
          {files.map((f) => (
            <div key={f.path} id={`file-${f.path}`} className="overflow-hidden rounded-md border">
              <div className="sticky top-0 z-10 flex h-9 items-center gap-2 border-b bg-muted/60 px-3 backdrop-blur">
                <FileCode2 className="size-3.5 text-muted-foreground" />
                <span className="font-mono text-xs font-medium">{f.path}</span>
                <CopyButton text={f.path} variant="ghost" size="icon-xs" className="text-muted-foreground" />
                <span className="tabular ml-auto font-mono text-[11px]">
                  <span className="text-success">+{f.additions}</span> <span className="text-danger">−{f.deletions}</span>
                </span>
              </div>
              <table className="w-full border-collapse font-mono text-xs leading-5">
                <tbody>
                  {f.lines.map((l, i) =>
                    l.type === "hunk" ? (
                      <tr key={i} className="bg-brand-soft/50 text-muted-foreground">
                        <td colSpan={4} className="px-3 py-0.5">
                          {l.text}
                        </td>
                      </tr>
                    ) : (
                      <tr key={i} className={cn(l.type === "add" && "bg-diff-add", l.type === "del" && "bg-diff-del")}>
                        <td className={cn("w-10 border-r px-2 text-right text-muted-foreground/70 select-none", l.type === "del" && "bg-diff-del-strong/50")}>{l.old ?? ""}</td>
                        <td className={cn("w-10 border-r px-2 text-right text-muted-foreground/70 select-none", l.type === "add" && "bg-diff-add-strong/50")}>{l.new ?? ""}</td>
                        <td className={cn("w-5 text-center select-none", l.type === "add" ? "text-success" : l.type === "del" ? "text-danger" : "text-muted-foreground/50")}>
                          {l.type === "add" ? "+" : l.type === "del" ? "−" : ""}
                        </td>
                        <td className="pr-3 whitespace-pre">{l.text || " "}</td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
