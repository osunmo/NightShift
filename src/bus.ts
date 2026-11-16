// Event bus: persist every event, then broadcast it to live listeners (SSE, orchestrator mailboxes).
import { EventEmitter } from "node:events";
import type { EventKind, EventRow, Role } from "./types.ts";
import type { Store } from "./store/db.ts";

export class Bus {
  private ee = new EventEmitter();
  constructor(public store: Store) {
    this.ee.setMaxListeners(1000);
  }

  emit(taskId: string, attemptId: string | null, role: EventRow["role"], kind: EventKind, data: any): EventRow {
    const ev = this.store.addEvent({ taskId, attemptId, role, kind, data });
    this.ee.emit(`task:${taskId}`, ev);
    this.ee.emit("event", ev);
    return ev;
  }

  onTask(taskId: string, fn: (e: EventRow) => void): () => void {
    this.ee.on(`task:${taskId}`, fn);
    return () => this.ee.off(`task:${taskId}`, fn);
  }

  onAny(fn: (e: EventRow) => void): () => void {
    this.ee.on("event", fn);
    return () => this.ee.off("event", fn);
  }
}

/** A child agent's handle for talking to the orchestrator. */
export interface ReportChannel {
  report(role: Role, status: "progress" | "done" | "blocked", message: string): void;
}
