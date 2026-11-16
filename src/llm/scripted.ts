// Deterministic provider for tests and offline demos. You supply a function that decides each turn.
import type { LLMProvider, LLMRequest, LLMResponse, ToolCall } from "../types.ts";

export type ScriptFn = (req: LLMRequest, turn: number) => LLMResponse | Promise<LLMResponse>;

export class ScriptedProvider implements LLMProvider {
  name = "scripted";
  calls: LLMRequest[] = [];
  private turns = new Map<string, number>();
  constructor(private script: ScriptFn) {}

  async chat(req: LLMRequest): Promise<LLMResponse> {
    this.calls.push(structuredClone(req));
    const key = `${req.role}:${req.meta?.attemptId ?? ""}:${req.meta?.agentRun ?? ""}`;
    const turn = this.turns.get(key) ?? 0;
    this.turns.set(key, turn + 1);
    return this.script(req, turn);
  }
}

let n = 0;
export function call(name: string, args: Record<string, any>): ToolCall {
  return { id: `call_${++n}`, name, args };
}
export function respond(text: string, ...toolCalls: ToolCall[]): LLMResponse {
  return { text, toolCalls };
}
