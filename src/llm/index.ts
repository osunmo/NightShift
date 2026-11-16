import type { LLMProvider } from "../types.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { OpenAICompatibleProvider } from "./openai.ts";

/** Pick a provider from env. NIGHTSHIFT_PROVIDER = anthropic | openai | openrouter. */
export function providerFromEnv(env = process.env): LLMProvider {
  const which =
    env.NIGHTSHIFT_PROVIDER ||
    (env.ANTHROPIC_API_KEY ? "anthropic" : env.OPENAI_API_KEY ? "openai" : env.OPENROUTER_API_KEY ? "openrouter" : "");
  switch (which) {
    case "anthropic":
      return new AnthropicProvider(need(env, "ANTHROPIC_API_KEY"), env.NIGHTSHIFT_MODEL || "claude-sonnet-5-5");
    case "openai":
      return new OpenAICompatibleProvider(
        "openai",
        need(env, "OPENAI_API_KEY"),
        env.OPENAI_BASE_URL || "https://api.openai.com/v1",
        env.NIGHTSHIFT_MODEL || "gpt-5"
      );
    case "openrouter":
      return new OpenAICompatibleProvider(
        "openrouter",
        need(env, "OPENROUTER_API_KEY"),
        "https://openrouter.ai/api/v1",
        env.NIGHTSHIFT_MODEL || "anthropic/claude-sonnet-5.5"
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
