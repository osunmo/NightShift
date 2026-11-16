// SQLite-backed store (node:sqlite, no native deps). Swap for Postgres later behind the same functions.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AttemptRow, EventRow, Strategy, TaskRow } from "../types.ts";
import { randomUUID } from "node:crypto";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, prompt TEXT NOT NULL, repo TEXT NOT NULL, base_branch TEXT NOT NULL,
  status TEXT NOT NULL, num_attempts INTEGER NOT NULL, winner_attempt_id TEXT, pr_url TEXT,
  summary TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, idx INTEGER NOT NULL, strategy TEXT NOT NULL,
  status TEXT NOT NULL, branch TEXT NOT NULL, workdir TEXT NOT NULL, fix_rounds INTEGER NOT NULL DEFAULT 0,
  score REAL, diff TEXT, setup_ms INTEGER, setup_cached INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, attempt_id TEXT, role TEXT NOT NULL,
  kind TEXT NOT NULL, data TEXT NOT NULL, ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_task ON events(task_id, id);
CREATE TABLE IF NOT EXISTS inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, attempt_id TEXT, text TEXT NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0, ts TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS inbox_seen (
  inbox_id INTEGER NOT NULL, attempt_id TEXT NOT NULL, PRIMARY KEY (inbox_id, attempt_id)
);
CREATE TABLE IF NOT EXISTS snapshots (
  key TEXT PRIMARY KEY, path TEXT NOT NULL, bytes INTEGER NOT NULL, created_at TEXT NOT NULL, hits INTEGER NOT NULL DEFAULT 0
);
`;

const now = () => new Date().toISOString();

export class Store {
  db: DatabaseSync;

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
  }

  // ----- tasks -----
  createTask(t: { prompt: string; repo: string; baseBranch: string; numAttempts: number }): TaskRow {
    const id = "t_" + randomUUID().slice(0, 8);
    const ts = now();
    this.db
      .prepare(
        `INSERT INTO tasks (id,prompt,repo,base_branch,status,num_attempts,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`
      )
      .run(id, t.prompt, t.repo, t.baseBranch, "queued", t.numAttempts, ts, ts);
    return this.getTask(id)!;
  }

  getTask(id: string): TaskRow | null {
    const r: any = this.db.prepare(`SELECT * FROM tasks WHERE id=?`).get(id);
    return r ? mapTask(r) : null;
  }

  listTasks(): TaskRow[] {
    return (this.db.prepare(`SELECT * FROM tasks ORDER BY created_at DESC`).all() as any[]).map(mapTask);
  }

  updateTask(id: string, patch: Partial<Pick<TaskRow, "status" | "winnerAttemptId" | "prUrl" | "summary">>) {
    const cols: Record<string, string> = {
      status: "status",
      winnerAttemptId: "winner_attempt_id",
      prUrl: "pr_url",
      summary: "summary",
    };
    for (const [k, v] of Object.entries(patch)) {
      this.db.prepare(`UPDATE tasks SET ${cols[k]}=?, updated_at=? WHERE id=?`).run(v as any, now(), id);
    }
  }

  // ----- attempts -----
  createAttempt(a: { taskId: string; index: number; strategy: Strategy; branch: string; workdir: string }): AttemptRow {
    const id = `a_${a.taskId.slice(2)}_${a.index}`;
    const ts = now();
    this.db
      .prepare(
        `INSERT INTO attempts (id,task_id,idx,strategy,status,branch,workdir,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run(id, a.taskId, a.index, JSON.stringify(a.strategy), "pending", a.branch, a.workdir, ts, ts);
    return this.getAttempt(id)!;
  }

  getAttempt(id: string): AttemptRow | null {
    const r: any = this.db.prepare(`SELECT * FROM attempts WHERE id=?`).get(id);
    return r ? mapAttempt(r) : null;
  }

  listAttempts(taskId: string): AttemptRow[] {
    return (this.db.prepare(`SELECT * FROM attempts WHERE task_id=? ORDER BY idx`).all(taskId) as any[]).map(
      mapAttempt
    );
  }

  updateAttempt(
    id: string,
    patch: Partial<Pick<AttemptRow, "status" | "fixRounds" | "score" | "diff" | "setupMs" | "setupCached">>
  ) {
    const cols: Record<string, string> = {
      status: "status",
      fixRounds: "fix_rounds",
      score: "score",
      diff: "diff",
      setupMs: "setup_ms",
      setupCached: "setup_cached",
    };
    for (const [k, v] of Object.entries(patch)) {
      const val = typeof v === "boolean" ? (v ? 1 : 0) : v;
      this.db.prepare(`UPDATE attempts SET ${cols[k]}=?, updated_at=? WHERE id=?`).run(val as any, now(), id);
    }
  }

  // ----- events -----
  addEvent(e: Omit<EventRow, "id" | "ts">): EventRow {
    const ts = now();
    const res = this.db
      .prepare(`INSERT INTO events (task_id,attempt_id,role,kind,data,ts) VALUES (?,?,?,?,?,?)`)
      .run(e.taskId, e.attemptId, e.role, e.kind, JSON.stringify(e.data ?? null), ts);
    return { ...e, id: Number(res.lastInsertRowid), ts };
  }

  listEvents(taskId: string, afterId = 0): EventRow[] {
    return (
      this.db.prepare(`SELECT * FROM events WHERE task_id=? AND id>? ORDER BY id`).all(taskId, afterId) as any[]
    ).map((r) => ({
      id: r.id,
      taskId: r.task_id,
      attemptId: r.attempt_id,
      role: r.role,
      kind: r.kind,
      data: JSON.parse(r.data),
      ts: r.ts,
    }));
  }

  // ----- inbox (steering) -----
  /** attemptId null = broadcast to every active agent of the task. */
  pushInbox(taskId: string, attemptId: string | null, text: string) {
    this.db.prepare(`INSERT INTO inbox (task_id,attempt_id,text,ts) VALUES (?,?,?,?)`).run(taskId, attemptId, text, now());
  }

  /**
   * Take undelivered steering messages for one attempt. Broadcast messages (attempt_id NULL) are
   * delivered once to every attempt; targeted ones only to their attempt.
   */
  drainInbox(taskId: string, attemptId: string): { id: number; text: string }[] {
    const rows = this.db
      .prepare(
        `SELECT i.id, i.text FROM inbox i
         WHERE i.task_id=? AND (i.attempt_id=? OR i.attempt_id IS NULL)
           AND NOT EXISTS (SELECT 1 FROM inbox_seen s WHERE s.inbox_id=i.id AND s.attempt_id=?)
         ORDER BY i.id`
      )
      .all(taskId, attemptId, attemptId) as any[];
    const mark = this.db.prepare(`INSERT OR IGNORE INTO inbox_seen (inbox_id,attempt_id) VALUES (?,?)`);
    for (const r of rows) mark.run(r.id, attemptId);
    return rows.map((r) => ({ id: r.id, text: r.text }));
  }

  // ----- snapshots (setup cache) -----
  getSnapshot(key: string): { key: string; path: string; bytes: number } | null {
    const r: any = this.db.prepare(`SELECT * FROM snapshots WHERE key=?`).get(key);
    return r ? { key: r.key, path: r.path, bytes: r.bytes } : null;
  }
  putSnapshot(key: string, path: string, bytes: number) {
    this.db
      .prepare(`INSERT OR REPLACE INTO snapshots (key,path,bytes,created_at,hits) VALUES (?,?,?,?,0)`)
      .run(key, path, bytes, now());
  }
  hitSnapshot(key: string) {
    this.db.prepare(`UPDATE snapshots SET hits=hits+1 WHERE key=?`).run(key);
  }
}

function mapTask(r: any): TaskRow {
  return {
    id: r.id,
    prompt: r.prompt,
    repo: r.repo,
    baseBranch: r.base_branch,
    status: r.status,
    numAttempts: r.num_attempts,
    winnerAttemptId: r.winner_attempt_id,
    prUrl: r.pr_url,
    summary: r.summary,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapAttempt(r: any): AttemptRow {
  return {
    id: r.id,
    taskId: r.task_id,
    index: r.idx,
    strategy: JSON.parse(r.strategy),
    status: r.status,
    branch: r.branch,
    workdir: r.workdir,
    fixRounds: r.fix_rounds,
    score: r.score,
    diff: r.diff,
    setupMs: r.setup_ms,
    setupCached: !!r.setup_cached,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
