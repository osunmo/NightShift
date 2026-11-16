// Provider wire formats, checked against a mocked fetch (no network, no API key).
import test from "node:test";
import assert from "node:assert/strict";
import { AnthropicProvider } from "../src/llm/anthropic.ts";
import { OpenAICompatibleProvider } from "../src/llm/openai.ts";
import type { ChatMessage } from "../src/types.ts";

const history: ChatMessage[] = [
  { role: "system", content: "sys" },
  { role: "user", content: "fix it" },
  { role: "assistant", content: "looking", toolCalls: [{ id: "t1", name: "read_file", args: { path: "a" } }, { id: "t2", name: "list_dir", args: {} }] },
  { role: "tool", toolCallId: "t1", name: "read_file", content: "A" },
  { role: "tool", toolCallId: "t2", name: "list_dir", content: "B" },
  { role: "user", content: "[steer] also do X" },
];
const tools = [{ name: "read_file", description: "d", parameters: { type: "object", properties: {} } }];

function mockFetch(reply: any) {
  const seen: any[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: any) => {
    seen.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as any;
  return { seen, restore: () => (globalThis.fetch = orig) };
}

test("anthropic: tool results grouped in one user turn, steering merged, tool_use parsed", async () => {
  const m = mockFetch({ content: [{ type: "text", text: "ok" }, { type: "tool_use", id: "u1", name: "read_file", input: { path: "b" } }], usage: { input_tokens: 10, output_tokens: 5 } });
  try {
    const res = await new AnthropicProvider("k", "model-x").chat({ role: "coder", messages: history, tools });
    const { body, headers } = m.seen[0];
    assert.equal(headers["x-api-key"], "k");
    assert.equal(body.system, "sys");
    assert.deepEqual(body.messages.map((x: any) => x.role), ["user", "assistant", "user"], "roles alternate");
    const last = body.messages[2].content;
    assert.deepEqual(last.map((b: any) => b.type), ["tool_result", "tool_result", "text"]);
    assert.equal(body.tools[0].input_schema.type, "object");
    assert.deepEqual(res.toolCalls, [{ id: "u1", name: "read_file", args: { path: "b" } }]);
    assert.equal(res.usage!.inputTokens, 10);
  } finally {
    m.restore();
  }
});

test("openai-compatible: tool_calls and tool messages round-trip", async () => {
  const m = mockFetch({ choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: '{"path":"x"}' } }] } }], usage: { prompt_tokens: 3, completion_tokens: 2 } });
  try {
    const res = await new OpenAICompatibleProvider("openai", "k", "https://example.com/v1", "m").chat({ role: "qa", messages: history, tools });
    const { url, body } = m.seen[0];
    assert.equal(url, "https://example.com/v1/chat/completions");
    assert.equal(body.messages[2].tool_calls[0].function.arguments, '{"path":"a"}');
    assert.equal(body.messages[3].role, "tool");
    assert.equal(body.messages[3].tool_call_id, "t1");
    assert.deepEqual(res.toolCalls[0], { id: "c1", name: "read_file", args: { path: "x" } });
  } finally {
    m.restore();
  }
});
