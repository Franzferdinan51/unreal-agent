// Unreal Agent — Provider registry
// Cloud-only: MiniMax primary, Grok + OpenRouter as fallbacks.

import type { ProviderConfig } from "../types.js";

const PROVIDERS: Record<string, ProviderConfig> = {
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
};

export function getProvider(id: string): ProviderConfig | undefined {
  return PROVIDERS[id];
}

export function listProviders(): ProviderConfig[] {
  return Object.values(PROVIDERS);
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
  for (const id of Object.keys(PROVIDERS)) {
    try {
      m.set(id, resolveProvider(id));
    } catch {
      /* skip unresolved */
    }
  }
  return m;
}

export type ProviderRegistry = Map<string, ProviderRuntime>;
