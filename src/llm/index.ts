import type { LLMProvider } from "../types.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { OpenAICompatibleProvider } from "./openai.ts";

/** Pick a provider from env. NIGHTSHIFT_PROVIDER = anthropic | openai | openrouter | ollama. */
export function providerFromEnv(env = process.env): LLMProvider {
  const p = baseProvider(env);
  // Some plans allow only a few requests at once (Ollama Cloud's free plan allows 1). Parallel
  // agents then queue their calls here instead of failing with "too many requests".
  const n = Number(env.NIGHTSHIFT_LLM_CONCURRENCY || 0);
  return n > 0 ? limitConcurrency(p, n) : p;
}

/** At most `n` model calls in flight; the rest wait their turn, in order. */
export function limitConcurrency(p: LLMProvider, n: number): LLMProvider {
  let active = 0;
  const waiting: (() => void)[] = [];
  return {
    name: p.name,
    async chat(req) {
      if (active >= n) await new Promise<void>((r) => waiting.push(r));
      active++;
      try {
        return await p.chat(req);
      } finally {
        active--;
        waiting.shift()?.();
      }
    },
  };
}

function baseProvider(env: NodeJS.ProcessEnv): LLMProvider {
  // Longest reply per model call. Lower it to make each call cheaper (and to fit a small credit balance).
  const maxTokens = Number(env.NIGHTSHIFT_MAX_TOKENS || 8192);
  const which =
    env.NIGHTSHIFT_PROVIDER ||
    (env.ANTHROPIC_API_KEY ? "anthropic" : env.OPENAI_API_KEY ? "openai" : env.OPENROUTER_API_KEY ? "openrouter" : "");
  switch (which) {
    case "anthropic":
      return new AnthropicProvider(need(env, "ANTHROPIC_API_KEY"), env.NIGHTSHIFT_MODEL || "claude-sonnet-5-5", undefined, maxTokens);
    case "openai":
      return new OpenAICompatibleProvider(
        "openai",
        need(env, "OPENAI_API_KEY"),
        env.OPENAI_BASE_URL || "https://api.openai.com/v1",
        env.NIGHTSHIFT_MODEL || "gpt-5",
        maxTokens
      );
    case "ollama":
      // Ollama's OpenAI-compatible API: local (default) or Ollama Cloud with
      // OLLAMA_BASE_URL=https://ollama.com/v1 and OLLAMA_API_KEY. The model must support tool calling.
      // Local only: give Ollama a long context (OLLAMA_CONTEXT_LENGTH=32768).
      return new OpenAICompatibleProvider(
        "ollama",
        env.OLLAMA_API_KEY || "ollama",
        env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
        env.NIGHTSHIFT_MODEL || "qwen2.5-coder:7b",
        maxTokens
      );
    case "openrouter":
      return new OpenAICompatibleProvider(
        "openrouter",
        need(env, "OPENROUTER_API_KEY"),
        "https://openrouter.ai/api/v1",
        env.NIGHTSHIFT_MODEL || "anthropic/claude-sonnet-5.5",
        maxTokens
      );
    default:
      throw new Error(
        "No model provider configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY or OPENROUTER_API_KEY (see .env.example)."
      );
  }
}

function need(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`${key} is not set`);
  return v;
}
