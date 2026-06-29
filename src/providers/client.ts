// Unreal Agent — Provider client (OpenAI-protocol chat completion)

import { resolveProvider } from "./registry.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCallOpts {
  provider: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number | null;
  tools?: ToolSpec[];
  signal?: AbortSignal;
  /** Override registry baseUrl for this call only (used by MoA slot resolver). */
  baseUrl?: string;
  /** Override registry apiKey for this call only (used by MoA slot resolver). */
  apiKey?: string;
}

export interface ChatCallResult {
  content: string;
  usage: { inputTokens: number; outputTokens: number };
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  finishReason: string;
}

export async function callProvider(opts: ChatCallOpts): Promise<ChatCallResult> {
  const resolved = resolveProvider(opts.provider);
  const baseUrl = (opts.baseUrl ?? resolved.baseUrl).replace(/\/$/, "");
  const url = `${baseUrl}/chat/completions`;

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 4096,
    stream: false,
  };
  if (opts.tools && opts.tools.length > 0) body.tools = opts.tools;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = opts.apiKey ?? resolved.apiKey;
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Provider ${opts.provider} returned ${resp.status}: ${text}`);
  }

  const data = (await resp.json()) as {
    choices: Array<{
      message: {
        role: string;
        content: string;
        tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
      };
      finish_reason: string;
    }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  const choice = data.choices[0];
  return {
    content: choice.message.content ?? "",
    usage: {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    },
    tool_calls: choice.message.tool_calls,
    finishReason: choice.finish_reason,
  };
}

export async function* streamProvider(opts: ChatCallOpts): AsyncGenerator<string, ChatCallResult, void> {
  const resolved = resolveProvider(opts.provider);
  const baseUrl = (opts.baseUrl ?? resolved.baseUrl).replace(/\/$/, "");
  const url = `${baseUrl}/chat/completions`;

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 4096,
    stream: true,
  };
  if (opts.tools && opts.tools.length > 0) body.tools = opts.tools;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  if (resolved.apiKey) headers["Authorization"] = `Bearer ${resolved.apiKey}`;

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Provider ${opts.provider} returned ${resp.status}: ${text}`);
  }
  if (!resp.body) throw new Error("Provider did not return a stream body");

  let full = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let finishReason = "stop";
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const evt = JSON.parse(payload);
        const delta = evt.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          yield delta;
        }
        if (evt.choices?.[0]?.finish_reason) finishReason = evt.choices[0].finish_reason;
        if (evt.usage) {
          inputTokens = evt.usage.prompt_tokens ?? 0;
          outputTokens = evt.usage.completion_tokens ?? 0;
        }
      } catch {
        // skip malformed chunk
      }
    }
  }

  return {
    content: full,
    usage: { inputTokens, outputTokens },
    finishReason,
  };
}
