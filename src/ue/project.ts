// Unreal Agent — UE project detection + context builder

import { promises as fs } from "node:fs";
import * as path from "node:path";

export interface UeProject {
  uprojectPath: string;
  rootDir: string;
  name: string;
  modules: string[];
  engineVersion?: string;
}

/** Walk parents looking for a .uproject file. Returns null if none found. */
export async function detectUproject(start: string): Promise<UeProject | null> {
  let dir = path.resolve(start);
  while (true) {
    let entries: { name: string; isFile: boolean }[];
    try {
      const raw = await fs.readdir(dir, { withFileTypes: true });
      entries = raw
        .filter((e) => e.isFile() || e.isDirectory())
        .map((e) => ({ name: e.name, isFile: e.isFile() }));
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
      continue;
    }
    const uproject = entries.find((e) => e.isFile && e.name.endsWith(".uproject"));
    if (uproject) {
      const uprojectPath = path.join(dir, uproject.name);
      return await loadUproject(uprojectPath);
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export async function loadUproject(uprojectPath: string): Promise<UeProject> {
  const raw = await fs.readFile(uprojectPath, "utf8");
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      uprojectPath,
      rootDir: path.dirname(uprojectPath),
      name: path.basename(uprojectPath, ".uproject"),
      modules: [],
    };
  }
  const modules: string[] = Array.isArray(parsed?.Modules)
    ? parsed.Modules.filter((m: any) => typeof m?.Name === "string").map((m: any) => m.Name)
    : [];

  return {
    uprojectPath,
    rootDir: path.dirname(uprojectPath),
    name: parsed?.Name ?? path.basename(uprojectPath, ".uproject"),
    modules,
    engineVersion:
      typeof parsed?.EngineAssociation === "string"
        ? parsed.EngineAssociation
        : undefined,
  };
}

/** Build a brief context string the agent can prepend to the system prompt
 *  when it detects a UE project. */
export function ueContext(p: UeProject): string {
  const lines: string[] = [];
  lines.push(`Unreal Engine project: ${p.name}`);
  if (p.engineVersion) lines.push(`Engine version: ${p.engineVersion}`);
  lines.push(`Project root: ${p.rootDir}`);
  lines.push(`Project file: ${p.uprojectPath}`);
  if (p.modules.length > 0) {
    lines.push(`Modules: ${p.modules.join(", ")}`);
    const sourceDir = path.join(p.rootDir, "Source");
    lines.push(`Source dir: ${sourceDir}`);
  }
  lines.push("");
  lines.push("You are operating inside this UE project. Use conventional");
  lines.push("UE locations: Source/<ModuleName>/ for C++, Content/ for assets.");
  lines.push("UE module sources are <Module>.cpp + <Module>.h + <Module>.Build.cs.");
  return lines.join("\n");
}
