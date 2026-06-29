// Unreal Agent — MoA CLI subcommands
// Works with MoAConfig { moa: { default_preset, presets } } from config-store.

import type { MoAConfig, MoAPresetConfig } from "./types.js";

export function printMoAConfig(cfg: MoAConfig): void {
  const { moa } = cfg;
  console.log("MoA presets:");
  console.log(`Default: ${moa.default_preset}`);
  console.log("");
  for (const [name, preset] of Object.entries(moa.presets)) {
    const marker = name === moa.default_preset ? "*" : " ";
    const builtin = name in { tiny: 1, default: 1, coding: 1, security: 1 } ? " (built-in)" : "";
    console.log(`${marker} ${name}${builtin}`);
    console.log(`  ${preset.description ?? "(no description)"}`);
    console.log(`  enabled: ${preset.enabled ? "yes" : "no"}`);
    console.log(
      `  refs:     ${preset.reference_models.map((r) => `${r.provider}:${r.model}`).join(", ")}`,
    );
    console.log(`  agg:      ${preset.aggregator.provider}:${preset.aggregator.model}`);
    console.log(
      `  temps:    ref=${preset.reference_temperature} agg=${preset.aggregator_temperature}`,
    );
    console.log(`  maxTokens: ${preset.reference_max_tokens}`);
    console.log("");
  }
}

/** Get a preset by name from a loaded MoAConfig. */
export function getPreset(cfg: MoAConfig, name: string): MoAPresetConfig | null {
  return cfg.moa.presets?.[name] ?? null;
}

/** CLI: unreal-agent moa list | configure | delete | active */
export async function runMoASubcommand(
  args: string[],
  cfg: MoAConfig,
  saveFn: (next: MoAConfig) => Promise<void>,
): Promise<void> {
  const sub = args[0] ?? "list";
  const { moa } = cfg;

  switch (sub) {
    case "list":
    case "ls":
      printMoAConfig(cfg);
      break;

    case "configure": {
      const name = args[1] ?? moa.default_preset;
      const p = moa.presets?.[name];
      if (!p) {
        console.error(`Unknown preset: ${name}`);
        process.exit(1);
      }
      console.log(`# MoA preset: ${name}`);
      console.log(JSON.stringify(p, null, 2));
      break;
    }

    case "delete":
    case "rm": {
      const name = args[1];
      if (!name) {
        console.error("Usage: unreal-agent moa delete <name>");
        process.exit(1);
      }
      if (["tiny", "default", "coding", "security"].includes(name)) {
        console.error(`Cannot delete built-in preset: ${name}`);
        process.exit(1);
      }
      if (!moa.presets?.[name]) {
        console.error(`Preset '${name}' not found.`);
        process.exit(1);
      }
      const next = {
        ...cfg,
        moa: {
          ...moa,
          presets: { ...moa.presets },
        },
      };
      delete next.moa.presets[name];
      if (next.moa.default_preset === name) {
        next.moa.default_preset = Object.keys(next.moa.presets)[0] ?? "default";
      }
      await saveFn(next);
      console.log(`Deleted preset: ${name}`);
      break;
    }

    case "active": {
      const name = args[1];
      if (!name) {
        console.log(`Active preset: ${moa.default_preset}`);
        break;
      }
      if (!moa.presets?.[name]) {
        console.error(`Preset '${name}' not found.`);
        process.exit(1);
      }
      const next = { ...cfg, moa: { ...moa, default_preset: name } };
      await saveFn(next);
      console.log(`Default preset set to: ${name}`);
      break;
    }

    default:
      console.error(`Unknown moa subcommand: ${sub}`);
      console.error("Usage: moa list | configure | delete <name> | active [name]");
      process.exit(1);
  }
}
