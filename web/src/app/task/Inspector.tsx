import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, GitMerge, SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { RoleMark, StatusIcon, StatusLabel } from "@/components/status";
import { api, type Attempt, type EventRow } from "@/lib/api";
import { fmtClock, fmtDuration } from "@/lib/format";
import { parseDiff, ROLE_LABEL } from "@/lib/model";
import { setQuery } from "@/lib/router";
import { cn } from "@/lib/utils";
import { runStatusOf, type TaskModel } from "./TaskPage";

export function Inspector({ model, attempt, panel }: { model: TaskModel; attempt: Attempt | null; panel: string }) {
  const messages = useMemo(() => model.events.filter(isMessage), [model.events]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs value={panel} onValueChange={(v) => setQuery({ panel: v })} className="gap-0">
        <div className="flex h-10 items-center border-b px-3">
          <TabsList variant="line" className="h-10 gap-3">
            <TabsTrigger value="details" className="px-0 text-[13px]">
              Details
            </TabsTrigger>
            <TabsTrigger value="messages" className="px-0 text-[13px]">
              Messages
              <span className="tabular rounded-sm bg-muted px-1 font-mono text-[10px] text-muted-foreground">{messages.length}</span>
            </TabsTrigger>
          </TabsList>
        </div>
      </Tabs>
      {panel === "messages" ? <Messages model={model} messages={messages} attempt={attempt} /> : <Details model={model} attempt={attempt} />}
    </div>
  );
}

// ---------------- details ----------------
function Details({ model, attempt }: { model: TaskModel; attempt: Attempt | null }) {
  if (!attempt) return <div className="p-4 text-xs text-muted-foreground">Attempts appear once the orchestrator has a plan.</div>;
  const { task, events } = model;
  const mine = events.filter((e) => e.attemptId === attempt.id);
  const verdicts = mine.filter((e) => e.kind === "verdict");
  const diagnoses = mine.filter((e) => e.kind === "diagnosis");
  const files = parseDiff(attempt.diff);
  const runs = model.runs[attempt.id] ?? [];
  const start = runs[0]?.start;
  const end = runs.length ? Math.max(...runs.map((r) => r.end ?? Date.now())) : null;
  const tokens = mine.filter((e) => e.kind === "usage").reduce((n, e) => n + (e.data.inputTokens ?? 0) + (e.data.outputTokens ?? 0), 0);
  const tools = mine.filter((e) => e.kind === "tool.call").length;
  const winner = task.winnerAttemptId === attempt.id;
  const canShip = !model.live && attempt.status === "passed" && !winner;
  const last = verdicts[verdicts.length - 1]?.data;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
      <div className="border-b p-4">
        <div className="flex items-center gap-2">
          <StatusIcon status={runStatusOf(attempt)} paused={model.paused} />
          <span className="font-mono text-xs text-muted-foreground">#{attempt.index}</span>
          <span className="truncate text-[13px] font-semibold">{attempt.strategy.name}</span>
          <span className="ml-auto">
            <StatusLabel status={runStatusOf(attempt)} paused={model.paused} text={winner ? "Shipped" : attempt.status === "passed" ? "Passed QA" : attempt.status === "failed" ? "Rejected" : undefined} />
          </span>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{attempt.strategy.instructions.split("\nNote:")[0]}</p>
        {canShip && (
          <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => api.select(task.id, attempt.id).then(model.refresh)}>
            <GitMerge /> Ship this attempt instead
          </Button>
        )}
      </div>

      <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2 border-b p-4 text-xs">
        <Prop label="Branch">
          <span className="flex min-w-0 items-center gap-1">
            <span className="truncate font-mono">{attempt.branch}</span>
            <CopyButton text={attempt.branch} variant="ghost" size="icon-xs" className="-my-1 text-muted-foreground" />
          </span>
        </Prop>
        <Prop label="Score">
          {attempt.score != null ? (
            <span className="flex items-center gap-2">
              <span className="tabular font-mono">{attempt.score.toFixed(1)}</span>
              <span className="h-1 w-20 overflow-hidden rounded-full bg-muted">
                <span className="block h-full bg-foreground/60" style={{ width: `${attempt.score * 10}%` }} />
              </span>
            </span>
          ) : (
            <Dim>Scored after QA</Dim>
          )}
        </Prop>
        <Prop label="QA">{last ? `${last.pass ? "Approved" : "Changes needed"} · ${last.score}/10` : <Dim>Not reviewed yet</Dim>}</Prop>
        <Prop label="Tests">
          {last ? last.testsPassed === null ? <Dim>No test command</Dim> : last.testsPassed ? <span className="text-success">Passing</span> : <span className="text-danger">Failing</span> : <Dim>–</Dim>}
        </Prop>
        <Prop label="Fix rounds">
          <span className="tabular font-mono">{attempt.fixRounds}</span> <Dim>of 2</Dim>
        </Prop>
        <Prop label="Changes">
          {attempt.diff ? (
            <span className="tabular font-mono">
              <span className="text-success">+{files.reduce((n, f) => n + f.additions, 0)}</span> <span className="text-danger">−{files.reduce((n, f) => n + f.deletions, 0)}</span>{" "}
              <Dim>
                in {files.length} file{files.length === 1 ? "" : "s"}
              </Dim>
            </span>
          ) : (
            <Dim>Captured after QA</Dim>
          )}
        </Prop>
        <Prop label="Setup">
          {attempt.setupMs == null ? (
            <Dim>–</Dim>
          ) : (
            <>
              <span className="tabular font-mono">{fmtDuration(attempt.setupMs)}</span>{" "}
              <Dim>{attempt.setupCached ? "· dependency cache hit" : setupRan(mine) ? "· dependencies installed" : "· no install step"}</Dim>
            </>
          )}
        </Prop>
        <Prop label="Duration">{start ? <span className="tabular font-mono">{fmtDuration((end ?? Date.now()) - start)}</span> : <Dim>–</Dim>}</Prop>
        <Prop label="Tool calls">
          <span className="tabular font-mono">{tools}</span>
        </Prop>
        <Prop label="Tokens">{tokens ? <span className="tabular font-mono">{tokens.toLocaleString()}</span> : <Dim>Not reported</Dim>}</Prop>
      </dl>

      <Section title="QA reviews" count={verdicts.length}>
        {verdicts.map((v) => (
          <div key={v.id} className="rounded-md border p-3 text-xs">
            <div className="flex items-center gap-2">
              <StatusIcon status={v.data.pass ? "success" : "failure"} className="size-3.5" />
              <span className="font-medium">Round {v.data.round + 1}</span>
              <span className="text-muted-foreground">{v.data.pass ? "approved" : "changes needed"}</span>
              <span className="tabular ml-auto font-mono text-muted-foreground">{v.data.score}/10</span>
            </div>
            {v.data.summary && <p className="mt-1.5 leading-5 text-muted-foreground">{v.data.summary}</p>}
            {v.data.problems?.length > 0 && (
              <ul className="mt-1.5 list-disc space-y-1 pl-4 leading-5">
                {v.data.problems.map((p: string, i: number) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {!verdicts.length && <Dim>QA reviews this attempt after the coder finishes.</Dim>}
      </Section>

      {diagnoses.length > 0 && (
        <Section title="Debugger" count={diagnoses.length}>
          {diagnoses.map((d) => (
            <div key={d.id} className="rounded-md border p-3 text-xs leading-5">
              <div className="mb-1 flex items-center gap-2">
                <StatusIcon status={d.data.fixed ? "success" : "failure"} className="size-3.5" />
                <span className="font-medium">Round {d.data.round}</span>
                <span className="text-muted-foreground">{d.data.fixed ? "fixed" : "not fixed"}</span>
              </div>
              <p>
                <span className="text-muted-foreground">Root cause: </span>
                {d.data.root_cause}
              </p>
              <p>
                <span className="text-muted-foreground">Fix: </span>
                {d.data.fix}
              </p>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

const setupRan = (evs: EventRow[]) => !!evs.find((e) => e.kind === "setup" && e.data.phase === "attempt")?.data.ran;

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}
const Dim = ({ children }: { children: React.ReactNode }) => <span className="text-muted-foreground">{children}</span>;
function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="border-b p-4">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
        {title} <span className="tabular font-mono">{count}</span>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

// ---------------- messages ----------------
const isMessage = (e: EventRow) =>
  e.kind === "task.created" ||
  e.kind === "plan" ||
  (e.kind === "report" && !(e.role === "debugger" && e.data?.status === "done")) ||
  e.kind === "verdict" ||
  e.kind === "diagnosis" ||
  e.kind === "steer" ||
  e.kind === "steer.delivered" ||
  e.kind === "pr" ||
  (e.kind === "evaluation" && ["winner", "no-winner", "guidance", "send-to-debugger", "give-up"].includes(e.data.decision)) ||
  e.kind === "error";

function Messages({ model, messages, attempt }: { model: TaskModel; messages: EventRow[]; attempt: Attempt | null }) {
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) end.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), []);
  const idx = (id: string | null) => model.attempts.find((a) => a.id === id)?.index;

  return (
    <>
      <div ref={box} className="min-h-0 flex-1 overflow-y-auto px-4 py-3 scrollbar-thin">
        <div className="flex flex-col gap-3">
          {messages.map((e) => {
            const d = e.data ?? {};
            if (e.kind === "steer.delivered")
              return (
                <div key={e.id} className="-mt-2 pl-6 text-[11px] text-muted-foreground">
                  Read by attempt {idx(e.attemptId)} ({ROLE_LABEL[e.role].toLowerCase()})
                </div>
              );
            if (e.kind === "evaluation" && (d.decision === "send-to-debugger" || d.decision === "give-up"))
              return (
                <div key={e.id} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  Attempt {idx(e.attemptId)} {d.decision === "give-up" ? "stopped after max fix rounds" : "sent to the debugger"}
                  <span className="h-px flex-1 bg-border" />
                </div>
              );
            const role = e.kind === "task.created" || e.kind === "steer" ? "user" : e.role;
            return (
              <div key={e.id} className="flex gap-2">
                <RoleMark role={role} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5 text-xs">
                    <span className="font-medium">{ROLE_LABEL[role]}</span>
                    {e.attemptId && e.kind !== "steer" && <span className="text-muted-foreground">attempt {idx(e.attemptId)}</span>}
                    {e.kind === "steer" && <span className="text-muted-foreground">to {d.target === "all" ? "all attempts" : `attempt ${idx(d.target)}`}</span>}
                    <span className="tabular ml-auto font-mono text-[10px] text-muted-foreground">{fmtClock(new Date(e.ts).getTime() - model.t0)}</span>
                  </div>
                  <div className={cn("mt-0.5 text-[13px] leading-5 break-words", e.kind === "error" && "text-danger")}>{message(e, idx)}</div>
                </div>
              </div>
            );
          })}
          <div ref={end} />
        </div>
      </div>
      <Composer model={model} attempt={attempt} />
    </>
  );
}

function message(e: EventRow, idx: (id: string | null) => number | undefined): React.ReactNode {
  const d = e.data ?? {};
  switch (e.kind) {
    case "task.created":
      return d.prompt;
    case "plan":
      return (
        <div>
          Planned {d.strategies.length} parallel attempt{d.strategies.length === 1 ? "" : "s"}:
          <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-muted-foreground">
            {d.strategies.map((s: any, i: number) => (
              <li key={i}>
                <span className="text-foreground">{s.name}</span>: {s.instructions.split("\nNote:")[0]}
              </li>
            ))}
          </ol>
        </div>
      );
    case "report":
      return (
        <span>
          {d.status === "blocked" && <span className="mr-1 rounded-sm bg-warning-soft px-1 text-[11px] font-medium text-warning">blocked</span>}
          {d.status === "done" && <span className="mr-1 rounded-sm bg-muted px-1 text-[11px] font-medium text-muted-foreground">done</span>}
          {d.message}
        </span>
      );
    case "verdict":
      return (
        <span>
          <span className={cn("mr-1 rounded-sm px-1 text-[11px] font-medium", d.pass ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>{d.pass ? "approved" : "changes needed"}</span>
          {d.pass ? d.summary : d.problems?.[0] ?? d.summary}
        </span>
      );
    case "diagnosis":
      return `Root cause: ${d.root_cause} Fix: ${d.fix}`;
    case "evaluation":
      if (d.decision === "winner") return <span>Shipping attempt {idx(d.attemptId)}. {d.reason}</span>;
      if (d.decision === "guidance") return <span>Guidance: {d.reason}</span>;
      return d.summary ?? d.reason;
    case "steer":
      return d.text;
    case "pr":
      return d.url ? (
        <a className="text-brand hover:underline" href={d.url} target="_blank" rel="noreferrer">
          Opened {d.url}
        </a>
      ) : (
        `Pull request ready on the attempt branch (not opened: ${d.reason}).`
      );
    case "error":
      return d.message;
  }
  return null;
}

function Composer({ model, attempt }: { model: TaskModel; attempt: Attempt | null }) {
  const [text, setText] = useState("");
  const [target, setTarget] = useState<string>("all");
  const [sending, setSending] = useState(false);
  const live = model.live;
  const send = async () => {
    if (!text.trim() || sending || !live) return;
    setSending(true);
    try {
      await api.steer(model.task.id, text.trim(), target === "all" ? null : target);
      setText("");
    } finally {
      setSending(false);
    }
  };
  useEffect(() => {
    if (attempt && target !== "all" && !model.attempts.some((a) => a.id === target)) setTarget("all");
  }, [attempt, target, model.attempts]);
  const label = target === "all" ? "All attempts" : `Attempt ${model.attempts.find((a) => a.id === target)?.index}`;
  return (
    <div className="border-t p-3">
      <div className={cn("rounded-md border bg-background shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50", !live && "opacity-60")}>
        <Textarea
          value={text}
          disabled={!live}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && send()}
          placeholder={live ? "Steer the agents. They read it before their next step." : "This task has finished."}
          className="min-h-14 resize-none border-0 text-[13px] shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <div className="flex items-center gap-2 px-2 pb-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={!live}>
              <Button variant="ghost" size="xs" className="text-muted-foreground">
                To: {label} <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              <DropdownMenuRadioGroup value={target} onValueChange={setTarget}>
                <DropdownMenuRadioItem value="all">All attempts</DropdownMenuRadioItem>
                {model.attempts.map((a) => (
                  <DropdownMenuRadioItem key={a.id} value={a.id}>
                    Attempt {a.index} · {a.strategy.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="ml-auto flex items-center gap-0.5 text-[11px] text-muted-foreground">
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd>
          </span>
          <Button size="xs" onClick={send} disabled={!live || !text.trim() || sending}>
            <SendHorizontal /> Send
          </Button>
        </div>
      </div>
    </div>
  );
}
