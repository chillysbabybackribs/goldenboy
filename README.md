# Goldenboy

Goldenboy is a local Electron desktop app that pairs a chat-driven command center with an embedded multi-tab browser and a real terminal backed by `node-pty`. A Codex-backed agent runtime invokes host-managed tools to operate the browser, filesystem, and terminal during a single task.

It is designed for hands-on local workflows where the model can reason in chat, inspect the browser, and use the terminal in the same turn.

The UI is plain HTML/CSS + TypeScript compiled with `tsc`. There is no bundler and no UI framework.

For agent contract, runtime rules, and file map, see [AGENTS.md](./AGENTS.md).

## Quick Start

```bash
git clone https://github.com/chillysbabybackribs/goldenboy.git
cd goldenboy
npm install
npm start
```

If you want local environment overrides, copy `.env.example` to `.env`.

## What The App Does

- Opens two windows: `Command Center` and `Execution`.
- Lets you chat with an agent, attach files, and keep task history.
- Gives the agent host-managed browser, filesystem, terminal, runtime, and sub-agent tools.
- Persists browser session data, bookmarks, settings, tasks, token counters, and chat memory across launches.
- Restores browser state and terminal context on the next run.

## Architecture

Codex is the sole model runtime. There is no provider routing or cross-provider fallback.
Deterministic workflow helpers may still exist under `src/main/agent/workflows/`, but they are not part of the normal live `AgentRuntime` path.

```text
Electron main process
├─ AgentModelService
│  └─ AppServerBackedProvider -> codex app-server (ws) via the host tool bridge
├─ AgentRuntime + AgentToolExecutor + ConstraintValidator
├─ BrowserService
│  ├─ persistent browser session (partition persist:workspace-browser)
│  ├─ tabs, bookmarks, downloads, extensions, diagnostics
│  └─ browser perception / page analysis / browsing-history store
├─ TerminalService
│  └─ direct PTY shell session (no tmux)
├─ ChatKnowledgeStore / TaskMemoryStore / FileKnowledgeStore / PageKnowledgeStore
└─ IPC + event router + persisted app state

Renderer windows
├─ command/     chat UI, task history, logs, token usage
└─ execution/   browser chrome + embedded browser + terminal pane
```

Codex is driven by the locally running `codex app-server` process. The `codex` CLI is only probed on startup to confirm availability; it is not used for task execution.

## Requirements

- Node.js 20+ (Node 22+ recommended — the runtime uses the native `WebSocket` global).
- `codex` available on your `PATH`.
- A working `codex` authentication setup.

## Environment

The app works without extra environment variables for the default Codex flow. These are the ones that matter:

```bash
# Optional: override the detected repository root
export GOLDENBOY_WORKSPACE_ROOT=/absolute/path/to/your/repo

# Optional: useful on machines with GPU rendering issues
export GOLDENBOY_DISABLE_HARDWARE_ACCELERATION=1
```

Use [.env.example](./.env.example) as the template for a local `.env` file.

## Install

```bash
git clone https://github.com/chillysbabybackribs/goldenboy.git
cd goldenboy
npm install
cp .env.example .env  # optional: only if you want local env overrides
```

Before launching, make sure `codex --version` works in your shell.

## Run

For a normal launch:

```bash
npm start
```

For active development:

```bash
npm run dev
```

`npm run dev` watches `src/`, `scripts/`, and the TypeScript config files, rebuilds the app, and restarts Electron automatically.

## Useful Scripts

```bash
npm test                 # Vitest unit/integration tests
npm test -- path/to/file.test.ts
npm run build            # compile main + preload + renderer
npm run build:main
npm run build:preload
npm run build:renderer
npm run copy:html
npm run clean
```

## How To Use It

### 1. Start the app

Run `npm start` or `npm run dev`.

On launch, Electron creates two windows:

- `Command Center`
- `Execution`

The execution window initializes the embedded browser and starts or reconnects the terminal session automatically.

### 2. Codex runtime

The command center shows Codex runtime status in the footer. The app invokes Codex for every task. If Codex is unavailable, model tasks cannot run until Codex is fixed.

### 3. Start a task

Type into the chat box and press `Enter`, or click the send button.

What happens:

- If no task is active, the app creates one automatically from the first prompt.
- The prompt is written into chat history and task memory.
- The Codex runtime is invoked.
- Live progress appears in the chat stream and the logs panel.

Use `Shift+Enter` for a newline in the prompt.

### 4. Add attachments when needed

The command window supports:

- document selection from the `Doc` button
- image selection from the `Image` button
- direct image paste into the chat input

### 5. Switch between tasks

Use `HISTORY` in the command window to:

- reopen older tasks
- switch the active task
- clear the active task with `NEW CHAT`

`NEW CHAT` does not delete prior tasks — it clears the active task so the next prompt starts a fresh one.

### 6. Watch the execution surfaces

The `Execution` window contains:

- a browser pane with tabs and navigation controls
- a terminal pane

The browser pane includes back / forward / reload / stop, address bar, bookmark button, zoom controls, DevTools toggle, and a menu panel with history, bookmarks, downloads, diagnostics, extensions, and settings.

The terminal pane starts a shell with `node-pty`, uses the current shell from `SHELL` on Unix or `COMSPEC` on Windows, restores the last known working directory when possible, and supports restart and collapse/expand from the pane header.

### 7. Use the browser manually when needed

The embedded browser is a real persistent Electron session. It keeps tabs, history, bookmarks, cookies/storage, and extension state.

Useful shortcuts:

- type a URL into the address bar
- `Cmd/Ctrl+L` — focus the address bar
- `Cmd/Ctrl+F` — find in page
- `Cmd/Ctrl+T` — new tab
- `Cmd/Ctrl+W` — close the active tab

The browser runtime can also import Chrome cookies into the app session when available.

### 8. Use the terminal manually when needed

The terminal is live and interactive. You can type directly into it, restart it from the execution window, or let the agent run terminal actions through the host tool runtime. The active terminal surface is a direct PTY session — not tmux.

### 9. Stop a running task

If a model run is active, the command window shows a `STOP` button. Pressing it closes the active app-server run and cancels any in-flight tool calls.

### 10. Read logs and token counters

The command window always shows:

- a logs panel on the right
- cumulative input/output token counters
- Codex runtime status in the footer

Use this to debug runtime availability, prompt-budget logs, browser/runtime initialization, and failed runs or tool errors.

## Persistence

The app persists state under Electron `userData`, including:

- window positions
- execution split ratio
- tasks and active task id
- token usage totals
- chat thread cache
- browser history, bookmarks, settings, downloads, and session state

On restart:

- previous tasks are still available
- active running tasks are restored as completed state records, not resumed live
- browser tabs and session state are restored

## Accuracy Notes

- Codex is driven by the locally running `codex app-server` process; the `codex` CLI is only probed on startup.
- The renderer stack is vanilla TypeScript/HTML/CSS, not React.
- The browser session uses Electron persistent partition `persist:workspace-browser`.
- The terminal service is PTY-based and not tmux-backed.

## Troubleshooting

- If Codex is unavailable, check that `codex --version` works and that your Codex CLI is authenticated.
- If the app opens in the wrong workspace, set `GOLDENBOY_WORKSPACE_ROOT`.
- If Electron rendering is unstable or black, try `GOLDENBOY_DISABLE_HARDWARE_ACCELERATION=1`.
- If UI changes do not appear, rerun `npm start` or use `npm run dev` so renderer assets are rebuilt and recopied.
