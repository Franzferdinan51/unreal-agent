# Unreal Agent

**Task-specific Unreal Engine 5 agent with Grok Build + editor MCP integration.**

The current implementation has two execution paths: a focused OpenAI-compatible
fallback loop and a first-class Grok Build headless path. Grok Build owns the
filesystem/tool loop; this project supplies the Unreal-specific skill and
project context. It connects to the UE 5.8 native MCP server at
`http://127.0.0.1:8000/mcp` (or any MCP-compatible server you point it at).

`★ Insight ─────────────────────────────────────`
- Built-in provider profiles for MiniMax, LM Studio, Ollama, OpenAI, Grok, and OpenRouter
- Custom provider profiles can be added in config for other OpenAI-compatible Hermes-style runtimes
- HTTP-only MCP client (UE 5.8 native runs over HTTP POST + JSON-RPC 2.0)
- Reads `.uproject` and injects UE context into every system prompt
- Tool-use loop with up to 10 iterations of bash / read / write / edit / MCP
- Hermes-derived Unreal MCP skill installed at `.grok/skills/unreal-mcp/`
- Grok Build headless adapter with streaming output and resumable sessions
- Interactive terminal chat loop for multi-turn UE work
`─────────────────────────────────────────────`

## Install

```bash
cd ~/Desktop/Unreal-Agent
npm install
cp .env.example .env   # fill in keys
./bin/unreal-agent version
```

## Quick start

```bash
# Check UE MCP server is reachable
./bin/unreal-agent doctor --mcp

# One-shot task with full tool-use loop
./bin/unreal-agent run "list every C++ class in Source/"

# Interactive chat
./bin/unreal-agent chat

# Use Grok Build as the acting Unreal agent
./bin/unreal-agent grok run "inspect the current level and build a greybox arena"
./bin/unreal-agent grok version

# MCP direct
./bin/unreal-agent mcp list
./bin/unreal-agent mcp call compile_target '{"platform": "Linux"}'

# Use a specific provider/model
./bin/unreal-agent --model minimax-portal/MiniMax-M3 run "find memory leaks in MyActor.cpp"

# Custom MCP URL
./bin/unreal-agent --mcp-url http://192.168.1.10:8000/mcp run "..."
```

## Project layout

```
src/
├── cli.ts                  Entry: run | chat | mcp | doctor | provider
├── config.ts               ~/.unreal-agent/config.json loader
├── types.ts                Core types
├── providers/
│   ├── registry.ts         Built-in + custom provider profiles
│   └── client.ts           OpenAI-protocol caller + streamer
├── agent/
│   ├── loop.ts             Tool-use loop (up to 10 iterations)
│   ├── tools.ts            Built-in: read, write, edit, ls, grep, find, bash
│   └── mcp-client.ts       MCP HTTP client (JSON-RPC 2.0 + SSE)
└── ue/
    └── project.ts          .uproject detection + UE context builder
    └── unreal-skill.ts      Hermes-derived Unreal MCP operating contract
├── grok-build.ts           Grok Build headless adapter
```

## Tools

| Tool | Local / MCP | Purpose |
|------|-------------|---------|
| `read` | local | Read file |
| `write` | local | Write file |
| `edit` | local | oldText → newText |
| `ls` | local | List directory |
| `grep` | local | Search regex |
| `find` | local | Glob find files |
| `bash` | local | Run shell command |
| `mcp__*` | MCP | All tools exposed by the connected MCP server |

## Chat

`./bin/unreal-agent chat` now runs a real multi-turn REPL instead of a one-shot alias.

Built-in chat commands:
- `/help`
- `/clear`
- `/exit` or `/quit`

## Config

Search path (first match wins):
1. `./.unreal-agent.json`
2. `~/.unreal-agent/config.json`

```json
{
  "provider": "minimax",
  "model": "minimax-portal/MiniMax-M2.7",
  "mcpUrl": "http://127.0.0.1:8000/mcp",
  "ueProject": "/abs/path/to/MyGame.uproject"
}
```

Env overrides:
- `UE_AGENT_PROVIDER`, `UE_AGENT_MODEL`
- `OPENAI_API_KEY`, `OPENAI_MODEL`
- `MINIMAX_API_KEY`, `MINIMAX_MODEL`
- `GROK_API_KEY`, `GROK_MODEL`
- `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`
- `LMSTUDIO_BASE_URL`, `LMSTUDIO_MODEL`
- `OLLAMA_BASE_URL`, `OLLAMA_MODEL`
- `UE_PROJECT` (path to .uproject)
- `UE_MCP_URL` (default `http://127.0.0.1:8000/mcp`)

If you switch providers without setting a model explicitly, the harness now follows that provider's configured default model automatically.

Custom providers can be added in config:

```json
{
  "provider": "mygateway",
  "providers": {
    "mygateway": {
      "label": "My Gateway",
      "defaultBaseUrl": "https://llm.example.com/v1",
      "defaultModel": "qwen/qwen3-coder"
    }
  }
}
```

## UE 5.8 MCP server

Epic added native MCP to UE 5.8 (released June 17, 2026). The server ships with the engine and is enabled via an `.uproject` plugin. By default it listens on port 8000.

```bash
# Check that the UE editor has the MCP plugin enabled and the server is up
curl -s -X POST http://127.0.0.1:8000/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}'
```

## Providers

MiniMax is the default, but the harness can also run against LM Studio, Ollama, OpenAI, Grok, OpenRouter, and additional OpenAI-compatible providers defined in config.

## Grok Build integration

The desktop app already launches Grok Build with its documented headless
contract (`grok -p ... --cwd ... --output-format streaming-json`) and handles
MCP, sessions, providers, MoA, and approvals. Unreal Agent now exposes that
same contract through `unreal-agent grok run`, while the checked-in skill makes
the agent follow the Unreal workflow from Hermes' `creative-unreal-mcp` guide:
discover, inspect, call serially, verify, save, and report exact deliverables.

The Grok path is intentionally explicit so the existing provider loop remains
available when Grok Build is not installed.

## What's NOT here

By design (this is task-specific, not a general CLI):

- ❌ No council
- ❌ No sub-agents
- ❌ No duplicate general-purpose desktop UI
- ❌ No streaming UI

Use **DuckHive-CLI** for those.

## License

MIT
