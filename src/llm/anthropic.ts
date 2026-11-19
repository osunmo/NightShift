// Anthropic Messages API with tool use, via fetch (no SDK dependency).
import type { ChatMessage, LLMProvider, LLMRequest, LLMResponse } from "../types.ts";

export class AnthropicProvider implements LLMProvider {
  name = "anthropic";
  constructor(
    private apiKey: string,
    private defaultModel = process.env.NIGHTSHIFT_MODEL || "claude-sonnet-5-5",
    private baseUrl = process.env.NIGHTSHIFT_ANTHROPIC_BASE_URL || "https://api.anthropic.com",
    private maxTokens = 8192
  ) {}

  async chat(req: LLMRequest): Promise<LLMResponse> {
    const system = req.messages
      .filter((m) => m.role === "system")
      .map((m) => (m as any).content)
      .join("\n\n");
    const messages = toAnthropicMessages(req.messages.filter((m) => m.role !== "system"));
    const body = {
      model: req.model || this.defaultModel,
      max_tokens: this.maxTokens,
      system,
      messages,
      tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
    };
    const res = await fetchWithRetry(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    const json: any = await res.json();
    let text = "";
    const toolCalls = [];
    for (const block of json.content ?? []) {
      if (block.type === "text") text += block.text;
      if (block.type === "tool_use") toolCalls.push({ id: block.id, name: block.name, args: block.input ?? {} });
    }
    return {
      text,
      toolCalls,
      usage: { inputTokens: json.usage?.input_tokens ?? 0, outputTokens: json.usage?.output_tokens ?? 0 },
    };
  }
}

function toAnthropicMessages(msgs: ChatMessage[]): any[] {
  const out: any[] = [];
  for (const m of msgs) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      const content: any[] = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls ?? []) content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args });
      out.push({ role: "assistant", content: content.length ? content : [{ type: "text", text: "(no output)" }] });
    } else if (m.role === "tool") {
      const block = { type: "tool_result", tool_use_id: m.toolCallId, content: m.content || "(empty)" };
      const last = out[out.length - 1];
      // Consecutive tool results must share one user turn.
      if (last && last.role === "user" && Array.isArray(last.content) && last.content[0]?.type === "tool_result")
        last.content.push(block);
      else out.push({ role: "user", content: [block] });
    }
  }
  // Merge user text that follows tool results into the same turn (Anthropic requires alternation).
  const merged: any[] = [];
  for (const m of out) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) {
      const a = Array.isArray(last.content) ? last.content : [{ type: "text", text: last.content }];
      const b = Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }];
      last.content = [...a, ...b];
    } else merged.push(m);
  }
  return merged;
}

export async function fetchWithRetry(url: string, init: RequestInit, tries = 4): Promise<Response> {
  let lastErr: any;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      const body = await res.text();
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
        await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
        continue;
      }
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 500)}`);
    } catch (e: any) {
      lastErr = e;
      if (String(e.message).startsWith("HTTP 4")) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw lastErr;
}
