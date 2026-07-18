---
name: game-asset-core
description: Use when creating or revising engine-ready 2D game assets with Grok Imagine for Unreal Engine. Enforces isolated subjects, transparent or flat keyable backgrounds, deterministic naming, metadata, and import-ready organization.
---

# Game Asset Core

Create assets as production inputs, not loose concept art.

## Defaults

- Ask only for missing constraints; otherwise choose a coherent art direction.
- Use Grok Imagine with an isolated subject, orthographic-friendly framing, no text, no watermark, and a flat keyable background or transparent output when supported.
- Keep the subject centered with safe margins and consistent scale across a set.
- Prefer PNG for sprites/UI and lossless source files when the tool supports them.
- Never silently regenerate a related asset from scratch when an edit can preserve identity.

## Unreal delivery

1. Create a manifest before generating: asset id, category, intended dimensions, pivot, collision notes, and target `/Game/...` path.
2. Name files `DA_<category>_<name>_<variant>` for data, `T_<name>_<variant>` for textures, and `M_<name>` for materials.
3. Put generated files in a named output folder, then import them into the Unreal project and verify dimensions, alpha, filtering, compression, and pivot.
4. Report exact source files and Unreal asset paths. Do not claim an import succeeded without checking it.

## Quality gate

Reject outputs with accidental text, cropped edges, inconsistent scale, unintended shadows, busy backgrounds, or visible seams. Regenerate or edit with a focused correction.
