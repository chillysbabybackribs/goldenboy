# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` is the canonical contract for agent behavior, tool rules, file map, validation discipline, and sub-agent rules. Load it first for any task that touches the agent runtime.

When wiring Haiku 4.5 as a sub-agent, load `AGENTS.md` first, then task-relevant files from `skills/`.

---

## What This Repository Is

**V2 Workspace** — a local Electron desktop app that pairs a chat-driven command center with an embedded browser and terminal. An AI agent runtime routes tasks to model providers (Codex via CLI, Haiku via Anthropic SDK), which invoke host-managed tools to operate the browser, filesystem, and terminal on behalf of the user.

---

## Commands

```bash
npm run dev          # watch-mode rebuild + auto-restart Electron
npm start            # one-shot build + launch
npm test             # Vitest unit/integration tests
npm test -- path/to/file.test.ts   # run a single test file
npm run build        # compile main + preload + renderer
npm run clean        # remove dist/
npm run benchmark:tools  # tool performance benchmark
```

TypeScript is compiled directly with `tsc` — no bundler. Output lands in `dist/`.

---

## Architecture

### Process split

| Layer | Path | Role |
|---|---|---|
| Main (Node.js) | `src/main/` | Electron main process — owns all services |
| Preload | `src/preload/` | Exposes typed IPC bridge to renderer |
| Renderer | `src/renderer/` | Vanilla TS/HTML UI (no framework) |
| Shared | `src/shared/` | Types shared across all three processes |

### Agent runtime

All model-driven work flows through:

```
CodexProvider / HaikuProvider
  → AgentRuntime
  → AgentPromptBuilder
  → AgentToolExecutor (runs tool packs, constraint validation)
  → existing app services (BrowserService, TerminalService, state store)
```

Providers (`src/main/agent/CodexProvider.ts`, `HaikuProvider.ts`) are selected by `providerRouting.ts` based on task profile. Neither provider may call Electron, `BrowserService`, `fs`, or IPC handlers directly — all side effects go through tool modules.

### Tool packs

Tools are grouped into named packs in `src/main/agent/toolPacks.ts`. Tasks start with a baseline pack; `preflightExpand` analyses task text and adds relevant packs before the first model call. Models can request additional packs at runtime. The canonical dotted tool names live in `docs/agent/contracts/tool-names.md`.

### Constraint validation

`ConstraintValidator.ts` runs after every tool execution. It checks exit codes, URL matches, evidence sufficiency, etc., and appends a `--- RUNTIME VALIDATION ---` block to tool results. These verdicts are authoritative — the model cannot override them. See `AGENTS.md` §Result Validation Discipline for the full classification rule.

### State

Redux-like store in `src/main/state/` (`reducer.ts`, `actions.ts`, `persistence.ts`). IPC registration in `src/main/ipc/registerIpc.ts`. Windows in `src/main/windows/windowManager.ts`.

### Caches

Three knowledge caches sit between raw I/O and the model: browser page cache (`src/main/browserKnowledge/`), file cache (`src/main/fileKnowledge/`), and chat cache (`src/main/chatKnowledge/`). Prefer cache tools over broad reads to keep token costs low.

### Skills

Agent skill definitions live in `skills/<skill-name>/SKILL.md`. Load only skills relevant to the current task — do not inject all skills into every prompt.
