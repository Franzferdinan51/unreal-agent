// Unreal Agent — Config loader

import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { UnrealAgentConfig } from "./types.js";

export const DEFAULT_MCP_URL = "http://127.0.0.1:8000/mcp";

const DEFAULT_CONFIG: UnrealAgentConfig = {
  provider: "minimax",
  model: "minimax-portal/MiniMax-M2.7",
  mcpUrl: DEFAULT_MCP_URL,
  ueProject: null,
  providers: {},
  context: { maxTokens: 64_000 },
};

export async function loadConfig(cwd: string = process.cwd()): Promise<UnrealAgentConfig> {
  const candidates = [
    path.join(cwd, ".unreal-agent.json"),
    path.join(os.homedir(), ".unreal-agent", "config.json"),
  ];
  for (const p of candidates) {
    try {
      const raw = await fs.readFile(p, "utf8");
      const parsed = JSON.parse(raw);
      return mergeConfig(DEFAULT_CONFIG, parsed, process.env);
    } catch {
      /* try next */
    }
  }
  return mergeConfig(DEFAULT_CONFIG, {}, process.env);
}

function mergeConfig(
  base: UnrealAgentConfig,
  override: Partial<UnrealAgentConfig> & Record<string, any>,
  env: NodeJS.ProcessEnv,
): UnrealAgentConfig {
  const merged: UnrealAgentConfig = { ...base, ...override } as UnrealAgentConfig;
  // Allow env to override active provider/model/mcpUrl
  if (env.UE_AGENT_PROVIDER) merged.provider = env.UE_AGENT_PROVIDER;
  if (env.UE_AGENT_MODEL) merged.model = env.UE_AGENT_MODEL;
  if (env.UE_MCP_URL) merged.mcpUrl = env.UE_MCP_URL;
  if (env.UE_PROJECT) merged.ueProject = env.UE_PROJECT;
  return merged;
}

export async function ensureHomeDir(): Promise<string> {
  const dir = path.join(os.homedir(), ".unreal-agent");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
