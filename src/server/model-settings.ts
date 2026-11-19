import { createModelKeyStore } from "./model-key-store.ts";
import { providerFromEnv } from "../llm/index.ts";
import type { LLMProvider } from "../types.ts";

const variables = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
} as const;

type ProviderId = keyof typeof variables;
type Keys = Partial<Record<ProviderId, string>>;

export function isModelProvider(value: unknown): value is ProviderId {
  return typeof value === "string" && Object.hasOwn(variables, value);
}

export function createModelSettings(home: string, demo?: LLMProvider, env = process.env) {
  const storage = createModelKeyStore(home);
  let keys: Keys = {};
  try {
    const { value, legacy } = storage.load();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    for (const [id, key] of Object.entries(value)) {
      if (!isModelProvider(id) || typeof key !== "string" || !key) throw new Error();
      keys[id] = key;
    }
    if (legacy) storage.save(keys);
  } catch {
    throw new Error("Nightshift could not read or migrate its saved model keys.");
  }

  function effectiveEnv(saved: Keys) {
    const config = { ...env };
    for (const id of Object.keys(variables) as ProviderId[]) {
      if (saved[id]) config[variables[id]] = saved[id];
    }
    return config;
  }

  function makeProvider(config: NodeJS.ProcessEnv): LLMProvider | undefined {
    if (demo) return demo;
    const explicit = config.NIGHTSHIFT_PROVIDER;
    if (explicit && isModelProvider(explicit) && !config[variables[explicit]]) return undefined;
    if (!explicit && !Object.values(variables).some((variable) => config[variable])) return undefined;
    return providerFromEnv(config);
  }

  let config = effectiveEnv(keys);
  let active = makeProvider(config);
  const provider: LLMProvider = {
    get name() { return active?.name ?? "unconfigured"; },
    async chat(request) {
      if (!active) throw new Error("Configure a model key in Settings → Models.");
      const secrets = [...Object.values(variables).map((name) => config[name]), config.OLLAMA_API_KEY]
        .filter((value): value is string => Boolean(value));
      try {
        return await active.chat(request);
      } catch (error) {
        let message = error instanceof Error ? error.message : "Model request failed.";
        for (const secret of secrets.sort((a, b) => b.length - a.length)) {
          message = message.replaceAll(secret, "[redacted]");
        }
        throw new Error(message);
      }
    },
  };

  return {
    provider,
    get ready() { return Boolean(active); },
    status: () => ({
      provider: provider.name,
      modelKeys: {
        openai: Boolean(config.OPENAI_API_KEY),
        anthropic: Boolean(config.ANTHROPIC_API_KEY),
        openrouter: Boolean(config.OPENROUTER_API_KEY),
      },
    }),
    save(id: ProviderId, key: string) {
      const next = { ...keys, [id]: key };
      const nextConfig = effectiveEnv(next);
      // Avoid resetting the provider's concurrency queue when a different provider's key changes.
      const nextName = demo?.name ?? (nextConfig.NIGHTSHIFT_PROVIDER ||
        (nextConfig.ANTHROPIC_API_KEY ? "anthropic" : nextConfig.OPENAI_API_KEY ? "openai" : "openrouter"));
      const nextProvider = active && (demo || (active.name === nextName && nextName !== id))
        ? active : makeProvider(nextConfig);
      storage.save(next);
      keys = next;
      config = nextConfig;
      active = nextProvider;
    },
  };
}

export type ModelSettings = ReturnType<typeof createModelSettings>;
