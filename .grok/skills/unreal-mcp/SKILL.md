---
name: unreal-mcp
description: Build, inspect, edit, and verify Unreal Engine projects through Epic's editor-embedded MCP server.
---

# Unreal MCP

This skill adapts Hermes Agent's `creative-unreal-mcp` workflow for Grok Build.
Use the live MCP toolset schemas; never guess Unreal tool names or arguments.

## Required loop

1. Discover toolsets and inspect the existing project/level before edits.
2. Describe the toolset and call one MCP tool at a time on Unreal's game thread.
3. Read every result and read back changed actors/properties.
4. Build in milestones: shell, blocking, lighting, materials, dressing, camera,
   capture/render.
5. Save before and after bulk edits and verify structurally and visually.

The MCP endpoint must remain loopback-only. Use centimeters, Z-up coordinates,
long `/Game/...` package paths, and distinguish actor labels from internal names.
Report exact assets, levels, and output captures.
