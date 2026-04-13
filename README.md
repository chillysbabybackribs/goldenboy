# V2 Workspace

V2 Workspace is a desktop Electron workbench for running agent tasks against three local surfaces at once:

- a chat-driven command window
- an embedded multi-tab browser
- a live terminal backed by `node-pty`

The current codebase uses two model backends:

- `gpt-5.4` via the local `codex` CLI
- `haiku` via the Anthropic API

This is not a React app. The renderers are plain HTML/CSS plus TypeScript compiled with `tsc`.

## What The App Does

- Opens two windows: `Command Center` and `Execution`
- Lets you chat with an agent, attach images, and keep task history
- Gives the agent host-managed browser, filesystem, terminal, runtime, and sub-agent tools
- Persists browser session data, bookmarks, settings, tasks, token counters, and chat memory across launches
- Restores browser state and terminal context on the next run

## Current Architecture

```text
Electron main process
├─ AgentModelService
│  ├─ CodexProvider -> codex exec --json --model gpt-5.4
│  └─ HaikuProvider -> Anthropic SDK
├─ AgentRuntime + tool packs + provider tool runtime
├─ BrowserService
│  ├─ persistent browser session
│  ├─ tabs, bookmarks, downloads, extensions, diagnostics
│  └─ browser perception / page analysis / page knowledge cache
├─ TerminalService
│  └─ plain PTY shell session, no tmux
├─ ChatKnowledgeStore / TaskMemoryStore / FileKnowledgeStore / PageKnowledgeStore
└─ IPC + event router + persisted app state

Renderer windows
├─ command/
│  └─ chat UI, task history, model selection, logs, token usage
└─ execution/
   └─ browser chrome + embedded browser + terminal pane
```

## Requirements

- Node.js 18+ and npm
- `codex` available on your `PATH`
- a working `codex` authentication setup for `gpt-5.4`
- optional: `ANTHROPIC_API_KEY` if you want the Haiku provider

## Environment

The app works without extra environment variables, but these are the important ones:

```bash
# Recommended if your checkout is not /home/dp/Desktop/v2workspace
export V2_WORKSPACE_ROOT=/absolute/path/to/your/repo

# Optional: enables the Haiku provider
export ANTHROPIC_API_KEY=your_key_here

# Optional: override the Haiku model id
export ANTHROPIC_MODEL=claude-haiku-4-5-20251001

# Optional: useful on machines with GPU rendering issues
export V2_DISABLE_HARDWARE_ACCELERATION=1
```

Important: the current codebase defaults `V2_WORKSPACE_ROOT` to `/home/dp/Desktop/v2workspace`. If you clone the repo anywhere else, set `V2_WORKSPACE_ROOT` before launching.

The Haiku provider also reads `.env` in the project root, so putting `ANTHROPIC_API_KEY=...` there works too.

## Install

```bash
git clone https://github.com/chillysbabybackribs/goldenboy.git
cd goldenboy
npm install
```

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
npm test
npm run build
npm run build:main
npm run build:preload
npm run build:renderer
npm run copy:html
npm run benchmark:tools
npm run clean
```

## How To Use It

### 1. Start the app

Run `npm start` or `npm run dev`.

On launch, Electron creates two windows:

- `Command Center`
- `Execution`

The execution window initializes the embedded browser and starts or reconnects the terminal session automatically.

### 2. Choose how model routing should work

In the `Command Center`, the top compose bar has provider buttons:

- `GPT-5.4`
- `HAIKU`

Behavior:

- click a provider button once to force that provider
- click the same button again to return to `Default`

Default routing is prompt-based:

- research-style prompts prefer `haiku` when it is available
- implementation, debug, review, and orchestration prompts prefer `gpt-5.4`

If `codex` is unavailable, `gpt-5.4` will not be selectable. If `ANTHROPIC_API_KEY` is missing, Haiku will not be available.

### 3. Start a task

Type into the chat box and press `Enter`, or click the send button.

What happens:

- if no task is active, the app creates one automatically from the first prompt
- the prompt is written into chat history and task memory
- the selected provider is invoked
- live progress appears in the chat stream and the logs panel

Use `Shift+Enter` for a newline in the prompt.

### 4. Add attachments when needed

The command window supports:

- document selection from the `Doc` button
- image selection from the `Image` button
- direct image paste into the chat input

Current behavior:

- image attachments are sent to the model
- documents are shown in the UI, but the model invocation path is currently image-focused

### 5. Switch between tasks

Use `HISTORY` in the command window to:

- reopen older tasks
- switch the active task
- clear the active task with `NEW CHAT`

`NEW CHAT` does not delete prior tasks. It simply clears the current active task so the next prompt starts a fresh one.

### 6. Watch the execution surfaces

The `Execution` window contains:

- a browser pane with tabs and navigation controls
- a terminal pane

The browser pane includes:

- back / forward / reload / stop
- address bar
- bookmark button
- zoom controls
- DevTools toggle
- menu panel with history, bookmarks, downloads, diagnostics, extensions, and settings

The terminal pane:

- starts a shell with `node-pty`
- uses the current shell from `SHELL` on Unix or `COMSPEC` on Windows
- restores the last known working directory when possible
- supports restart and collapse/expand from the pane header

### 7. Use the browser manually when needed

The embedded browser is a real persistent Electron session. It keeps:

- tabs
- history
- bookmarks
- cookies and storage
- extension state

Useful browser actions:

- type a URL into the address bar
- use `Cmd/Ctrl+L` to focus the address bar
- use `Cmd/Ctrl+F` for find-in-page
- use `Cmd/Ctrl+T` for a new tab
- use `Cmd/Ctrl+W` to close the active tab

The browser runtime can also import Chrome cookies into the app session when available.

### 8. Use the terminal manually when needed

The terminal is live and interactive. You can:

- type directly into it
- restart it from the execution window
- let the agent run terminal actions through the host tool runtime

This codebase does not use tmux for the active terminal surface. It is a direct PTY session.

### 9. Stop a running task

If a model run is active, the command window shows a `STOP` button.

Pressing it calls the provider cancel path:

- Codex runs are aborted by killing the current `codex` subprocess
- Haiku runs are aborted by stopping the Anthropic stream

### 10. Read logs and token counters

The command window always shows:

- a logs panel on the right
- cumulative input/output token counters
- provider status in the footer

Use this to debug:

- provider availability
- prompt-budget logs
- browser/runtime initialization
- failed runs or tool errors

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

## Accuracy Notes About The Current Codebase

- `gpt-5.4` is not a direct SDK integration here. It is run through `codex exec`.
- Haiku is the only provider using the Anthropic SDK directly.
- The renderer stack is vanilla TypeScript/HTML/CSS, not React.
- The browser session uses Electron persistent partition `persist:workspace-browser`.
- The terminal service is plain PTY-based and not tmux-backed.

## Benchmarks And Tests

- Browser capability notes live in [BROWSER_BENCHMARKS.md](./BROWSER_BENCHMARKS.md)
- Tool-pack benchmarking is exposed through `npm run benchmark:tools`
- Unit and integration coverage is in `vitest`

## Troubleshooting

- If `GPT-5.4` is unavailable, check that `codex --version` works and that your Codex CLI is authenticated.
- If Haiku is unavailable, set `ANTHROPIC_API_KEY`.
- If the app opens in the wrong workspace, set `V2_WORKSPACE_ROOT`.
- If Electron rendering is unstable or black, try `V2_DISABLE_HARDWARE_ACCELERATION=1`.
- If UI changes do not appear, rerun `npm start` or use `npm run dev` so renderer assets are rebuilt and recopied.
