// Types mirror the server (src/types.ts) and the HTTP API in src/server/app.ts.
import { useCallback, useEffect, useRef, useState } from "react";

export type TaskStatus = "queued" | "planning" | "running" | "evaluating" | "done" | "failed" | "cancelled";
export type AttemptStatus = "pending" | "setup" | "coding" | "qa" | "debugging" | "passed" | "failed" | "cancelled";
export type Role = "orchestrator" | "coder" | "qa" | "debugger" | "user" | "system";

export interface Strategy {
  name: string;
  instructions: string;
  model?: string;
}

export interface AttemptSummary {
  id: string;
  index: number;
  status: AttemptStatus;
  score: number | null;
  fixRounds: number;
  strategy: string;
}

export interface Task {
  id: string;
  prompt: string;
  repo: string;
  baseBranch: string;
  status: TaskStatus;
  numAttempts: number;
  winnerAttemptId: string | null;
  prUrl: string | null;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
  paused?: boolean;
  attempts?: AttemptSummary[];
}

export interface Attempt {
  id: string;
  taskId: string;
  index: number;
  strategy: Strategy;
  status: AttemptStatus;
  branch: string;
  workdir: string;
  fixRounds: number;
  score: number | null;
  diff: string | null;
  setupMs: number | null;
  setupCached: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EventRow {
  id: number;
  taskId: string;
  attemptId: string | null;
  role: Role;
  kind: string;
  data: any;
  ts: string;
}

export interface TaskDetail {
  task: Task;
  attempts: Attempt[];
  paused: boolean;
}

export type ModelProvider = "openai" | "anthropic" | "openrouter";

export interface GitHubInstallation {
  id: number;
  account: string;
  manageUrl: string;
  canPublish: boolean;
}

export type GitHubAppInfo = { configured: false } | {
  configured: true;
  installUrl: string;
  installations: GitHubInstallation[];
  connection?: GitHubInstallation;
  repositories: { id: number; name: string; url: string; private: boolean; defaultBranch: string }[];
};

export interface Info {
  provider: string;
  sandbox: string;
  demo: boolean;
  prs: string;
  githubConfigured?: boolean;
  modelKeys?: Record<ModelProvider, boolean>;
}

export const LIVE: TaskStatus[] = ["queued", "planning", "running", "evaluating"];
export const isLive = (s: TaskStatus) => LIVE.includes(s);

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, { headers: { "content-type": "application/json" }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  info: () => req<Info>("/info"),
  githubApp: (signal?: AbortSignal) => req<GitHubAppInfo>("/settings/github", { signal }),
  connectGitHubApp: (installationId: number) =>
    req<{ ok: boolean }>("/settings/github", { method: "PUT", body: JSON.stringify({ installationId }) }),
  saveModelKey: (provider: ModelProvider, key: string) =>
    req<Info>("/settings/models", { method: "PUT", body: JSON.stringify({ provider, key }) }),
  tasks: () => req<Task[]>("/tasks"),
  task: (id: string) => req<TaskDetail>(`/tasks/${id}`),
  create: (b: { prompt: string; repo: string; baseBranch: string; numAttempts: number; pullRequest?: "draft" | "off" }) =>
    req<Task>("/tasks", { method: "POST", body: JSON.stringify(b) }),
  steer: (id: string, text: string, attemptId: string | null) =>
    req(`/tasks/${id}/steer`, { method: "POST", body: JSON.stringify({ text, attemptId }) }),
  pause: (id: string) => req(`/tasks/${id}/pause`, { method: "POST" }),
  resume: (id: string) => req(`/tasks/${id}/resume`, { method: "POST" }),
  cancel: (id: string) => req(`/tasks/${id}/cancel`, { method: "POST" }),
  select: (id: string, attemptId: string) => req<Task>(`/tasks/${id}/select`, { method: "POST", body: JSON.stringify({ attemptId }) }),
};

/** Task list, polled. Cheap enough at this scale and keeps every view in sync. */
export function useTasks(intervalMs = 2000) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => api.tasks().then((t) => (setTasks(t), setError(null))).catch((e) => setError(e.message)), []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, intervalMs);
    return () => clearInterval(t);
  }, [refresh, intervalMs]);
  return { tasks, error, refresh };
}

export function useInfo() {
  const [info, setInfo] = useState<Info | null>(null);
  useEffect(() => {
    api.info().then(setInfo).catch(() => {});
  }, []);
  return { info, setInfo };
}

/** One task: detail snapshot + the full event stream over SSE (replayed from the start, then live). */
export function useTaskStream(id: string) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [connected, setConnected] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const refresh = useCallback(() => {
    api.task(id).then(setDetail).catch(() => {});
  }, [id]);

  useEffect(() => {
    setDetail(null);
    setEvents([]);
    refresh();
    const buf: EventRow[] = [];
    let flush: number | undefined;
    const es = new EventSource(`/api/tasks/${id}/stream`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as EventRow;
      buf.push(e);
      // Batch bursts of events into one render.
      if (flush === undefined)
        flush = requestAnimationFrame(() => {
          const batch = buf.splice(0);
          flush = undefined;
          setEvents((prev) => {
            const last = prev.length ? prev[prev.length - 1].id : 0;
            const fresh = batch.filter((x) => x.id > last);
            return fresh.length ? [...prev, ...fresh] : prev;
          });
        });
      if (/status|created|pr|setup|verdict|evaluation|diagnosis/.test(e.kind)) {
        clearTimeout(timer.current);
        timer.current = setTimeout(refresh, 120);
      }
    };
    return () => {
      es.close();
      if (flush !== undefined) cancelAnimationFrame(flush);
      clearTimeout(timer.current);
    };
  }, [id, refresh]);

  return { detail, events, connected, refresh };
}

/** Re-render every `ms` while `active` (for live durations). */
export function useTick(active: boolean, ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [active, ms]);
}
