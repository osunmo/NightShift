// OpenAI-compatible Chat Completions with tools. Works for OpenAI and OpenRouter (set base URL).
import type { ChatMessage, LLMProvider, LLMRequest, LLMResponse } from "../types.ts";
import { fetchWithRetry } from "./anthropic.ts";

export class OpenAICompatibleProvider implements LLMProvider {
  constructor(
    public name: string,
    private apiKey: string,
    private baseUrl: string,
    private defaultModel: string
  ) {}

  async chat(req: LLMRequest): Promise<LLMResponse> {
    const body: any = {
      model: req.model || this.defaultModel,
      messages: req.messages.map(toOpenAI),
    };
    if (req.tools.length)
      body.tools = req.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    const res = await fetchWithRetry(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    });
    const json: any = await res.json();
    const msg = json.choices?.[0]?.message ?? {};
    return {
      text: msg.content ?? "",
      toolCalls: (msg.tool_calls ?? []).map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        args: safeJson(tc.function.arguments),
      })),
      usage: { inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: json.usage?.completion_tokens ?? 0 },
    };
  }
}

function toOpenAI(m: ChatMessage): any {
  if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
  if (m.role === "assistant")
    return {
      role: "assistant",
      content: m.content || null,
      tool_calls: m.toolCalls?.length
        ? m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          }))
        : undefined,
    };
  return { role: m.role, content: m.content };
}

function safeJson(s: string): any {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
}
