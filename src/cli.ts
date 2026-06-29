#!/usr/bin/env node
import * as os from "node:os";
import { promises as fs } from "node:fs";
// Unreal Agent — CLI entry point
//
// Commands:
//   run "<prompt>"             One-shot tool-use loop
//   chat                       Interactive REPL with UE context
//   moa [list|preset <name>]  Manage / run MoA presets
//   mcp list                   List tools from UE MCP server
//   mcp call <tool> <json>     Direct MCP tool call
//   doctor                     Diagnostics
//   doctor --mcp               UE MCP server health check
//   provider list              List configured providers
//   version
//   help

import { loadConfig } from "./config.js";
import { streamProvider } from "./providers/client.js";
import { listProviders, resolveProvider } from "./providers/registry.js";
import { defaultTools } from "./agent/tools.js";
import { runAgentLoop } from "./agent/loop.js";
import { UnrealMcpClient } from "./agent/mcp-client.js";
import { runMoA } from "./agent/moa/orchestrator.js";
import { printMoAConfig, runMoASubcommand } from "./agent/moa/cli.js";
import { loadMoAConfig, savePreset, deletePreset } from "./agent/moa/config-store.js";
import type { ChatMessage } from "./types.js";
import { detectUproject, loadUproject, ueContext, type UeProject } from "./ue/project.js";

const VERSION = "0.1.0";

const args = process.argv.slice(2);

async function main() {
  const cmd = args[0];

  let mcpUrlOverride: string | undefined;
  let providerOverride: string | undefined;
  let modelOverride: string | undefined;
  let presetOverride: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--mcp-url" && args[i + 1]) {
      mcpUrlOverride = args[i + 1];
      i++;
    } else if (a === "--provider" && args[i + 1]) {
      providerOverride = args[i + 1];
      i++;
    } else if (a === "--model" && args[i + 1]) {
      modelOverride = args[i + 1];
      i++;
    } else if (a === "--preset" && args[i + 1]) {
      presetOverride = args[i + 1];
      i++;
    } else {
      positional.push(a);
    }
  }

  const cfg = await loadConfig();
  if (providerOverride) {
    cfg.provider = providerOverride;
    if (!modelOverride) {
      cfg.model = resolveProvider(providerOverride).model;
    }
  }
  if (modelOverride) cfg.model = modelOverride;
  if (mcpUrlOverride) cfg.mcpUrl = mcpUrlOverride;

  const moaCfg = await loadMoAConfig();

  switch (positional[0]) {
    case "chat":
      return chat(cfg, positional, moaCfg, presetOverride);
    case "run":
      return runOnce(positional.slice(1).join(" "), cfg, moaCfg, presetOverride);
    case "moa":
      return moaCmd(positional.slice(1), moaCfg);
    case "mcp":
      return mcpCmd(positional.slice(1), cfg);
    case "doctor":
      return doctor(positional.slice(1), cfg);
    case "provider":
      return providerCmd(positional.slice(1), cfg);
    case "version":
    case "-v":
    case "--version":
      console.log(`unreal-agent v${VERSION}`);
      return;
    case "help":
    case "-h":
    case "--help":
    default:
      return help();
  }
}

function help() {
  console.log(`unreal-agent v${VERSION} — task-specific coding harness for Unreal Engine 5

Usage: unreal-agent <command> [options]

Commands:
  run "<prompt>"              One-shot tool-use loop, stream final output
  chat                        Interactive REPL with UE project context
  moa [list]                  List MoA presets (Hermes canonical architecture)
  moa preset <name> -- "..."  Run prompt through named MoA preset
  moa "<prompt>"              One-shot through default MoA preset
  moa configure               Print current MoA config
  mcp list                    List tools from UE MCP server
  mcp call <tool> [json]      Direct MCP tool call
  doctor                      Run diagnostics
  doctor --mcp                UE MCP server health check
  provider list               Show available providers
  version                     Print version
  help                        Show this help

Options:
  --provider <id>             Override default provider (minimax/grok/openrouter)
  --model <name>              Override default model
  --mcp-url <url>             Override UE MCP server URL (default: http://127.0.0.1:8000/mcp)
  --preset <name>             Enable MoA with named preset for run/chat

MoA presets (Hermes canonical architecture — MoA is a virtual provider):
  tiny       2 refs + aggregator  (fast, low-cost)
  default    4 refs + aggregator  (balanced, Hermes defaults)
  coding     code-specialist refs + aggregator
  security   security-focused refs + aggregator
  References run advisory; aggregator is the acting model.
  Recursive MoA (preset referencing preset) is blocked.
  User presets persist in ~/.unreal-agent/config.json

Examples:
  unreal-agent doctor --mcp
  unreal-agent run "list the modules in Source/"
  unreal-agent moa list
  unreal-agent moa preset coding -- "refactor the tick logic in MyActor.cpp"
  unreal-agent --preset default run "explain the build system"

Config:
  ./.unreal-agent.json or ~/.unreal-agent/config.json
  Env: MINIMAX_API_KEY, GROK_API_KEY, OPENROUTER_API_KEY, UE_PROJECT, UE_MCP_URL
`);
}

async function detectProject(cfg: any): Promise<UeProject | null> {
  if (cfg.ueProject) {
    try {
      return await loadUproject(cfg.ueProject);
    } catch {
      /* fall through to cwd scan */
    }
  }
  return detectUproject(process.cwd());
}

async function chat(cfg: any, positional?: string[], moaCfg?: any, presetOverride?: string) {
  const p = (positional ?? []).slice(1).join(" ") || "What can you help with in this UE project?";
  return runOnce(p, cfg, moaCfg, presetOverride);
}

async function runOnce(prompt: string, cfg: any, moaCfg?: any, presetOverride?: string) {
  if (!prompt) {
    console.error('Usage: unreal-agent run "<prompt>"');
    process.exit(1);
  }
  const project = await detectProject(cfg);
  const systemPrompt = buildSystemPrompt(project);

  console.error(`[unreal-agent] provider=${cfg.provider} model=${cfg.model} mcp=${cfg.mcpUrl}`);
  console.error(`[unreal-agent] cwd=${process.cwd()}${project ? ` uproject=${project.uprojectPath}` : ""}`);

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ];

  // MoA path: run through preset (if --preset given)
  if (presetOverride) {
    // Discover MCP tools first
    const tools = [...defaultTools()];
    let mcp: UnrealMcpClient | null = null;
    try {
      mcp = new UnrealMcpClient({ baseUrl: cfg.mcpUrl });
      await mcp.initialize();
      const specs = await mcp.getToolSpecs();
      for (const spec of specs) {
        tools.push({
          name: spec.name,
          description: `[MCP] ${spec.description ?? ""}`,
          parameters: spec.parameters,
          handler: async (args) => {
            const r = await mcp!.callTool(spec.originalName, args);
            if (!r.ok) return { content: `MCP error: ${r.error}`, isError: true };
            const text = (r.content ?? []).map((c: any) => c.text ?? JSON.stringify(c)).join("\n");
            return { content: text || "(no content)" };
          },
        });
      }
    } catch (e: any) {
      console.error(`[unreal-agent] MCP unavailable: ${e?.message ?? e}`);
    }

    const pName = presetOverride ?? moaCfg?.moa?.default_preset ?? "default";
    console.error(`[unreal-agent] MoA preset: ${pName}`);
    const toolSchemas = tools.map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    const toolFn = tools.length > 0
      ? async (_pn: string, fullHistory: any[], _ts: any[]) => {
          const r = await runAgentLoop({
            provider: cfg.provider,
            model: cfg.model,
            messages: fullHistory,
            tools,
            cwd: process.cwd(),
            temperature: 0.4,
            maxTokens: 4096,
          });
          return { output: r.final, toolCallsUsed: r.toolCallsUsed };
        }
      : undefined;

    const result = await runMoA({
      prompt,
      presetName: pName,
      history: [{ role: "system", content: systemPrompt }],
      tools: toolSchemas,
      toolsFn: toolFn,
    });

    // Emit reference labels
    for (let i = 0; i < result.references.length; i++) {
      console.error(`  ref ${i + 1}/${result.references.length}: ${result.references[i].label}`);
    }
    if (result.toolResult) {
      process.stdout.write(result.response + "\n\n" + result.toolResult.output);
      for (const t of result.toolResult.toolCallsUsed) {
        console.error(`  • ${t.name}${t.isError ? " (error)" : ""}`);
      }
    } else {
      process.stdout.write(result.response);
    }
    console.error(`\n[unreal-agent] MoA done — aggregator: ${result.aggregator}`);
    if (mcp) mcp.close();
    return;
  }

  // Default: tool-use loop
  const tools = defaultTools();
  let mcp: UnrealMcpClient | null = null;
  try {
    mcp = new UnrealMcpClient({ baseUrl: cfg.mcpUrl });
    await mcp.initialize();
    const mcpToolSpecs = await mcp.getToolSpecs();
    if (mcpToolSpecs.length > 0) {
      console.error(`[unreal-agent] MCP server: ${mcp.getServerInfo()?.name} (${mcpToolSpecs.length} tools)`);
      for (const spec of mcpToolSpecs) {
        tools.push({
          name: spec.name,
          description: `[MCP] ${spec.description}`,
          parameters: spec.parameters,
          handler: async (args) => {
            const realName = spec.name.replace(/^mcp__/, "").replace(/_/g, "-");
            const r = await mcp!.callTool(realName, args);
            if (!r.ok) return { content: `MCP error: ${r.error}`, isError: true };
            const text = (r.content ?? []).map((c: any) => c.text ?? JSON.stringify(c)).join("\n");
            return { content: text || "(no content)" };
          },
        });
      }
    }
  } catch (e: any) {
    console.error(`[unreal-agent] MCP unavailable: ${e?.message ?? e}`);
  }

  const result = await runAgentLoop({
    provider: cfg.provider,
    model: cfg.model,
    messages,
    tools,
    cwd: process.cwd(),
    temperature: 0.4,
    maxTokens: 4096,
  });

  process.stdout.write(result.final);

  if (result.toolCallsUsed.length > 0) {
    console.error(`\n[unreal-agent] ${result.toolCallsUsed.length} tool call(s):`);
    for (const t of result.toolCallsUsed) {
      console.error(`  • ${t.name}${t.isError ? " (error)" : ""}`);
    }
    console.error(`[unreal-agent] usage: ${result.usage.inputTokens}↑ ${result.usage.outputTokens}↓ tokens`);
  } else {
    console.error(`\n[unreal-agent] done`);
  }

  if (mcp) mcp.close();
}

function buildSystemPrompt(project: UeProject | null): string {
  let p = `You are Unreal Agent, a coding assistant specifically for Unreal Engine 5 projects.

You have filesystem tools available (read, write, edit, grep, find, ls, bash) and \
MCP tools exposed by the connected UE MCP server when available.

When asked to modify a UE project:
- Always check the .uproject file and module structure first
- New C++ goes in Source/<ModuleName>/
- New assets live in Content/
- Use UPROPERTY / UFUNCTION macros and modern UE 5 idioms
- Prefer the convention: GC-free TObjectPtr, FActorComponentRegistry, FObjectInitializer
- If the MCP server is connected, prefer it for editor-level queries (compile/build/run)
- For things out of scope, say so clearly

Be precise about paths. Use absolute paths or paths relative to the project root.`;

  if (project) {
    p += `\n\n${ueContext(project)}`;
  }
  return p;
}

async function mcpCmd(args: string[], cfg: any) {
  const sub = args[0] ?? "list";
  const mcp = new UnrealMcpClient({ baseUrl: cfg.mcpUrl });
  try {
    if (sub === "list") {
      const info = await mcp.initialize();
      console.log(`Server: ${info.serverInfo.name} v${info.serverInfo.version}`);
      const tools = await mcp.listTools();
      if (tools.length === 0) {
        console.log("(no tools)");
      } else {
        for (const t of tools) {
          console.log(`• ${t.name} — ${t.description ?? ""}`);
        }
      }
      return;
    }
    if (sub === "call") {
      const name = args[1];
      if (!name) throw new Error("Usage: unreal-agent mcp call <tool> [json]");
      let callArgs: Record<string, unknown> = {};
      if (args[2]) {
        try {
          callArgs = JSON.parse(args[2]);
        } catch (e: any) {
          throw new Error(`invalid JSON args: ${e?.message}`);
        }
      }
      await mcp.initialize();
      const r = await mcp.callTool(name, callArgs);
      if (!r.ok) {
        console.error(`MCP error: ${r.error}`);
        process.exit(1);
      }
      const text = (r.content ?? []).map((c: any) => c.text ?? JSON.stringify(c)).join("\n");
      console.log(text || JSON.stringify(r.raw, null, 2));
      return;
    }
    console.error(`Unknown mcp subcommand: ${sub}`);
    process.exit(1);
  } catch (e: any) {
    console.error(`MCP failed: ${e?.message ?? e}`);
    process.exit(1);
  } finally {
    mcp.close();
  }
}

async function moaCmd(args: string[], moaCfg: any) {
  if (args.length === 0) {
    printMoAConfig(moaCfg);
    return;
  }
  const sub = args[0];

  if (sub === "preset" && args[1]) {
    const dashDash = args.indexOf("--");
    const presetName = args[1];
    const prompt = dashDash !== -1 ? args.slice(dashDash + 1).join(" ") : args.slice(2).filter((a) => !a.startsWith("-")).join(" ");
    if (!prompt) {
      console.error('Usage: unreal-agent moa preset <name> -- "<prompt>"');
      process.exit(1);
    }
    const cfg = await loadConfig();
    const project = await detectProject(cfg);
    const systemPrompt = buildSystemPrompt(project);

    // Discover MCP tools
    const tools = [...defaultTools()];
    let mcp: UnrealMcpClient | null = null;
    try {
      mcp = new UnrealMcpClient({ baseUrl: cfg.mcpUrl });
      await mcp.initialize();
      const specs = await mcp.getToolSpecs();
      for (const spec of specs) {
        tools.push({
          name: spec.name,
          description: `[MCP] ${spec.description ?? ""}`,
          parameters: spec.parameters,
          handler: async (args2: Record<string, unknown>) => {
            const r = await mcp!.callTool(spec.originalName, args2);
            if (!r.ok) return { content: `MCP error: ${r.error}`, isError: true };
            const text = (r.content ?? []).map((c: any) => c.text ?? JSON.stringify(c)).join("\n");
            return { content: text || "(no content)" };
          },
        });
      }
    } catch (e: any) {
      console.error(`[unreal-agent] MCP unavailable: ${e?.message ?? e}`);
    }

    const toolSchemas = tools.map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    const toolFn =
      tools.length > 0
        ? async (_pn: string, fullHistory: any[]) => {
            const r = await runAgentLoop({
              provider: cfg.provider,
              model: cfg.model,
              messages: fullHistory,
              tools,
              cwd: process.cwd(),
              temperature: 0.4,
              maxTokens: 4096,
            });
            return { output: r.final, toolCallsUsed: r.toolCallsUsed };
          }
        : undefined;

    console.error(`[unreal-agent] MoA preset: ${presetName}`);
    const result = await runMoA({
      prompt,
      presetName,
      history: [{ role: "system", content: systemPrompt }],
      tools: toolSchemas,
      toolsFn: toolFn,
    });

    for (let i = 0; i < result.references.length; i++) {
      console.error(`  ref ${i + 1}/${result.references.length}: ${result.references[i].label}`);
    }
    if (result.toolResult) {
      process.stdout.write(result.response + "\n\n" + result.toolResult.output);
    } else {
      process.stdout.write(result.response);
    }
    console.error(`\n[unreal-agent] MoA done — aggregator: ${result.aggregator}`);
    if (mcp) mcp.close();
    return;
  }

  if (sub === "list" || sub === "ls") {
    printMoAConfig(moaCfg);
    return;
  }
  if (sub === "configure") {
    // `unreal-agent moa configure [name]` — print preset JSON
    const name = args[1] ?? moaCfg.moa.default_preset;
    const p = moaCfg.moa.presets?.[name];
    if (!p) { console.error(`Unknown preset: ${name}`); process.exit(1); }
    console.log(JSON.stringify(p, null, 2));
    return;
  }
  if (sub === "save") {
    // `unreal-agent moa save <name> <json>`
    const name = args[1];
    const jsonStr = args.slice(2).join(" ");
    if (!name || !jsonStr) {
      console.error('Usage: unreal-agent moa save <name> <json>');
      process.exit(1);
    }
    let parsed: any;
    try { parsed = JSON.parse(jsonStr); } catch (e: any) {
      console.error(`Invalid JSON: ${e?.message}`); process.exit(1);
    }
    // Build updated config with this preset
    const next: any = { ...moaCfg, moa: { ...moaCfg.moa, presets: { ...moaCfg.moa.presets } } };
    next.moa.presets[name] = parsed;
    await savePreset(name, next);
    console.log(`Saved preset '${name}'`);
    return;
  }
  if (sub === "delete" || sub === "rm") {
    const name = args[1];
    if (!name) { console.error("Usage: unreal-agent moa delete <name>"); process.exit(1); }
    if (["tiny","default","coding","security"].includes(name)) {
      console.error(`Cannot delete built-in preset: ${name}`); process.exit(1);
    }
    const deleted = await deletePreset(name);
    console.log(deleted ? `Deleted preset: ${name}` : `Preset '${name}' not found.`);
    return;
  }
  if (sub === "active") {
    const name = args[1];
    if (!name) {
      console.log(`Active preset: ${moaCfg.moa.default_preset}`);
      return;
    }
    if (!moaCfg.moa.presets?.[name]) { console.error(`Unknown preset: ${name}`); process.exit(1); }
    const next = { ...moaCfg, moa: { ...moaCfg.moa, default_preset: name } };
    await savePreset(name, next);
    console.log(`Active preset set to: ${name}`);
    return;
  }

  // `unreal-agent moa "<prompt>"` — run through default preset
  const prompt = args.join(" ");
  if (!prompt) {
    printMoAConfig(moaCfg);
    return;
  }
  const cfg = await loadConfig();
  const project = await detectProject(cfg);
  const systemPrompt = buildSystemPrompt(project);
  const result = await runMoA({
    prompt,
    history: [{ role: "system", content: systemPrompt }],
  });
  for (let i = 0; i < result.references.length; i++) {
    console.error(`  ref ${i + 1}/${result.references.length}: ${result.references[i].label}`);
  }
  process.stdout.write(result.response);
  console.error(`\n[unreal-agent] MoA done — aggregator: ${result.aggregator}`);
}

async function doctor(args: string[], cfg: any) {
  console.log(`unreal-agent v${VERSION} — diagnostics`);
  console.log(`Provider: ${cfg.provider} (${cfg.model})`);

  // Resolve provider
  try {
    const r = resolveProvider(cfg.provider);
    console.log(`  baseUrl: ${r.baseUrl}`);
    console.log(`  apiKey:   ${r.apiKey ? "set" : "missing"}`);
  } catch (e: any) {
    console.log(`  ERROR: ${e?.message ?? e}`);
  }

  // Active UE project
  const project = await detectProject(cfg);
  if (project) {
    console.log(`\nUE project:`);
    console.log(`  name:    ${project.name}`);
    console.log(`  root:    ${project.rootDir}`);
    console.log(`  modules: ${project.modules.join(", ") || "(none)"}`);
  } else {
    console.log(`\nUE project: (not detected — no .uproject in cwd or UE_PROJECT unset)`);
  }

  // MCP health if requested
  if (args.includes("--mcp")) {
    console.log(`\nUE MCP server at ${cfg.mcpUrl}:`);
    const mcp = new UnrealMcpClient({ baseUrl: cfg.mcpUrl });
    try {
      const info = await mcp.initialize();
      console.log(`  ✓ reachable: ${info.serverInfo.name} v${info.serverInfo.version}`);
      const tools = await mcp.listTools();
      console.log(`  tools exposed: ${tools.length}`);
      if (tools.length > 0 && tools.length <= 30) {
        for (const t of tools) console.log(`    - ${t.name}`);
      }
    } catch (e: any) {
      console.log(`  ✗ unreachable: ${e?.message ?? e}`);
    } finally {
      mcp.close();
    }
  }
}

async function providerCmd(args: string[], cfg: any) {
  if (args[0] !== "list") {
    console.error('Usage: unreal-agent provider list');
    process.exit(1);
  }
  console.log("Configured providers:\n");
  for (const p of listProviders()) {
    const resolved = resolveProvider(p.id);
    const flag = p.id === cfg.provider ? "*" : " ";
    console.log(`${flag} ${p.id.padEnd(10)} ${p.label}`);
    console.log(`    baseUrl: ${resolved.baseUrl}`);
    console.log(`    model:   ${resolved.model}`);
    console.log(`    apiKey:  ${resolved.apiKey ? "set" : "missing"}`);
  }
}

main().catch((err) => {
  console.error("[unreal-agent] fatal:", err);
  process.exit(1);
});
