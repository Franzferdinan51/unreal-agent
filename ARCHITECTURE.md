# Unreal Agent 0.2 architecture

## Why the runtime changed

The original project implemented its own provider/tool loop and an HTTP MCP
client. That is useful as a fallback, but it duplicates the part Grok Build
already does well: sessions, permissions, filesystem tools, streaming,
subagents, MoA, and MCP configuration.

The new primary path is therefore:

```text
unreal-agent grok run
        │
        ├── inject UE project context
        ├── inject Unreal MCP skill
        └── spawn `grok -p ... --cwd ... --output-format streaming-json`
                         │
                         ├── Grok filesystem / terminal / session runtime
                         └── project .grok/config.toml → UE MCP :8000/mcp
```

The existing OpenAI-compatible loop and direct MCP commands remain available
for diagnostics and offline fallback. They are not the primary implementation
for Grok-driven work.

## Source decisions

- Hermes `creative-unreal-mcp`: discovery before edits, live schemas, one game-
  thread call at a time, read-back verification, milestone saves, and visual
  verification.
- xAI `grok-build`: documented headless mode with `-p`, `--cwd`, and
  `--output-format streaming-json`; Grok owns the tool/session runtime.
- Grok Build Desktop: its existing backend already uses the same subprocess
  contract, dynamic CLI flag detection, session handling, and MoA fan-out.

## Current setup

The project has a checked-in `.grok/config.toml` with the Unreal MCP endpoint
and `.grok/skills/unreal-mcp/SKILL.md`. The first Grok session must trust this
project folder (`/hooks-trust` in the TUI, or the equivalent `--trust` launch)
before a project-scoped MCP server is allowed to start.

The adapter intentionally does not force auto-approval. Set
`UNREAL_AGENT_ALWAYS_APPROVE=1` only for a trusted project and a well-scoped
task.
