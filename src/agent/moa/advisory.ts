// DuckHive CLI — MoA advisory view builder + slot runtime resolver
// Mirrors hermes-agent/agent/moa_loop.py: _reference_messages + _slot_runtime + _REFERENCE_SYSTEM_PROMPT.

import { createHash } from "node:crypto";
import type { ChatMessage } from "../../providers/client.js";
import type { MoASlot } from "./types.js";

/** Slot runtime: a resolved provider+model pair for a call. */
export interface SlotCall {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
}

/** Per-tool-result char budget for the advisory view. Replayed tool results
 *  would blow the reference model's context window. */
export const REFERENCE_TOOL_RESULT_BUDGET = 4000;

/** Max concurrent reference fan-out workers — mirrors Hermes's _MAX_REFERENCE_WORKERS. */
export const MAX_REFERENCE_WORKERS = 8;

/** System prompt prepended to every reference call so the model understands
 *  it is advisory and does not try to act. */
export const REFERENCE_SYSTEM_PROMPT = `You are a reference advisor in a Mixture of Agents (MoA) process. You are NOT the acting agent and you do NOT execute anything: you cannot call tools, run commands, browse, or access files, repositories, or URLs, and you should not try to or apologize for being unable to. A separate aggregator/orchestrator model holds those capabilities and will take the actual actions.

The conversation below is the current state of a task handled by that acting agent. Your job is to give your most intelligent analysis of that state: understand the goal, reason about the problem, and advise on what to do next. Surface the best approach, concrete next steps and tool-use strategy, likely pitfalls and risks, and anything the acting agent may have missed or gotten wrong. Assume any referenced files, URLs, or systems exist and reason about them from the context given rather than asking for access.

Respond with your advice directly — no preamble, no disclaimers about tools or access. Your response is private guidance handed to the aggregator, not an answer shown to the user.`;

/** Resolve a reference/aggregator slot to its real runtime call kwargs.
 *  Routes through the provider's real API surface (anthropic_messages,
 *  max_completion_tokens, custom endpoints, etc.) — identical to how any
 *  other model call gets routed by the rest of the CLI. */
export function resolveSlotRuntime(slot: MoASlot, registry: Map<string, any>): SlotCall {
  const out: SlotCall = { provider: slot.provider, model: slot.model };
  try {
    const entry = registry.get(slot.provider.toLowerCase());
    if (!entry) return out;
    // OpenAI-Codex / xai-oauth / nous need their provider branch even with
    // a custom base_url — keep them identified by name so callProvider
    // doesn't strip auth refresh / request-shape adapters.
    if (["nous", "openai-codex", "xai-oauth"].includes(slot.provider.toLowerCase())) {
      return out;
    }
    if (entry.baseUrl) out.baseUrl = entry.baseUrl.replace(/\/$/, "");
    if (entry.apiKey) out.apiKey = entry.apiKey;
  } catch {
    /* fall back to bare provider/model — callProvider will still try */
  }
  return out;
}

/** Head+tail preview of a tool result for the advisory view. */
export function truncateToolResult(text: string, budget = REFERENCE_TOOL_RESULT_BUDGET): string {
  if (!text || text.length <= budget) return text;
  const half = Math.floor(budget / 2);
  const omitted = text.length - 2 * half;
  return `${text.slice(0, half)}\n[... ${omitted} chars omitted ...]\n${text.slice(-half)}`;
}

/** Render assistant turn's tool_calls as readable text lines. */
export function renderToolCalls(toolCalls: any): string {
  if (!Array.isArray(toolCalls)) return "";
  return toolCalls
    .map((tc: any) => {
      const fn = (tc?.function ?? {}) as { name?: string; arguments?: unknown };
      const name = fn.name ?? tc?.name ?? "tool";
      let argsText = "";
      if (typeof fn.arguments === "string") argsText = fn.arguments;
      else if (fn.arguments != null) {
        try {
          argsText = JSON.stringify(fn.arguments);
        } catch {
          argsText = String(fn.arguments);
        }
      }
      return argsText
        ? `[called tool: ${name}(${argsText})]`
        : `[called tool: ${name}]`;
    })
    .join("\n");
}

/** Build the trimmed advisory view of the conversation for reference models.
 *
 *  - system prompt: dropped (8K of Hermes boilerplate, not advisory signal).
 *  - assistant turns: kept; tool_calls rendered inline as text lines.
 *  - tool-role results: folded into the preceding assistant turn as a
 *    `[tool result: ...]` block, so references see what came back without
 *    emitting a tool-role message they never produced (strict providers
 *    400 on orphan tool messages).
 *  - must end on a user turn: if last is assistant, append a synthetic
 *    advisory user turn (Anthropic rejects trailing-assistant-prefill). */
export function referenceMessages(messages: ChatMessage[]): ChatMessage[] {
  const advisoryInstruction =
    "[The conversation above is the current state of the task. Give your most intelligent judgement: what is going on, what should happen next, what risks or mistakes you see, and how the acting agent should proceed.]";

  const rendered: ChatMessage[] = [];
  let lastUserContent: string | null = null;

  for (const msg of messages) {
    const role = msg.role;
    const content = typeof msg.content === "string" ? msg.content : "";

    if (role === "system") continue;

    if (role === "user") {
      if (content.trim()) lastUserContent = content;
      rendered.push({ role: "user", content });
      continue;
    }

    if (role === "assistant") {
      const parts: string[] = [];
      if (content.trim()) parts.push(content.trim());
      const callsText = renderToolCalls(msg.tool_calls);
      if (callsText) parts.push(callsText);
      if (parts.length) {
        rendered.push({ role: "assistant", content: parts.join("\n") });
      }
      continue;
    }

    if (role === "tool") {
      const resultText = truncateToolResult(content);
      const block = `[tool result: ${resultText}]`;
      const last = rendered[rendered.length - 1];
      if (last && last.role === "assistant") {
        last.content = `${last.content}\n${block}`;
      } else {
        rendered.push({ role: "assistant", content: block });
      }
      continue;
    }
  }

  // End-on-user rule.
  if (rendered.length === 0) {
    if (lastUserContent != null) return [{ role: "user", content: lastUserContent }];
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "user" && typeof m.content === "string") {
        return [{ role: "user", content: m.content }];
      }
    }
    return [];
  }
  if (rendered[rendered.length - 1].role === "assistant") {
    rendered.push({ role: "user", content: advisoryInstruction });
  }
  return rendered;
}

/** Build the deterministic signature for the advisory view — used as the
 *  MoA reference cache key. New user/tool message changes the signature,
 *  duplicate create() call with same state is a cache HIT. */
export function advisorySignature(presetName: string, refs: MoASlot[], view: ChatMessage[]): string {
  const joined = view.map((m) => `${m.role}:${m.content}`).join("\u0000");
  const hash = createHash("sha256").update(joined).digest("hex");
  const labels = refs.map((r) => `${r.provider}:${r.model}`).join(",");
  return `${presetName}|${hash}|${labels}`;
}

/** Pull plain text out of any provider response in a transport-tolerant way. */
export function extractText(response: any): string {
  // OpenAI ChatCompletions
  try {
    const c = response?.choices?.[0]?.message?.content;
    if (typeof c === "string" && c.trim()) return c.trim();
  } catch {
    /* */
  }
  // Anthropic Messages
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
  } catch {
    /* */
  }
  // Responses API
  try {
    const out = response?.output_text;
    if (typeof out === "string" && out.trim()) return out.trim();
  } catch {
    /* */
  }
  return "";
}
