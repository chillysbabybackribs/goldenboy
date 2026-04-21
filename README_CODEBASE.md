# V2 Workspace — A Local AI Workbench Desktop App

This is an **Electron-based desktop application** that pairs a chat interface with live browser and terminal surfaces, designed for hands-on AI-assisted development and research workflows.

## Core Purpose
V2 Workspace lets you chat with an AI agent in real time while the agent:
- **Operates a multi-tab browser** — navigate, extract data, interact with web pages
- **Runs terminal commands** — execute scripts, manage files, run builds
- **Inspects and modifies files** — read, edit, search, and patch code in the workspace
- **Manages task memory** — persists chat history, bookmarks, downloads, browser session state across restarts

## Architecture at a Glance

**Three windows:**
- **Command Center** — chat input, task history, model selection, live logs, token usage tracking
- **Execution Surface** — embedded Chromium browser + terminal pane + UI chrome

**Two processes:**
- **Main (Node.js)** — owns all services: browser runtime, terminal session, agent runtime, file system, state store, IPC routing
- **Renderer (TypeScript/HTML)** — vanilla UI, no framework

**Three AI model integrations:**
- **Codex** — via local `codex` CLI command
- **Haiku** — via Anthropic SDK (with API key)
- **Gemini** — optional sidecar for research/synthesis tasks

## How It Works

1. You type a task in the chat
2. V2 routes it to a model provider (Codex by default, or Haiku/Gemini)
3. The model reasons about what it needs and asks V2 to run **typed tools**
4. V2 executes the tool (browser nav, terminal exec, file read/edit) and returns results to the model
5. The model acts on the result until the task completes

The runtime enforces:
- **Constraint validation** — after each tool runs, V2 validates whether it met its constraints and marks results VALID/INCOMPLETE/INVALID (the model cannot override these)
- **Knowledge caches** — browser page cache, file cache, chat memory to reduce token costs
- **Task memory** — persists everything across restarts

## Key Technologies
- **TypeScript** (no bundler — direct `tsc` compilation)
- **Electron 41+**
- **Chromium browser** (embedded via Electron)
- **node-pty** (real PTY terminal sessions)
- **Vitest** (unit/integration tests)
- **Anthropic SDK**, **Gemini API** (optional providers)

## Why It Exists
Traditional chatbots can't *see* or *act* on local context. V2 bridges that gap — it's a workbench where the model can reason *and* operate, seeing browser state, file contents, terminal output in real time, making it practical for debugging, research, code review, and complex local workflows.
