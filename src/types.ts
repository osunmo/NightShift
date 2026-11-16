// Shared types for Nightshift.

export type Role = "orchestrator" | "coder" | "qa" | "debugger";

export type TaskStatus =
  | "queued"
  | "planning"
  | "running"
  | "evaluating"
  | "done"
  | "failed"
  | "cancelled";

export type AttemptStatus =
  | "pending"
  | "setup"
  | "coding"
  | "qa"
  | "debugging"
  | "passed"
  | "failed"
  | "cancelled";

export interface TaskRow {
  id: string;
  prompt: string;
  repo: string; // git URL or local path
  baseBranch: string;
  status: TaskStatus;
  numAttempts: number;
  winnerAttemptId: string | null;
  prUrl: string | null;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Strategy {
  name: string; // short label, e.g. "minimal-fix"
  instructions: string; // extra guidance for the coder
  model?: string; // optional per-attempt model override
}

export interface AttemptRow {
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

/** Every observable step is an event. The UI, replay and the orchestrator all read events. */
export interface EventRow {
  id: number;
  taskId: string;
  attemptId: string | null;
  role: Role | "system" | "user";
  kind: EventKind;
  data: any;
  ts: string;
}

export type EventKind =
  | "task.created"
  | "task.status"
  | "plan"
  | "attempt.created"
  | "attempt.status"
  | "setup"
  | "llm.text"
  | "tool.call"
  | "tool.result"
  | "report" // child -> orchestrator: progress or result
  | "verdict" // QA verdict
  | "diagnosis" // debugger result
  | "steer" // user -> agents
  | "steer.delivered"
  | "evaluation" // orchestrator decision
  | "pr"
  | "error"
  | "usage";

export interface QAVerdict {
  pass: boolean;
  score: number; // 0..10
  testsPassed: boolean | null;
  testOutput: string;
  problems: string[];
  summary: string;
}

export interface ChildReport {
  status: "progress" | "done" | "blocked";
  message: string;
}

// ---------- LLM ----------

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, any>; // JSON schema (object)
}

export interface LLMResponse {
  text: string;
  toolCalls: ToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
}

export interface LLMRequest {
  role: Role;
  model?: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  /** Free-form tag used by the scripted provider in tests. */
  meta?: Record<string, any>;
}

export interface LLMProvider {
  name: string;
  chat(req: LLMRequest): Promise<LLMResponse>;
}
