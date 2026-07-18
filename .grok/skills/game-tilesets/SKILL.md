---
name: game-tilesets
description: Use when creating seamless 2D or stylized game tilesets with Grok Imagine for Unreal Engine. Requires composite seam validation and organized tile exports.
---

# Game Tilesets

Tiles must repeat cleanly and belong to one visual system.

## Workflow

1. Define tile size, grid, camera projection, biome/material, edge rules, and allowed motifs.
2. Generate tile candidates with no borders, text, or baked UI; keep lighting and tone consistent.
3. Build a real 2x2 composite from the candidate tile and inspect all four joins.
4. Check repeating motifs, checkerboard tone shifts, directional lighting, and accidental focal seams.
5. Correct seams by editing the source tile, not by hiding them in the composite.

## Unreal delivery

Export named tiles and a tileset manifest with grid size, intended layers, collision rules, and material settings. Import with the correct texture filtering and compression for the art style, then verify a 2x2 and larger in-editor layout.
