// Unreal Agent — MCP HTTP client (JSON-RPC 2.0)
//
// Connects to the UE 5.8 native MCP server at http://127.0.0.1:8000/mcp.
// Also supports any other MCP server reachable over HTTP POST + JSON-RPC.
//
// Single-shot lifecycle: connect → initialize → listTools/callTool → close.
// No persistent sessions; each call opens a fresh transport if needed.

import { McpToolDescriptor, McpCallResult } from "../types.js";

export interface McpClientOptions {
  baseUrl: string;
  /** When true, the client initializes (handshake) on construction. */
  handshake?: boolean;
  /** Per-request timeout in ms. Default 30s. */
  timeoutMs?: number;
}

const PROTOCOL_VERSION = "2025-06-18";
const CLIENT_INFO = {
  name: "unreal-agent",
  version: "0.1.0",
};

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
}

export class UnrealMcpClient {
  private nextId = 1;
  private initialized = false;
  private serverInfo: { name: string; version: string } | null = null;
  private serverCapabilities: Record<string, unknown> = {};
  private liveSessionId: string | null = null;
  private pending = new Map<number, PendingRequest>();

  constructor(public readonly opts: McpClientOptions) {}

  async initialize(): Promise<{ serverInfo: { name: string; version: string }; capabilities: Record<string, unknown> }> {
    if (this.initialized && this.serverInfo) {
      return { serverInfo: this.serverInfo, capabilities: this.serverCapabilities };
    }
    const resp = await this._request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {}, sampling: {} },
      clientInfo: CLIENT_INFO,
    });
    this.serverInfo = resp.serverInfo ?? { name: "unknown", version: "0" };
    this.serverCapabilities = resp.capabilities ?? {};
    this.initialized = true;
    // Optionally send initialized notification — best effort
    await this._notify("notifications/initialized", {}).catch(() => {});
    return { serverInfo: this.serverInfo as { name: string; version: string }, capabilities: this.serverCapabilities };
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    if (!this.initialized) await this.initialize();
    const resp = await this._request("tools/list", {});
    return (resp.tools as McpToolDescriptor[]) ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    if (!this.initialized) await this.initialize();
    try {
      const resp = await this._request("tools/call", { name, arguments: args });
      const result = (resp as any).result ?? resp;
      return {
        ok: true,
        content: Array.isArray(result?.content) ? result.content : [],
        raw: result,
      };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  }

  /** Discover tools + return them as tool-spec objects suitable for an
   *  OpenAI-protocol tools[] array. Returns [] if MCP is unreachable. */
  async getToolSpecs(): Promise<Array<{ name: string; originalName: string; description: string; parameters: Record<string, unknown> }>> {
    try {
      const tools = await this.listTools();
      return tools.map((t) => ({
        name: `mcp__${t.name}`.replace(/[^a-zA-Z0-9_]/g, "_"),
        originalName: t.name,
        description: t.description ?? "(no description)",
        parameters: t.inputSchema ?? { type: "object", properties: {} },
      }));
    } catch {
      return [];
    }
  }

  isAvailable(): boolean {
    return this.serverInfo !== null;
  }

  getServerInfo(): { name: string; version: string } | null {
    return this.serverInfo;
  }

  close(): void {
    this.initialized = false;
    this.serverInfo = null;
    this.pending.clear();
  }

  // ── HTTP transport ─────────────────────────────────────────

  private async _request(method: string, params: Record<string, unknown>): Promise<any> {
    const id = this.nextId++;
    const url = resolveMcpUrl(this.opts.baseUrl);
    const body = {
      jsonrpc: "2.0",
      id,
      method,
      params: params ?? {},
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.liveSessionId) headers["Mcp-Session-Id"] = this.liveSessionId;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 30000);
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err: any) {
      clearTimeout(timeout);
      throw new Error(`MCP request failed: ${err?.message ?? err}`);
    }
    clearTimeout(timeout);

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`MCP HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }

    const ct = (resp.headers.get("content-type") ?? "").toLowerCase();
    const sid = resp.headers.get("mcp-session-id");
    if (sid) this.liveSessionId = sid;

    if (ct.includes("text/event-stream")) {
      // SSE stream — collect the final "message" event
      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let finalData: any = null;
      if (!reader) throw new Error("MCP returned SSE stream with no body");
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const dataLines = block
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim())
            .join("");
          if (!dataLines || dataLines === "[DONE]") continue;
          try {
            finalData = JSON.parse(dataLines);
          } catch {
            /* skip */
          }
        }
      }
      if (!finalData) throw new Error("MCP SSE stream ended with no data event");
      return this._handleResponse(id, finalData);
    }

    const data = (await resp.json()) as any;
    return this._handleResponse(id, data);
  }

  private async _notify(method: string, params: Record<string, unknown>): Promise<void> {
    const url = resolveMcpUrl(this.opts.baseUrl);
    const body = { jsonrpc: "2.0", method, params: params ?? {} };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 30000);
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      /* ignore — notifications don't require a response */
    } finally {
      clearTimeout(timeout);
    }
  }

  private _handleResponse(id: number, data: any): any {
    if (data?.id !== id) {
      throw new Error(`MCP response id mismatch: sent ${id}, got ${data?.id}`);
    }
    if (data?.error) {
      const e = data.error;
      throw new Error(`MCP error ${e.code ?? "?"}: ${e.message ?? "(no message)"}`);
    }
    return data?.result ?? {};
  }
}

/** Convenience factory. */
export async function connect(baseUrl: string): Promise<UnrealMcpClient> {
  const client = new UnrealMcpClient({ baseUrl, handshake: false });
  await client.initialize();
  return client;
}

function resolveMcpUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (!url.pathname || url.pathname === "/") {
    url.pathname = "/mcp";
  }
  return url.toString().replace(/\/+$/, "");
}
