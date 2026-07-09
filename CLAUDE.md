# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test

```bash
# Build (compile TypeScript)
npm run build

# Run all tests
npm test

# Run tests in watch mode
npx tsx --test --watch tests/*.test.ts

# Type check only (no emit)
npx tsc --noEmit -p tsconfig.test.json

# Run without compiling (development)
npx tsx src/index.ts

# Run with specific options
npx tsx src/index.ts --debug    # debug mode (LLM raw packets)
npx tsx src/index.ts --think    # show chain-of-thought
npx tsx src/index.ts --continue # resume last session
npx tsx src/index.ts --profile treehole  # agent profile mode
```

## Architecture Overview

nano-code is a lightweight CLI AI coding assistant with a **plugin-driven, layered architecture**:

```
CLI (cac) → Agent Loop → PluginRegistry → LLM Client (OpenAI API)
                    ↕
              Builtin Plugins (fs, command, memory, token-budget)
              MCP Plugins (stdio/HTTP JSON-RPC)
              npm Plugins (dynamic import())
              Agent Tools (sub-agents via ~/.nano-code/agents/*.yaml)
```

### Core Loop (`src/agent.ts`)

`NanoCodeAgent.runTask()` implements a ReAct loop:
1. Build system prompt (role + project files + plugin hooks)
2. Send messages to LLM via streaming API
3. If LLM returns tool calls → execute each via PluginRegistry
4. Feed tool results back → repeat until LLM stops requesting tools

### Plugin System (`src/plugin.ts`)

`NanoPlugin` interface with hooks: `getTools()`, `execute()`, `onInit`, `onDestroy`, `onSystemPrompt`, `onBeforeRequest`, `onAfterRequest`, `onBeforeToolCall`, `onAfterToolCall`. `PluginRegistry` manages registration, tool routing, and hook chain execution.

### Display Layer (`src/display.ts`)

`DisplayPlugin` interface for UI. `DisplayManager` supports multiple plugins. Default is REPL (`src/plugins/display/repl.ts`). The TUI under `src/plugins/display/` is a separate display implementation still in development.

### Key Source Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point, CLI arg parsing, config loading, plugin registration |
| `src/agent.ts` | `NanoCodeAgent` — main ReAct loop |
| `src/plugin.ts` | `NanoPlugin` interface + `PluginRegistry` |
| `src/config.ts` | Multi-layer config (global YAML → project YAML → profile overlay) |
| `src/llm.ts` | `LLMClient` — OpenAI-compatible streaming API + retry logic |
| `src/prompt.ts` | System prompt builder (template + project files + plugin hooks) |
| `src/contract.ts` | Shared types: `ToolResponse`, `ToolDefinition`, `ToolContext` |
| `src/display.ts` | `DisplayPlugin` interface + `DisplayManager` + `printPluginList` |
| `src/session.ts` | Session persistence (`.nano-code-session.json`) |
| `src/think-stream.ts` | `<think>` tag stream filter |
| `src/agent-loader.ts` | Scan `~/.nano-code/agents/*.yaml` for agent definitions |
| `src/agent-tool.ts` | Wrap agent definition as a `NanoPlugin` tool for sub-agent |
| `src/plugin-cli.ts` | `nano-code plugin install/list/enable/disable` |
| `src/plugins/tools/fs.ts` | File system tools (list, read, write, patch) |
| `src/plugins/tools/command.ts` | Bash command execution with danger blacklist |
| `src/plugins/tools/memory.ts` | Persistent memory (save/recall with tags) |
| `src/plugins/mcp/adapter.ts` | MCP stdio/HTTP transport + JSON-RPC client |
| `src/plugins/token-budget.ts` | Token usage tracking and budget enforcement |
| `src/plugins/npm-loader.ts` | Dynamic `import()` of npm packages as NanoPlugin |

### Key Design Decisions

- **Plugin-driven**: Core has no built-in business tools. Everything (fs, command, memory) is a plugin registered at startup.
- **Sub-agent isolation**: Agent tools (`agent-tool.ts`) spawn independent `NanoCodeAgent` + `PluginRegistry` instances. They share the LLM client but have separate plugin sets and message histories. Recursive guard: sub-agents never register agent tools.
- **Side-effect flag**: Each tool has `sideEffect: boolean`. `false` = read-only, auto-executed without user confirmation. Used in `ToolContext`.
- **Config layering**: Shell env > `$CWD/.env` > `~/.nano-code/.env` > project `.nano-code.yaml` > global `~/.nano-code/config.yaml` > defaults.
- **ThinkStream**: The REPL display uses `ThinkStream` to strip `<think>...</think>` tags from stream output unless `--think` is on.
- **MCP transport**: Supports both stdio (child process) and HTTP transports, with exponential backoff retry, timeout per request, and cleanup on destroy.
- 当要求浏览代码时候，优先使用codebase-memory-mcp工具进行
- **核心层不动原则**：新功能开发时，如无必要，尽量不要改动核心层（`src/core/`）和接口层（`src/plugin.ts`、`src/contract.ts`）。优先利用现有的插件钩子（`onBeforeRequest`、`onBeforeToolCall`、`onSystemPrompt` 等）在插件层实现。核心层的稳定比任何单一功能都重要。

## Versioning

- Tags 统一使用 `v` 前缀语义化版本，如 `v0.1.0`、`v0.1.1`
