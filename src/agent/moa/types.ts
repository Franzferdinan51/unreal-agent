// Unreal Agent — MoA types
// Schema aligned with Agent Teams moa/moa-runtime.js + moa/config.json.

export interface MoASlot {
  provider: string;
  model: string;
}

export interface MoAPresetConfig {
  description?: string;
  enabled: boolean;
  reference_models: MoASlot[];
  aggregator: MoASlot;
  reference_temperature: number;
  aggregator_temperature: number;
  reference_max_tokens: number; // Agent Teams uses this (distinct from aggregator_max_tokens)
}

export interface MoAConfig {
  moa: {
    default_preset: string;
    presets: Record<string, MoAPresetConfig>;
  };
}

// ── Run options (Agent Teams signature) ─────────────────────────────────────

export interface MoARunOpts {
  prompt: string;
  presetName?: string;
  history?: ChatMessage[];
  /** When provided, the aggregator calls tools with these specs after synthesis. */
  tools?: ToolSpec[];
  /** The tool-calling loop implementation. Called with (presetName, fullHistory, toolSchemas). */
  toolsFn?: (presetName: string, history: ChatMessage[], tools: ToolSpec[]) => Promise<ToolCallResult>;
}

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

export interface ToolCallResult {
  output: string;
  toolCallsUsed: ToolCallRecord[];
}

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: string;
  isError: boolean;
}

export interface ReferenceOutput {
  label: string; // "provider:model"
  text: string;
  failed?: string;
}

export interface MoAResult {
  response: string;          // aggregator's synthesized text
  references: ReferenceOutput[];
  preset: string;
  aggregator: string;         // "provider:model"
  toolResult?: ToolCallResult; // set when toolsFn was used
}
