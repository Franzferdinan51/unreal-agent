// Unreal Agent — MoA Runtime
// Architecture from Agent Teams moa/moa-runtime.js + trimmed advisory view from Hermes.
//
// Pipeline (Agent Teams pattern):
//   1. trimForReference — build advisory view (user/assistant text only, no sysprompt, no tool_calls)
//   2. runReferencesParallel — fan out all refs in parallel (max 8 workers)
//   3. buildAggregatorPrompt — synthesis prompt injected with reference outputs
//   4. aggregator calls the model
//   5. [optional] runMoAWithTools — aggregator calls tools via toolsFn after synthesis
//
// Differences from Hermes moa_loop.py:
//   - No state-keyed reference cache (Agent Teams moa-runtime.js doesn't use one)
//   - Aggregator synthesis is a separate model call (not appended to the transcript)
//   - runMoAWithTools injects ref context into history BEFORE tool loop

import type {
  ChatMessage,
  MoAResult,
  MoARunOpts,
  ReferenceOutput,
} from "./types.js";
import { loadMoAConfig } from "./config-store.js";
import { callProvider } from "../../providers/client.js";
import { resolveAll } from "../../providers/registry.js";
import {
  extractText,
  MAX_REFERENCE_WORKERS,
  referenceMessages,
  REFERENCE_SYSTEM_PROMPT,
  resolveSlotRuntime,
} from "./advisory.js";

function slotLabel(slot: { provider: string; model: string }): string {
  return `${slot.provider}:${slot.model}`;
}

async function runReferencesParallel(
  slots: { provider: string; model: string }[],
  registry: ReturnType<typeof resolveAll>,
  refMessages: ChatMessage[],
  temperature: number,
  maxTokens: number,
): Promise<Array<[string, string]>> {
  if (!slots || slots.length === 0) return [];
  const refs = slots.slice(0, MAX_REFERENCE_WORKERS);
  const futures = refs.map((slot) => runReference(slot, registry, refMessages, temperature, maxTokens));
  return Promise.all(futures);
}

async function runReference(
  slot: { provider: string; model: string },
  registry: ReturnType<typeof resolveAll>,
  refMessages: ChatMessage[],
  temperature: number,
  maxTokens: number,
): Promise<[string, string]> {
  const label = slotLabel(slot);
  try {
    const runtime = resolveSlotRuntime(slot, registry);
    const messages: ChatMessage[] = [{ role: "system", content: REFERENCE_SYSTEM_PROMPT }, ...refMessages];
    const resp = await callProvider({
      provider: runtime.provider,
      model: runtime.model,
      messages,
      temperature,
      maxTokens,
      baseUrl: runtime.baseUrl,
      apiKey: runtime.apiKey,
    });
    const text = extractText(resp);
    return [label, text || "(empty response)"];
  } catch (exc: any) {
    return [label, `[failed: ${exc?.message ?? exc}]`];
  }
}

// ── Aggregator synthesis prompt ───────────────────────────────────────────────

function buildAggregatorPrompt(
  userPrompt: string,
  referenceOutputs: Array<[string, string]>,
  presetName: string,
  aggregatorLabel: string,
): string {
  const joined = referenceOutputs
    .map(([label, text], i) => `Reference ${i + 1} — ${label}:\n${text}`)
    .join("\n\n");

  return `You are the aggregator in a Mixture of Agents process. The references below have analyzed the user's prompt and provided their perspectives. Synthesize their advice into a concise, actionable response. Focus on next steps, strategy, risks, and disagreements. Do not simply list what each reference said — synthesize into a unified recommendation.

Original user prompt:
${userPrompt}

Reference responses:
${joined}

Your synthesized response:`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Run MoA (Agent Teams moa-runtime.js signature). */
export async function runMoA(opts: MoARunOpts): Promise<MoAResult> {
  const cfg = await loadMoAConfig();
  const registry = resolveAll();
  const presetName = opts.presetName ?? cfg.moa.default_preset ?? "default";
  const preset = cfg.moa.presets?.[presetName];

  if (!preset) {
    throw new Error(
      `MoA preset '${presetName}' not found. Run \`unreal-agent moa list\` to see available presets.`,
    );
  }

  const history = opts.history ?? [];
  const messages: ChatMessage[] = [
    ...history.filter((m) => m.role !== "system"),
    { role: "user", content: opts.prompt },
  ];

  const references: ReferenceOutput[] = [];

  if (preset.enabled !== false && preset.reference_models?.length > 0) {
    // Step 1: trimmed advisory view
    const refMessages = referenceMessages(messages);

    // Step 2: fan out references in parallel
    const outputs = await runReferencesParallel(
      preset.reference_models,
      registry,
      refMessages,
      preset.reference_temperature ?? 0.6,
      preset.reference_max_tokens ?? 1024,
    );

    for (const [label, text] of outputs) {
      references.push({ label, text });
    }
  }

  // Step 3: aggregator synthesizes
  const aggLabel = slotLabel(preset.aggregator);
  const synthPrompt = buildAggregatorPrompt(opts.prompt, references.map((r) => [r.label, r.text]), presetName, aggLabel);

  let aggResp = "";
  try {
    const runtime = resolveSlotRuntime(preset.aggregator, registry);
    const resp = await callProvider({
      provider: runtime.provider,
      model: runtime.model,
      messages: [{ role: "user", content: synthPrompt }],
      temperature: preset.aggregator_temperature ?? 0.4,
      maxTokens: 2048,
      baseUrl: runtime.baseUrl,
      apiKey: runtime.apiKey,
    });
    aggResp = extractText(resp) || "(empty response)";
  } catch (exc: any) {
    aggResp = `[aggregator failed: ${exc?.message ?? exc}]`;
  }

  const result: MoAResult = {
    response: aggResp,
    references,
    preset: presetName,
    aggregator: aggLabel,
  };

  // Step 4: [optional] tool calling — Agent Teams runMoAWithTools pattern
  if (opts.toolsFn && opts.tools && opts.tools.length > 0) {
    const refCtx = references
      .map((r, i) => `Reference ${i + 1} — ${r.label}:\n${r.text}`)
      .join("\n\n");
    const contextMsg: ChatMessage = {
      role: "system",
      content: `[MoA Reference Context]\n${refCtx}`,
    };
    const fullHistory: ChatMessage[] = [
      ...history,
      { role: "user", content: opts.prompt },
      { role: "assistant", content: aggResp },
      contextMsg,
    ];
    const toolResult = await opts.toolsFn(presetName, fullHistory, opts.tools);
    result.toolResult = toolResult;
  }

  return result;
}
