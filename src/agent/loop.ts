// Unreal Agent — Tool-use agent loop
//
// Sends messages + tool schemas to the provider, parses tool_calls,
// dispatches to local handlers or MCP tool calls, appends results,
// and recurses until the model emits a final response (no tool_calls)
// or the iteration cap is hit.

import type { ChatMessage, ToolSpec, ToolDefinition, ToolContext } from "../types.js";
import { callProvider } from "../providers/client.js";

export interface LoopOpts {
  provider: string;
  model: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  cwd: string;
  signal?: AbortSignal;
  maxIterations?: number;
  temperature?: number;
  maxTokens?: number;
}

export interface LoopResult {
  final: string;
  iterations: number;
  toolCallsUsed: ToolCallRecord[];
  usage: { inputTokens: number; outputTokens: number };
}

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: string;
  isError: boolean;
}

export async function runAgentLoop(opts: LoopOpts): Promise<LoopResult> {
  const messages: ChatMessage[] = [...opts.messages];
  const toolSchemas: ToolSpec[] = opts.tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  const toolCallsUsed: ToolCallRecord[] = [];
  let totalInput = 0;
  let totalOutput = 0;
  const maxIter = opts.maxIterations ?? 10;

  for (let i = 0; i < maxIter; i++) {
    const resp = await callProvider({
      provider: opts.provider,
      model: opts.model,
      messages,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      tools: toolSchemas,
      signal: opts.signal,
    });
    totalInput += resp.usage.inputTokens;
    totalOutput += resp.usage.outputTokens;

    if (!resp.tool_calls || resp.tool_calls.length === 0) {
      return {
        final: resp.content,
        iterations: i + 1,
        toolCallsUsed,
        usage: { inputTokens: totalInput, outputTokens: totalOutput },
      };
    }

    // Append the assistant message that contained the tool calls
    messages.push({
      role: "assistant",
      content: resp.content,
      tool_calls: resp.tool_calls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
    });

    const ctx: ToolContext = { cwd: opts.cwd, signal: opts.signal };
    for (const tc of resp.tool_calls) {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch (e: any) {
        messages.push({
          role: "tool",
          content: `error: malformed tool arguments JSON: ${e?.message ?? e}`,
          tool_call_id: tc.id,
          name: tc.function.name,
        });
        toolCallsUsed.push({ name: tc.function.name, args: {}, result: "malformed", isError: true });
        continue;
      }

      const tool = opts.tools.find((t) => t.name === tc.function.name);
      if (!tool) {
        messages.push({
          role: "tool",
          content: `error: unknown tool '${tc.function.name}'`,
          tool_call_id: tc.id,
          name: tc.function.name,
        });
        toolCallsUsed.push({ name: tc.function.name, args: parsedArgs, result: "unknown", isError: true });
        continue;
      }

      try {
        const result = await tool.handler(parsedArgs, ctx);
        messages.push({
          role: "tool",
          content: result.content,
          tool_call_id: tc.id,
          name: tool.name,
        });
        toolCallsUsed.push({ name: tool.name, args: parsedArgs, result: result.content, isError: !!result.isError });
      } catch (e: any) {
        messages.push({
          role: "tool",
          content: `error: ${e?.message ?? e}`,
          tool_call_id: tc.id,
          name: tool.name,
        });
        toolCallsUsed.push({ name: tool.name, args: parsedArgs, result: String(e), isError: true });
      }
    }
  }

  // Max iterations reached
  messages.push({
    role: "user",
    content: "[System: agent loop hit max iterations without a final answer. Give the best answer you can now.]",
  });
  const last = await callProvider({
    provider: opts.provider,
    model: opts.model,
    messages,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    signal: opts.signal,
  });
  totalInput += last.usage.inputTokens;
  totalOutput += last.usage.outputTokens;
  return {
    final: last.content,
    iterations: maxIter + 1,
    toolCallsUsed,
    usage: { inputTokens: totalInput, outputTokens: totalOutput },
  };
}
