# Unreal Agent — SPEC.md
## Task-specific coding harness for Unreal Engine 5

---

## Overview

**Name:** Unreal Agent (`unreal-agent`)
**Purpose:** AI-native coding harness purpose-built for Unreal Engine 5 development. Connects to the UE MCP server for editor-level integration.
**Location:** `~/Desktop/Unreal-Agent/`
**Repo:** TBD (likely `Franzferdinan51/unreal-agent`)
**Models:** MiniMax primary, with LM Studio and other OpenAI-compatible providers supported through built-in or custom provider profiles

---

## Architecture

```
unreal-agent
├── bin/
│   └── unreal-agent          # Entry point (tsx → dist/)
├── src/
│   ├── cli.ts                # Entry: run / chat / mcp / doctor
│   ├── config.ts             # Config loader (~/.unreal-agent/config.json)
│   ├── types.ts              # Core types
│   ├── providers/
│   │   ├── registry.ts       # Built-in + custom provider profiles
│   │   └── client.ts         # OpenAI-protocol caller
│   ├── agent/
│   │   ├── loop.ts           # Tool-use agent loop
│   │   ├── tools.ts          # Built-in tools (read/write/edit/bash/grep/ls/find)
│   │   └── mcp-client.ts     # MCP HTTP client (UE MCP :8000)
│   └── ue/
│       ├── project.ts        # UE project detection (.uproject walk)
│       └── context.ts        # UE context builder (Build.cs, .uproject, etc.)
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

---

## MCP Integration

### Primary: UE 5.8 Native MCP Server
- **URL:** `http://127.0.0.1:8000/mcp`
- **Transport:** HTTP POST + JSON-RPC 2.0 (per MCP spec 2025-06-18)
- **Why:** Epic added native MCP to UE 5.8 (released June 17, 2026 at Unreal Fest 2026)
- **Fallback if MCP server not running:** Agent runs in local-tools-only mode

### MCP Client Implementation
- `src/agent/mcp-client.ts` — pure HTTP POST JSON-RPC client
- Mirrors CodingHarness `connectHttp()` but trimmed for HTTP-only (no stdio)
- Returns `{ callTool, listTools, listResources, initialize, close }`

---

## Models

| Rank | Provider | Model | Use |
|------|----------|-------|-----|
| 1 | MiniMax | `minimax-portal/MiniMax-M2.7` | Primary default |
| 2 | LM Studio | user-supplied local model | Local OpenAI-compatible runtime |
| 3 | OpenAI / Grok / OpenRouter / Ollama | provider default | Alternate built-in provider profiles |
| 4 | Custom provider profile | config-defined | Additional OpenAI-compatible Hermes-style runtimes |

MoA is available and patterned after Hermes/Nous Research's implementation, but the harness remains UE-focused and lean compared with the full Hermes stack.

---

## Tools

### Built-in (local filesystem)
| Tool | Description |
|------|-------------|
| `read` | Read file |
| `write` | Write file |
| `edit` | Patch oldText → newText |
| `grep` | Search files |
| `ls` | List directory |
| `find` | Find files by glob |
| `bash` | Execute shell command |

### UE-specific (via UE MCP server, when available)
| Tool | Description |
|------|-------------|
| `mcp_call` | Generic MCP tool call (any server, any tool) |
| `mcp_list` | List available MCP tools on connected servers |

Tools from the UE MCP server are dynamically added to the model's tool schema via `mcp_list` at startup.

---

## Commands

```
unreal-agent run "<prompt>"              One-shot, stream output, exit
unreal-agent chat                        Interactive REPL with UE context
unreal-agent mcp list                    List tools from UE MCP server
unreal-agent mcp call <tool> <json>      Direct MCP tool call
unreal-agent doctor                      Diagnostics (config + MCP health)
unreal-agent doctor --mcp                UE MCP server connectivity check
unreal-agent --mcp-url <url> <prompt>    Use custom MCP URL
unreal-agent --provider <id>             Override default provider
unreal-agent version                     Print version
unreal-agent help                        Show help
```

---

## UE Project Detection

Auto-detect `.uproject`:
1. `args` first arg ends in `.uproject`
2. `$PWD` contains a `.uproject`
3. Walk parents until `.uproject` found
4. `$UE_PROJECT` env var

When detected, the agent prepends a brief UE context (engine version, project name, modules) to the system prompt so the model knows what it's working on.

---

## Config

**Search paths (first wins):**
1. `./.unreal-agent.json`
2. `$PWD/.unreal-agent.json`
3. `~/.unreal-agent/config.json`

```json
{
  "provider": "minimax",
  "model": "minimax-portal/MiniMax-M2.7",
  "mcpUrl": "http://127.0.0.1:8000/mcp",
  "ueProject": null,
  "providers": {
    "mygateway": {
      "label": "My Gateway",
      "defaultBaseUrl": "https://llm.example.com/v1",
      "defaultModel": "qwen/qwen3-coder"
    }
  }
}
```

Provider selection and model selection should stay coupled: if the active provider changes and no explicit model override is supplied, the harness should fall back to that provider's configured default model/env-resolved model.

---

## Differences from DuckHive-CLI (by design)

| Feature | DuckHive-CLI | Unreal Agent |
|---------|-------------|--------------|
| Scope | General-purpose | UE-specific |
| MoA | Core feature (4 presets) | Included in focused UE form |
| Council | 9-voice deliberation | Not included |
| MCP | Generic MCP server | UE MCP first-class, HTTP only |
| Tool set | General | UE: read/write/edit/grep/bash/find + MCP relay |
| Dependencies | Heavy (10+ deps) | Minimal (5 deps: typescript, tsx, @types/node) |
| Project awareness | None | Auto-detect .uproject |
| Default model | MiniMax M2.7 | MiniMax M2.7 |
| Binary name | `dh` | `unreal-agent` |

---

## Build & Test (when working end-to-end)

1. `npm install`
2. `npm run build`
3. `./bin/unreal-agent version` → "unreal-agent v0.1.0"
4. `./bin/unreal-agent doctor --mcp` → checks UE MCP at :8000
5. `./bin/unreal-agent run "list the modules in Source/"`

---

## Future v0.2
- UE-specific C++ linting (clang-tidy wrapper)
- Blueprint class generation via MCP
- Per-platform cooking/packaging
- Multi-MCP relay (UE + GitHub + CI)
- Editor process control (launch/kill via MCP)
