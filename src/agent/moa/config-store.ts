// Unreal Agent — MoA config persistence
// Schema aligned with Agent Teams moa/config.json exactly.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { MoAConfig } from "./types.js";
import { mergePresets } from "./presets.js";

const AGENT_TEAMS_SCHEMA = `{
  "moa": {
    "default_preset": "default",
    "presets": {
      "mypreset": {
        "description": "...",
        "reference_models": [{ "provider": "minimax", "model": "minimax-portal/MiniMax-M2.7" }],
        "aggregator": { "provider": "minimax", "model": "minimax-portal/MiniMax-M3" },
        "reference_temperature": 0.6,
        "aggregator_temperature": 0.4,
        "reference_max_tokens": 1024,
        "enabled": true
      }
    }
  }
}`;

let _cache: MoAConfig | null = null;

/** Load MoA config from disk, merged with built-in presets.
 *  Search paths (first wins):
 *    1. ./moa/config.json
 *    2. ~/.unreal-agent/moa/config.json
 */
export async function loadMoAConfig(): Promise<MoAConfig> {
  if (_cache) return _cache;
  const candidates = [
    path.join(process.cwd(), "moa", "config.json"),
    path.join(os.homedir(), ".unreal-agent", "moa", "config.json"),
  ];
  for (const p of candidates) {
    try {
      const raw = await fs.readFile(p, "utf8");
      const parsed = JSON.parse(raw);
      _cache = mergePresets(parsed as MoAConfig);
      return _cache;
    } catch {
      /* try next */
    }
  }
  _cache = mergePresets(null);
  return _cache;
}

/** Invalidate the in-memory cache (forces next loadMoAConfig to re-read disk). */
export function invalidateMoACache(): void {
  _cache = null;
}

/** Save a named preset to disk. Persists to ~/.unreal-agent/moa/config.json. */
export async function savePreset(name: string, config: MoAConfig): Promise<void> {
  const dir = path.join(os.homedir(), ".unreal-agent", "moa");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "config.json");
  void name;
  await fs.writeFile(file, JSON.stringify(config, null, 2));
  _cache = null;
}

/** Delete a named preset from disk. Returns true if it was deleted. */
export async function deletePreset(name: string): Promise<boolean> {
  const file = path.join(os.homedir(), ".unreal-agent", "moa", "config.json");
  try {
    const disk = JSON.parse(await fs.readFile(file, "utf8"));
    if (!disk.moa?.presets?.[name]) return false;
    delete disk.moa.presets[name];
    if (disk.moa.default_preset === name) {
      disk.moa.default_preset = Object.keys(disk.moa.presets)[0] ?? "default";
    }
    await fs.writeFile(file, JSON.stringify(disk, null, 2));
    _cache = null;
    return true;
  } catch {
    return false;
  }
}

export { AGENT_TEAMS_SCHEMA };
