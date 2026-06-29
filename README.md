# Unreal Agent

**Task-specific coding harness for Unreal Engine 5.**

Built fresh, separate from DuckHive-CLI and the existing CodingHarness. Connects to the UE 5.8 native MCP server at `http://127.0.0.1:8000/mcp` (or any MCP-compatible server you point it at).

`★ Insight ─────────────────────────────────────`
- Cloud-only models (MiniMax M2.7 primary) — no local model dependency
- HTTP-only MCP client (UE 5.8 native runs over HTTP POST + JSON-RPC 2.0)
- Reads `.uproject` and injects UE context into every system prompt
- Tool-use loop with up to 10 iterations of bash / read / write / edit / MCP
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
│   ├── registry.ts         MiniMax, Grok, OpenRouter
│   └── client.ts           OpenAI-protocol caller + streamer
├── agent/
│   ├── loop.ts             Tool-use loop (up to 10 iterations)
│   ├── tools.ts            Built-in: read, write, edit, ls, grep, find, bash
│   └── mcp-client.ts       MCP HTTP client (JSON-RPC 2.0 + SSE)
└── ue/
    └── project.ts          .uproject detection + UE context builder
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
- `MINIMAX_API_KEY`, `MINIMAX_MODEL`
- `GROK_API_KEY`, `GROK_MODEL`
- `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`
- `UE_PROJECT` (path to .uproject)
- `UE_MCP_URL` (default `http://127.0.0.1:8000/mcp`)

If you switch providers without setting a model explicitly, the harness now follows that provider's configured default model automatically.

## UE 5.8 MCP server

Epic added native MCP to UE 5.8 (released June 17, 2026). The server ships with the engine and is enabled via an `.uproject` plugin. By default it listens on port 8000.

```bash
# Check that the UE editor has the MCP plugin enabled and the server is up
curl -s -X POST http://127.0.0.1:8000/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}'
```

## Cloud-only rule

Per Duckets' directive 2026-06-10, no local models. MiniMax is the primary provider. Override with `--provider` flag.

## What's NOT here

By design (this is task-specific, not a general CLI):

- ❌ No MoA (mix-of-agents)
- ❌ No council
- ❌ No sub-agents
- ❌ No skill system (yet)
- ❌ No streaming UI

Use **DuckHive-CLI** for those.

## License

MIT
