// Generic agent loop shared by the coder, QA and debugger agents.
// Before every model call it: waits while paused, stops if cancelled, and drains the steering inbox.
import type { Bus } from "../bus.ts";
import type { Sandbox } from "../sandbox/sandbox.ts";
import { runTool, specsFor, type ToolContext } from "../tools/index.ts";
import type { ChatMessage, LLMProvider, Role } from "../types.ts";

export class TaskControl {
  paused = false;
  cancelled = false;
  private waiters: (() => void)[] = [];
  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
    this.waiters.splice(0).forEach((w) => w());
  }
  cancel() {
    this.cancelled = true;
    this.resume();
  }
  async waitIfPaused() {
    while (this.paused && !this.cancelled) await new Promise<void>((r) => this.waiters.push(r));
  }
}

export interface AgentRun {
  role: Exclude<Role, "orchestrator">;
  taskId: string;
  attemptId: string;
  runId: string; // unique per agent invocation, e.g. "qa-2"
  system: string;
  prompt: string;
  model?: string;
  provider: LLMProvider;
  sandbox: Sandbox;
  bus: Bus;
  control: TaskControl;
  getDiff: () => Promise<string>;
  maxSteps: number;
  commandTimeoutMs: number;
}

export interface AgentOutcome {
  result: { tool: string; args: Record<string, any> } | null;
  steps: number;
  stopped: "terminal" | "max_steps" | "no_action" | "cancelled" | "error";
  lastText: string;
  error?: string;
}

export async function runAgent(run: AgentRun): Promise<AgentOutcome> {
  const { bus, taskId, attemptId, role } = run;
  const emit = (kind: Parameters<Bus["emit"]>[3], data: any) => bus.emit(taskId, attemptId, role, kind, data);
  const messages: ChatMessage[] = [
    { role: "system", content: run.system },
    { role: "user", content: run.prompt },
  ];
  const ctx: ToolContext = {
    sandbox: run.sandbox,
    role,
    getDiff: run.getDiff,
    commandTimeoutMs: run.commandTimeoutMs,
    report: (status, message) => emit("report", { status, message, runId: run.runId }),
  };
  const tools = specsFor(role);
  let idle = 0;
  let lastText = "";

  for (let step = 1; step <= run.maxSteps; step++) {
    await run.control.waitIfPaused();
    if (run.control.cancelled) return { result: null, steps: step - 1, stopped: "cancelled", lastText };

    // Steering: messages the user (or the orchestrator) sent while we were working.
    const steer = bus.store.drainInbox(taskId, attemptId);
    for (const s of steer) {
      messages.push({
        role: "user",
        content: `[New instruction while you are working. Take it into account from now on.]\n${s.text}`,
      });
      emit("steer.delivered", { inboxId: s.id, text: s.text, runId: run.runId });
    }

    let res;
    try {
      res = await run.provider.chat({
        role,
        model: run.model,
        messages,
        tools,
        meta: { attemptId, agentRun: run.runId, step },
      });
    } catch (e: any) {
      emit("error", { message: `Model call failed: ${e.message}`, runId: run.runId });
      return { result: null, steps: step, stopped: "error", lastText, error: e.message };
    }
    if (res.usage) emit("usage", { ...res.usage, runId: run.runId });
    if (res.text?.trim()) {
      lastText = res.text;
      emit("llm.text", { text: res.text, runId: run.runId, step });
    }
    messages.push({ role: "assistant", content: res.text ?? "", toolCalls: res.toolCalls });

    if (!res.toolCalls.length) {
      if (++idle >= 2) return { result: null, steps: step, stopped: "no_action", lastText };
      messages.push({
        role: "user",
        content: `Keep going using the tools. When you are done, call ${terminalTool(role)}.`,
      });
      continue;
    }
    idle = 0;

    for (const tc of res.toolCalls) {
      emit("tool.call", { id: tc.id, name: tc.name, args: tc.args, runId: run.runId, step });
      const out = await runTool(tc.name, tc.args, ctx);
      emit("tool.result", { id: tc.id, name: tc.name, output: out.output.slice(0, 4000), error: out.error, runId: run.runId });
      messages.push({ role: "tool", toolCallId: tc.id, name: tc.name, content: out.output });
      if (out.terminal) return { result: ctx.result ?? null, steps: step, stopped: "terminal", lastText };
    }
  }
  return { result: null, steps: run.maxSteps, stopped: "max_steps", lastText };
}

function terminalTool(role: Role) {
  return role === "qa" ? "submit_verdict" : role === "debugger" ? "submit_diagnosis" : "finish";
}
