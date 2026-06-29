// Unreal Agent — MoA presets (cloud-only models)
// Schema aligned with Agent Teams moa/config.json.
// LM Studio removed per Duckets 2026-06-10 directive.

import type { MoAPresetConfig, MoAConfig } from "./types.js";

/** Cloud-only built-in presets. Each mirrors an Agent Teams preset
 *  but uses MiniMax / Grok / OpenRouter instead of LM Studio. */
export const BUILTIN_PRESETS: Record<string, MoAPresetConfig> = {
  tiny: {
    description:
      "Testing preset — single reference, single aggregator. Verify MoA wiring works before larger presets.",
    enabled: true,
    reference_models: [
      { provider: "minimax", model: "minimax-portal/MiniMax-M2.5" },
    ],
    aggregator: { provider: "minimax", model: "minimax-portal/MiniMax-M2.5" },
    reference_temperature: 0.6,
    aggregator_temperature: 0.4,
    reference_max_tokens: 128,
  },

  default: {
    description:
      "General-purpose MoA: MiniMax-M2.7 + Grok references, MiniMax-M3 aggregator. Balanced speed and quality.",
    enabled: true,
    reference_models: [
      { provider: "minimax", model: "minimax-portal/MiniMax-M2.7" },
      { provider: "grok", model: "grok-4.3" },
      { provider: "openrouter", model: "deepseek/deepseek-v4-pro" },
    ],
    aggregator: { provider: "minimax", model: "minimax-portal/MiniMax-M3" },
    reference_temperature: 0.6,
    aggregator_temperature: 0.4,
    reference_max_tokens: 1024,
  },

  coding: {
    description:
      "Coding-focused MoA: Grok + OpenRouter code-model references, MiniMax-M3 aggregator.",
    enabled: true,
    reference_models: [
      { provider: "grok", model: "grok-4.3" },
      { provider: "openrouter", model: "qwen/qwen-2.5-coder-32b-instruct" },
    ],
    aggregator: { provider: "minimax", model: "minimax-portal/MiniMax-M3" },
    reference_temperature: 0.5,
    aggregator_temperature: 0.3,
    reference_max_tokens: 1024,
  },

  security: {
    description:
      "Security-focused MoA: Grok + MiniMax-M3 references, Grok-4.3 aggregator.",
    enabled: true,
    reference_models: [
      { provider: "minimax", model: "minimax-portal/MiniMax-M3" },
      { provider: "grok", model: "grok-4.3" },
    ],
    aggregator: { provider: "grok", model: "grok-4.3" },
    reference_temperature: 0.3,
    aggregator_temperature: 0.1,
    reference_max_tokens: 768,
  },
};

/** Load + merge user presets from disk with built-in defaults.
 *  User presets override built-ins with the same name. */
export function mergePresets(disk: MoAConfig | null): MoAConfig {
  const diskPresets = disk?.moa?.presets ?? {};
  const presets = { ...BUILTIN_PRESETS };
  for (const [name, p] of Object.entries(diskPresets)) {
    if (!name.trim()) continue;
    // Validate — skip recursive MoA presets
    const agg = (p as any).aggregator;
    if (agg?.provider?.toLowerCase() === "moa") continue;
    const hasRecursive = ((p as any).reference_models ?? []).some(
      (r: any) => r?.provider?.toLowerCase() === "moa",
    );
    if (hasRecursive) continue;
    presets[name] = p as MoAPresetConfig;
  }
  const defaultName =
    disk?.moa?.default_preset?.trim() ||
    Object.keys(presets)[0] ||
    "default";
  return {
    moa: {
      default_preset: defaultName in presets ? defaultName : Object.keys(presets)[0] ?? "default",
      presets,
    },
  };
}
