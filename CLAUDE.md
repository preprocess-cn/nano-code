# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

- `npm run build` — TypeScript compile (tsc)
- `npm start` — run compiled output
- `npm run dev` — watch mode (tsc --watch + node --watch)
- `npm test` — run all tests (Node test runner + tsx)
- `npx tsx src/index.ts` — run directly without building
- `npx tsx src/index.ts --debug` — run with debug output
- `npx tsx src/index.ts --think` — show LLM thinking traces

## Project Overview

nano-code is a lightweight CLI AI coding assistant with a ReAct agent loop. It connects to any OpenAI-compatible API (OpenAI, DeepSeek, Ollama via `OPENAI_BASE_URL`), streams responses, and provides file operations through tool calling.

## Architecture

```
src/
  index.ts              — CLI entry (cac arg parsing, clack prompts, main loop)
  agent.ts              — NanoCodeAgent: ReAct loop, tool call dispatch, think-tag filtering
  llm.ts                — LLMClient: OpenAI streaming API wrapper
  tools/
    index.ts            — Tool registry: aggregates all schemas, routes tool calls
    schema.ts           — ToolResponse type, formatToolResponse helper
    fileViewer.ts       — list_project_files, view_file_content (path-traversal safe)
    fileWriter.ts       — write_file_content (with human-in-the-loop confirm)
    commandRunner.ts    — run_bash_command (dangerous command blacklist, 30s timeout, log truncation)
    filePatcher.ts      — patch_file (search-and-replace with exact match)
tests/
  commandRunner.test.ts
  environmentSnapshot.test.ts
  security.test.ts
```

## Key Design Decisions

- **Streaming-first**: LLM responses stream through a `<think>` tag filter that hides reasoning from the user unless `--think` is enabled
- **Human-in-the-loop**: File writes, bash commands, and file patches require interactive user confirmation via `@clack/prompts`
- **Security**: Path traversal prevention (all paths resolved against CWD), dangerous-command blacklist (rm -rf, dd, shutdown, fork bombs, reverse shells), silent blocking without prompt
- **Log truncation**: Command output >8KB is truncated (first 4KB + last 4KB) to protect LLM context
- **Response format**: All tools return `ToolResponse { status, data?, message? }` serialized as JSON strings
