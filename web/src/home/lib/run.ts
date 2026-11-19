// The homepage replays a real Nightshift run. By default it uses a run recorded from `nightshift demo`
// (web/src/home/data/recorded-run.json). When the page is served by a Nightshift server, it switches to
// the most recent completed task on that server, so the demo shows your own data.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Attempt, AttemptStatus, EventRow, Task, TaskStatus } from "@/lib/api";
import { attemptRuns, logLines, taskRuns, type Run } from "@/lib/model";
import recorded from "../data/recorded-run.json";

export interface RunData {
  task: Task;
  attempts: Attempt[];
  events: EventRow[];
  source: "recorded" | "live";
  t0: number;
  duration: number;
}

const prepare = (task: Task, attempts: Attempt[], events: EventRow[], source: RunData["source"]): RunData => {
  const t0 = new Date(task.createdAt).getTime();
  const last = events.length ? new Date(events[events.length - 1].ts).getTime() : t0;
  return { task, attempts, events, source, t0, duration: Math.max(1000, last - t0) };
};

export const RECORDED: RunData = prepare(recorded.task as Task, recorded.attempts as Attempt[], recorded.events as EventRow[], "recorded");

/** Recorded run, upgraded to a live one if this page is being served by a Nightshift server with history. */
export function useRunData(): RunData {
  const [data, setData] = useState<RunData>(RECORDED);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tasks: (Task & { attempts?: { id: string }[] })[] = await fetch("/api/tasks").then((r) => (r.ok ? r.json() : Promise.reject()));
        const pick = tasks.find((t) => t.status === "done" && t.numAttempts > 1) ?? tasks.find((t) => t.status === "done");
        if (!pick) return;
        const [detail, events] = await Promise.all([
          fetch(`/api/tasks/${pick.id}`).then((r) => r.json()),
          fetch(`/api/tasks/${pick.id}/events`).then((r) => r.json()),
        ]);
        if (!cancelled && Array.isArray(events) && events.length > 10) setData(prepare(detail.task, detail.attempts, events, "live"));
      } catch {
        /* static hosting or server offline: keep the recording */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return data;
}

/** State of the run as it was `ms` after it started. Uses the same derivations as the application. */
export function snapshot(run: RunData, ms: number) {
  const cutoff = run.t0 + ms;
  const events = run.events.filter((e) => new Date(e.ts).getTime() <= cutoff);
  const lastStatus = (attemptId: string): AttemptStatus => {
    const s = [...events].reverse().find((e) => e.kind === "attempt.status" && e.attemptId === attemptId);
    return (s?.data.status as AttemptStatus) ?? "pending";
  };
  const taskStatus = ([...events].reverse().find((e) => e.kind === "task.status" && e.data.status)?.data.status as TaskStatus) ?? "queued";
  const started = new Set(events.filter((e) => e.kind === "attempt.created").map((e) => e.attemptId));
  const attempts: Attempt[] = run.attempts
    .filter((a) => started.has(a.id))
    .map((a) => ({ ...a, status: lastStatus(a.id), fixRounds: events.filter((e) => e.kind === "diagnosis" && e.attemptId === a.id).length }));
  const task: Task = { ...run.task, status: taskStatus, winnerAttemptId: taskStatus === "done" ? run.task.winnerAttemptId : null };
  const runs: Record<string, Run[]> = Object.fromEntries(attempts.map((a) => [a.id, attemptRuns(events, a, taskStatus)]));
  return { events, attempts, task, runs, top: taskRuns(events, task) };
}

/**
 * A playhead over a run: play, pause, seek, restart. Loops with a hold at the end when `loop` is set.
 * With reduced motion it starts paused at the end, so the finished state is shown and nothing moves
 * until the user presses play.
 */
export function usePlayer(duration: number, opts: { autoplay?: boolean; loop?: boolean; holdMs?: number; speed?: number; reduced?: boolean; active?: boolean } = {}) {
  const { autoplay = true, loop = false, holdMs = 2600, speed = 1, reduced = false, active = true } = opts;
  const [ms, setMs] = useState(reduced ? duration : 0);
  const [playing, setPlaying] = useState(autoplay && !reduced);
  const pos = useRef(reduced ? duration : 0);
  useEffect(() => {
    if (!playing || !active) return;
    let raf = 0;
    let prev: number | null = null;
    let hold = 0;
    let lastPaint = 0;
    const tick = (now: number) => {
      const dt = prev == null ? 0 : now - prev;
      prev = now;
      if (pos.current >= duration) {
        if (!loop) {
          setPlaying(false);
          return;
        }
        hold += dt;
        if (hold >= holdMs) {
          hold = 0;
          pos.current = 0;
          setMs(0);
        }
      } else {
        pos.current = Math.min(duration, pos.current + dt * speed);
        if (now - lastPaint > 80 || pos.current === duration) {
          lastPaint = now;
          setMs(pos.current);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, active, duration, loop, holdMs, speed]);
  useEffect(() => {
    if (reduced) {
      pos.current = duration;
      setMs(duration);
      setPlaying(false);
    }
  }, [reduced, duration]);
  const seek = (t: number) => {
    pos.current = Math.max(0, Math.min(duration, t));
    setMs(pos.current);
  };
  return {
    ms,
    playing,
    done: ms >= duration,
    play: () => {
      if (pos.current >= duration) seek(0);
      setPlaying(true);
    },
    pause: () => setPlaying(false),
    seek,
    restart: () => {
      seek(0);
      setPlaying(true);
    },
  };
}

/** The agent run with the most recent activity at the playhead, and its last `n` log lines. */
export function activeRun(snap: ReturnType<typeof snapshot>, now: number, n = 6) {
  let best: Run | null = null;
  for (const rs of Object.values(snap.runs)) for (const r of rs) if (r.runId !== "setup" && (!best || (r.end ?? now) >= (best.end ?? now))) best = r;
  return { run: best, lines: best ? logLines(best).slice(-n) : [] };
}

export function useSnapshot(run: RunData, ms: number) {
  // Recompute only when a new event crosses the cutoff.
  const count = useMemo(() => run.events.filter((e) => new Date(e.ts).getTime() <= run.t0 + ms).length, [run, ms]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => snapshot(run, ms), [run, count]);
}

export const STRATEGY_LABEL = (a: Attempt) => `#${a.index} ${a.strategy.name}`;
