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
  MoAPresetConfig,
  MoAResult,
  MoARunOpts,
  ReferenceOutput,
  ToolSpec,
  ToolCallResult,
} from "./types.js";
import { loadMoAConfig } from "./config-store.js";
import { resolveAll } from "../../providers/registry.js";
import { callProvider } from "../../providers/client.js";

const MAX_WORKERS = 8;

function slotLabel(slot: { provider: string; model: string }): string {
  return `${slot.provider}:${slot.model}`;
}

// ── Text extraction (transport-tolerant) ──────────────────────────────────────

function extractText(response: any): string {
  try {
    if (response?.status === "error") return "";
    const raw = response?.choices?.[0]?.message?.content;
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  } catch { /* */ }
  try {
    const blocks = response?.content;
    if (Array.isArray(blocks)) {
      const text = blocks
        .filter((b: any) => b?.type === "text")
        .map((b: any) => b.text)
        .join("\n")
        .trim();
      if (text) return text;
    }
  } catch { /* */ }
  return "";
}

// ── Trimmed advisory view (Hermes) ────────────────────────────────────────────

/**
 * Build the trimmed advisory view for reference models.
 * User/assistant text only — no system prompt, no tool messages.
 * Matches Hermes moa_loop.py _reference_messages.
 */
function trimForReference(messages: ChatMessage[]): ChatMessage[] {
  const trimmed: ChatMessage[] = [];
  for (const msg of messages) {
    const role = msg.role;
    if (role !== "user" && role !== "assistant") continue;
    const content = typeof msg.content === "string" ? msg.content : "";
    if (!content.trim()) continue;
    trimmed.push({ role, content });
  }
  // Must end on a user turn — Hermes rule
  if (trimmed.length > 0 && trimmed[trimmed.length - 1].role === "assistant") {
    for (let i = trimmed.length - 2; i >= 0; i--) {
      if (trimmed[i].role === "user") {
        const instruction =
          "\n\n[The conversation above is the current state of the task. " +
          "Give your most intelligent judgement: what is going on, what should " +
          "happen next, and how should the acting agent proceed?]";
        trimmed[i] = { ...trimmed[i], content: trimmed[i].content + instruction };
        break;
      }
    }
  }
  return trimmed;
}

// ── Reference system prompt (Hermes) ─────────────────────────────────────────

const REFERENCE_SYSTEM_PROMPT = `You are a reference advisor in a Mixture of Agents (MoA) process. You are NOT the acting agent and you do NOT execute anything: you cannot call tools, run commands, browse, or access files, repositories, or URLs, and you should not try to or apologize for being unable to. A separate aggregator/orchestrator model holds those capabilities and will take the actual actions.

The conversation below is the current state of a task handled by that acting agent. Your job is to give your most intelligent analysis of that state: understand the goal, reason about the problem, and advise on what to do next. Surface the best approach, concrete next steps and tool-use strategy, likely pitfalls and risks, and anything the acting agent may have missed or gotten wrong. Assume any referenced files, URLs, or systems exist and reason about them from the context given rather than asking for access.

Respond with your advice directly — no preamble, no disclaimers about tools or access. Your response is private guidance handed to the aggregator, not an answer shown to the user.`;

// ── Parallel reference fan-out ────────────────────────────────────────────────

async function runReferencesParallel(
  slots: { provider: string; model: string }[],
  refMessages: ChatMessage[],
  temperature: number,
  maxTokens: number,
): Promise<Array<[string, string]>> {
  if (!slots || slots.length === 0) return [];
  const refs = slots.slice(0, MAX_WORKERS);
  const futures = refs.map((slot) => runReference(slot, refMessages, temperature, maxTokens));
  return Promise.all(futures);
}

async function runReference(
  slot: { provider: string; model: string },
  refMessages: ChatMessage[],
  temperature: number,
  maxTokens: number,
): Promise<[string, string]> {
  const label = slotLabel(slot);
  try {
    const messages: ChatMessage[] = [{ role: "system", content: REFERENCE_SYSTEM_PROMPT }, ...refMessages];
    const resp = await callProvider({
      provider: slot.provider,
      model: slot.model,
      messages,
      temperature,
      maxTokens,
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
    const refMessages = trimForReference(messages);

    // Step 2: fan out references in parallel
    const outputs = await runReferencesParallel(
      preset.reference_models,
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
    const resp = await callProvider({
      provider: preset.aggregator.provider,
      model: preset.aggregator.model,
      messages: [{ role: "user", content: synthPrompt }],
      temperature: preset.aggregator_temperature ?? 0.4,
      maxTokens: 2048,
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
