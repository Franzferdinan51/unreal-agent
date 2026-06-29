// Unreal Agent — Provider registry
// Cloud-only: MiniMax primary, Grok + OpenRouter as fallbacks.

import type { ProviderConfig } from "../types.js";

const BUILTIN_PROVIDERS: Record<string, ProviderConfig> = {
  minimax: {
    id: "minimax",
    label: "MiniMax",
    defaultBaseUrl: "https://api.minimax.io/v1",
    defaultModel: "minimax-portal/MiniMax-M2.7",
    apiKeyEnv: ["MINIMAX_API_KEY"],
    baseUrlEnv: ["MINIMAX_BASE_URL"],
    modelEnv: ["MINIMAX_MODEL"],
    description: "Primary cloud provider — MiniMax M2.7 / M3 / M2.5.",
  },

  grok: {
    id: "grok",
    label: "Grok / xAI",
    defaultBaseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-4.3",
    apiKeyEnv: ["GROK_API_KEY", "XAI_API_KEY"],
    baseUrlEnv: ["GROK_BASE_URL", "XAI_BASE_URL"],
    modelEnv: ["GROK_MODEL", "XAI_MODEL"],
    description: "xAI Grok — grok-4.3 (2M ctx). Hard UE problems.",
  },

  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "deepseek/deepseek-v4-pro",
    apiKeyEnv: ["OPENROUTER_API_KEY"],
    baseUrlEnv: ["OPENROUTER_BASE_URL"],
    modelEnv: ["OPENROUTER_MODEL"],
    description: "OpenRouter — many models, free tier available.",
  },

  openai: {
    id: "openai",
    label: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1",
    apiKeyEnv: ["OPENAI_API_KEY"],
    baseUrlEnv: ["OPENAI_BASE_URL"],
    modelEnv: ["OPENAI_MODEL"],
    description: "OpenAI direct API.",
  },

  lmstudio: {
    id: "lmstudio",
    label: "LM Studio",
    defaultBaseUrl: "http://127.0.0.1:1234/v1",
    defaultModel: "local-model",
    apiKeyEnv: ["LMSTUDIO_API_KEY"],
    baseUrlEnv: ["LMSTUDIO_BASE_URL"],
    modelEnv: ["LMSTUDIO_MODEL"],
    description: "Local OpenAI-compatible runtime served by LM Studio.",
  },

  ollama: {
    id: "ollama",
    label: "Ollama",
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
    defaultModel: "llama3.1",
    apiKeyEnv: ["OLLAMA_API_KEY"],
    baseUrlEnv: ["OLLAMA_BASE_URL"],
    modelEnv: ["OLLAMA_MODEL"],
    description: "Local OpenAI-compatible runtime served by Ollama.",
  },
};

let customProviders: Record<string, ProviderConfig> = {};

function envPrefixFor(id: string): string {
  return id.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase();
}

function normalizeProviderConfig(id: string, config: Partial<ProviderConfig>): ProviderConfig | null {
  const normalizedId = id.trim().toLowerCase();
  if (!normalizedId) return null;
  const prefix = envPrefixFor(normalizedId);
  return {
    id: normalizedId,
    label: config.label?.trim() || normalizedId,
    defaultBaseUrl: config.defaultBaseUrl?.trim() || "",
    defaultModel: config.defaultModel?.trim() || "",
    apiKeyEnv: config.apiKeyEnv?.length ? config.apiKeyEnv : [`${prefix}_API_KEY`],
    baseUrlEnv: config.baseUrlEnv?.length ? config.baseUrlEnv : [`${prefix}_BASE_URL`],
    modelEnv: config.modelEnv?.length ? config.modelEnv : [`${prefix}_MODEL`],
    description: config.description?.trim() || undefined,
  };
}

function allProviders(): Record<string, ProviderConfig> {
  return { ...BUILTIN_PROVIDERS, ...customProviders };
}

export function setCustomProviders(providers: Record<string, Partial<ProviderConfig>> | undefined): void {
  const next: Record<string, ProviderConfig> = {};
  for (const [id, config] of Object.entries(providers ?? {})) {
    const normalized = normalizeProviderConfig(id, config);
    if (!normalized) continue;
    next[normalized.id] = normalized;
  }
  customProviders = next;
}

export function getProvider(id: string): ProviderConfig | undefined {
  return allProviders()[id.trim().toLowerCase()];
}

export function listProviders(): ProviderConfig[] {
  return Object.values(allProviders()).sort((a, b) => a.id.localeCompare(b.id));
}

export function firstEnvValue(keys: string[] | undefined): string | undefined {
  if (!keys) return undefined;
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

export function resolveProvider(id: string): {
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
} {
  const p = getProvider(id);
  if (!p) throw new Error(`Unknown provider: ${id}. Run \`unreal-agent provider list\`.`);
  const baseUrl = firstEnvValue(p.baseUrlEnv) ?? p.defaultBaseUrl;
  const apiKey = firstEnvValue(p.apiKeyEnv);
  const model = firstEnvValue(p.modelEnv) ?? p.defaultModel;
  return { baseUrl, apiKey, model };
}

export type ProviderRuntime = {
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
};

/** Resolve every provider to its runtime, keyed by id. */
export function resolveAll(): Map<string, ProviderRuntime> {
  const m = new Map<string, ProviderRuntime>();
  for (const id of Object.keys(allProviders())) {
    try {
      m.set(id, resolveProvider(id));
    } catch {
      /* skip unresolved */
    }
  }
  return m;
}

export type ProviderRegistry = Map<string, ProviderRuntime>;
