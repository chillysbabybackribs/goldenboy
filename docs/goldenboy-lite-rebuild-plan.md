# Goldenboy Lite Rebuild Plan

Status: historical design/reference material. This document describes a possible separate rebuild direction, not the current in-repo implementation plan.

## Objective

Rebuild Goldenboy in a separate directory as a much lighter Electron app that preserves the current product shape:

- command window
- execution window
- embedded browser
- terminal
- Codex-first chat runtime

The rebuild should keep most of the current UI patterns while removing platform-level complexity from the agent runtime, browser stack, and prompt/tooling layers.

Initial working name:

- `goldenboy-lite/`

This plan assumes a fresh implementation, not an in-place refactor.

## Product Thesis

Goldenboy is strongest when it behaves like a focused local Codex workbench.

It is weakest when it behaves like:

- a generalized agent platform
- a browser automation lab
- a workflow engine
- a memory-heavy orchestration system

The rebuild should optimize for:

- fast startup
- low cognitive load
- predictable Codex behavior
- minimal browser overhead
- simple code ownership
- easy debugging

## Non-Goals

Do not carry these into v1 unless a concrete user workflow proves they are necessary:

- sub-agent runtime
- deterministic workflow executor
- tool registry search/discovery
- split browser view
- browser bookmarks/extensions
- Chrome cookie import
- rich browser settings surface
- download manager
- dialog manager UI
- browser overlay ranking system
- page knowledge store and background extraction
- multi-layer task/chat/browser memory injection
- broad filesystem mutation tools
- broad browser automation verbs

## Success Criteria

The rebuild is successful if it achieves all of the following:

1. The app still feels like Goldenboy.
2. The UI layout is recognizably the same in the command and execution windows.
3. Codex runs through a much thinner runtime with fewer prompt layers and fewer tools.
4. The browser is materially simpler and faster to reason about.
5. The codebase is small enough that one engineer can understand the runtime in a single sitting.
6. A common user flow works end-to-end:
   open app -> create task -> talk to Codex -> inspect page -> read local files -> run terminal command -> continue same thread.

Suggested hard targets:

- under `12k` TypeScript lines for v1
- under `25` main-process files
- under `12` agent-facing tools
- one browser service, one agent runtime, one task store

## Current-State Findings

The existing codebase is not primarily heavy because of Electron or the renderer UI.

The complexity is concentrated in:

- `src/main/agent/`
- `src/main/browser/`
- the large browser tool surface
- prompt assembly and runtime context injection

Current hotspots:

- `src/main/agent/AgentModelService.ts`
- `src/main/agent/AgentRuntime.ts`
- `src/main/agent/AppServerProvider.ts`
- `src/main/browser/BrowserService.ts`
- `src/main/browser/browserOperations.ts`
- `src/main/agent/tools/browser/index.ts`

The current renderer is large but salvageable. The main-process runtime is where the rebuild should be ruthless.

## Proposed Repository Shape

Add a new top-level directory:

```text
goldenboy-lite/
  package.json
  tsconfig.json
  src/
    main/
      main.ts
      windows/
      ipc/
      state/
      browser/
      terminal/
      agent/
      tools/
    preload/
      preload.ts
    renderer/
      command/
      execution/
      shared/
    shared/
      types/
  docs/
    architecture.md
    decisions/
```

## Architecture Principles

### 1. Thin Main Process

The main process should assemble a small number of long-lived services:

- `TaskStore`
- `BrowserServiceLite`
- `TerminalServiceLite`
- `AgentServiceLite`
- `IpcRouter`

No extra orchestration layer unless a real problem forces it.

### 2. Session-Bound Agent Runtime

One task maps to one Codex thread/session.

The runtime should own only:

- thread/session reuse
- tool invocation loop
- cancellation
- compact context building
- final output streaming

It should not own:

- complex planning metadata
- orchestration summaries
- skill-loading system
- multi-mode workflow interception
- large prompt template cache systems

### 3. Browser As A Work Surface, Not A Platform

The browser should support only the user flows the product actually needs:

- create/close/activate tabs
- navigate
- read current page
- click/type/wait
- move surface between windows

Everything else starts out deleted.

### 4. Small, Stable Tool Surface

The agent should have a small number of sharp tools.

Recommended v1 tool list:

- `browser.navigate`
- `browser.extract_page`
- `browser.click`
- `browser.type`
- `browser.wait_for`
- `filesystem.read`
- `filesystem.search`
- `workspace.overview`
- `terminal.exec`
- `terminal.write`

Optional if needed:

- `browser.create_tab`
- `browser.activate_tab`

### 5. Minimal Prompt Contract

The system prompt should be short and stable.

Prompt inputs should be limited to:

- base app contract
- current task text
- compact task summary
- current browser state summary
- active tool list
- current date/time

Do not inject:

- large workspace manifests by default
- browser history digests
- plan snapshots
- prior orchestration guidance
- extra skills unless explicitly required

## Module Plan

### `TaskStore`

Responsibilities:

- create/update tasks
- append chat turns
- persist one rolling summary per task
- persist current Codex thread id

Data model:

- `tasks`
- `turns`
- `task_summary`
- `runtime_session`

Avoid:

- multiple memory stores
- browser knowledge stores
- plan snapshot models

### `AgentServiceLite`

Responsibilities:

- connect to Codex app-server
- reuse thread by task
- send task + compact context
- stream output
- handle tool calls
- persist usage and thread id

Internal shape:

- `CodexClient`
- `AgentSession`
- `PromptBuilderLite`
- `ToolExecutor`

Avoid:

- provider abstraction for multiple models
- dynamic tool registry search
- workflow interception engine
- subagent manager

### `BrowserServiceLite`

Responsibilities:

- own persistent partition/session
- create and attach browser surface
- manage tabs
- expose extract/click/type/wait operations
- emit browser state updates

Keep:

- persistent session partition
- tab model
- secure preload boundary
- safe navigation policy

Drop:

- split view
- extensions
- bookmarks
- downloads UI
- auth diagnostics system
- site strategies
- page intelligence store
- overlay ranking
- broad instrumentation surface

### `TerminalServiceLite`

Responsibilities:

- one terminal session
- exec/write/resize
- capture output
- emit status

Avoid:

- extra orchestration wrappers unless required for UX

### Renderer

Strategy:

- preserve HTML/CSS layout where practical
- split giant controller files into view modules
- keep renderer mostly dumb
- all side effects go through preload IPC

Renderer modules for command window:

- `task-list-view`
- `chat-view`
- `composer-view`
- `browser-strip-view`
- `status-bar-view`

Renderer modules for execution window:

- `browser-view`
- `terminal-view`
- `tab-bar-view`

## Feature Triage

### Keep In V1

- two windows
- task list
- active chat thread
- Codex streaming responses
- browser tab strip
- address bar
- move browser between windows
- terminal pane/session
- attachments only if they are already simple to port

### Defer To V2

- document ingestion/search if it complicates the core runtime
- screenshots/snapshots beyond a basic page extract
- advanced terminal session management
- browser diagnostics views
- token analytics UI
- rich task history buckets

### Delete Entirely For Now

- sub-agents
- workflows
- browser research pipeline with evidence scoring
- browser page memory caches
- tool search/registry UI concerns
- planner-specific context systems

## Implementation Phases

### Phase 0: Lock Scope

Duration:

- 1 to 2 days

Deliverables:

- this rebuild plan approved
- top-level architecture doc
- frozen v1 feature list
- explicit keep/drop matrix

Exit criteria:

- no new v1 features are added without replacing another feature

### Phase 1: Scaffold `goldenboy-lite/`

Duration:

- 1 to 2 days

Deliverables:

- standalone `package.json`
- TypeScript build
- Electron boot
- command and execution windows
- preload bridge

Exit criteria:

- app launches
- both windows render
- basic state round-trip works

### Phase 2: Port The UI Shell

Duration:

- 2 to 4 days

Deliverables:

- command window layout matching current app closely
- execution window layout matching current app closely
- task list shell
- chat shell
- browser chrome shell
- terminal shell

Implementation rule:

- copy visual structure carefully
- do not port old renderer state logic wholesale

Exit criteria:

- side-by-side screenshots are visually close
- renderer code is split into smaller modules

### Phase 3: Build `BrowserServiceLite`

Duration:

- 3 to 5 days

Deliverables:

- persistent browser partition
- tab creation/activation/close
- navigate/back/forward/reload
- attach surface to command or execution window
- basic page extraction
- click/type/wait operations

Exit criteria:

- manual browsing is stable
- agent can navigate and inspect a page
- browser code stays under roughly `1.5k` to `2k` lines total

### Phase 4: Build `TerminalServiceLite`

Duration:

- 1 to 2 days

Deliverables:

- start session
- exec command
- stream output
- write/resize support

Exit criteria:

- one terminal flow works cleanly from both UI and agent

### Phase 5: Build `AgentServiceLite`

Duration:

- 4 to 6 days

Deliverables:

- Codex app-server connection
- task/thread reuse
- minimal prompt builder
- tool execution loop
- cancellation
- output streaming into chat

Exit criteria:

- one task can sustain multiple turns on the same thread
- agent can use browser/filesystem/terminal tools
- runtime code is materially smaller than current `src/main/agent`

### Phase 6: Validation And Hardening

Duration:

- 2 to 4 days

Deliverables:

- smoke tests
- key validation checks
- performance notes
- migration notes

Checks to implement:

- `terminal.exec` exit code validation
- `browser.navigate` URL validation
- `browser.extract_page` non-empty evidence checks

Exit criteria:

- common user flows pass repeatedly
- no known blocker in startup, browser attach, Codex streaming, or tool execution

## Concrete Build Order

Build in this exact order:

1. app shell
2. preload bridge
3. renderer shell
4. browser runtime
5. terminal runtime
6. task store
7. agent runtime
8. minimal validation
9. polish

Do not start by porting the old agent runtime.

That is the highest-risk mistake in this rebuild.

## Keep/Drop Mapping From Current Codebase

### Strong Candidates To Reuse Conceptually

- `src/main/main.ts`
- `src/main/windows/`
- `src/preload/preload.ts`
- renderer HTML/CSS structure
- basic state/persistence concepts

### Reuse Selectively, Not Directly

- `src/main/browser/BrowserService.ts`
- `src/main/terminal/TerminalService.ts`
- `src/main/agent/AppServerProvider.ts`
- `src/main/agent/ConstraintValidator.ts`

These should be rewritten in smaller form, not copied wholesale.

### Do Not Port Into V1

- `src/main/agent/subagents/`
- `src/main/agent/workflows/`
- `src/main/browserKnowledge/`
- `src/main/fileKnowledge/`
- `src/main/chatKnowledge/`
- `src/main/browser/BrowserOverlayManager.ts`
- `src/main/browser/BrowserSiteStrategies.ts`
- `src/main/browser/BrowserDownloadManager.ts`
- `src/main/browser/BrowserDialogManager.ts`
- `src/main/agent/tools/repomap/`
- broad browser tool definitions in `src/main/agent/tools/browser/index.ts`

## Testing Strategy

### Automated

Add only a compact set first:

- app boot smoke test
- browser tab lifecycle test
- browser navigation + extract test
- terminal exec test
- agent thread reuse test
- tool call validation test

### Manual

Run these flows every phase after Phase 3:

1. Open app and create task.
2. Ask Codex to inspect a website.
3. Ask Codex to read a local file.
4. Ask Codex to run a terminal command.
5. Continue the same chat with retained thread context.
6. Move browser between windows and continue working.

## Risks

### Risk: accidental re-import of old complexity

Mitigation:

- forbid direct porting of large runtime files
- rewrite core services from scratch

### Risk: UI port drags old renderer complexity into the new app

Mitigation:

- port markup and styles first
- rewrite controller logic in smaller modules

### Risk: Codex quality drops if too much prompt context is removed

Mitigation:

- keep one compact task summary and current browser state block
- add context back only when a failure is observed

### Risk: browser capability gets too weak

Mitigation:

- start with the five core verbs
- add one verb at a time based on observed failures

## Decisions To Make Before Coding

These should be settled immediately:

1. Should `goldenboy-lite/` live inside this repo or as a sibling repo?
2. Do attachments ship in v1 or get deferred?
3. Is terminal v1 single-session only?
4. Is the execution window always visible, or can browser move back into command like today?
5. Do we want SQLite for task persistence, or JSON/file-backed persistence for v1?

Recommended defaults:

1. inside this repo first
2. defer attachments unless trivial
3. single-session terminal
4. keep browser move/attach behavior
5. JSON/file-backed persistence first

## First Sprint Recommendation

The first sprint should only aim to prove the new architecture, not feature parity.

Sprint goal:

- launch `goldenboy-lite`
- render both windows
- persist tasks
- browse one site
- run one terminal command
- complete one Codex turn with tool use

If that sprint succeeds, the rebuild is on the right track.

If it does not, do not add features. Remove moving parts until it does.

## Immediate Next Step

Create `goldenboy-lite/` and implement only:

- Electron boot
- two windows
- preload bridge
- minimal app state
- browser attach surface
- one terminal session
- one Codex thread per task

Nothing else should be built before that skeleton works.
