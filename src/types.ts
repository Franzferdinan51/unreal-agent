// Unreal Agent — Core types

// ── Providers ────────────────────────────────────────────────

export interface ProviderConfig {
  id: string;
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
  apiKeyEnv: string[];
  baseUrlEnv: string[];
  modelEnv: string[];
  description?: string;
}

// ── Sessions ─────────────────────────────────────────────────

export interface SessionConfig {
  id: string;
  provider: string;
  model: string;
  messages: Message[];
  cwd: string;
  createdAt: number;
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

// ── Tools ────────────────────────────────────────────────────

export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
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

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  dangerous?: boolean;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<{ content: string; isError?: boolean }>;
}

export interface ToolContext {
  cwd: string;
  signal?: AbortSignal;
}

// ── Config ───────────────────────────────────────────────────

export interface UnrealAgentConfig {
  provider: string;
  model: string;
  mcpUrl: string;
  ueProject: string | null;
  providers: Record<string, ProviderConfig>;
  context: {
    maxTokens: number;
  };
}

// ── MCP ──────────────────────────────────────────────────────

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpCallResult {
  ok: boolean;
  content?: Array<{ type: string; text?: string; [k: string]: unknown }>;
  error?: string;
  raw?: unknown;
}
