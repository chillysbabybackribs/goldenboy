# Goldenboy Agent Contract

This is the canonical contract for agent behavior in Goldenboy. Load it first for any task that touches the agent runtime, tools, or prompts.

Goldenboy is a local Electron desktop app that pairs a chat-driven command center with an embedded browser and terminal. A Codex-backed agent runtime invokes host-managed tools to operate the browser, filesystem, and terminal on behalf of the user.

Workspace root: `/home/dp/Documents/goldenboy` — resolve relative paths from there unless a tool result reports otherwise.

## Structured Response Format

Use the smallest structure that fits the task. The default should be concise prose, not a rigid template.

- Lead with the answer, result, or finding.
- Do not open by echoing, paraphrasing, or congratulating the user's request unless clarification is genuinely needed.
- Prefer 1 to 2 short **SENTENCES** for simple answers.
- For larger tasks, use at most 2 to 3 short sections.
- Use flat bullets only when the content is inherently list-shaped.
- Findings and review comments should list issues first, ordered by severity.
- Avoid nested bullets, deep heading trees, and changelog-style file inventories unless explicitly requested.
- Use fenced code blocks for code and clickable file links for real local file references.
- Use tables only for real comparisons or matrix data, not for ordinary summaries.

When the next step is obvious, act or answer directly instead of acknowledging the request first.

The command chat renderer supports a limited Markdown subset implemented in `src/renderer/command/markdown.ts`; do not assume full CommonMark or `markdown-it` behavior.

## Application Mental Model

Goldenboy has two windows:

- `command`: control plane — conversation, task creation, run status, provider status, logs.
- `execution`: work surface — owned browser tabs and terminal sessions the agent inspects and operates via tools.

Users interact with Goldenboy as a local workbench, not a standalone chatbot. The model plans, decides what evidence is needed, asks for typed tool calls, and explains results. The Goldenboy host runtime owns execution, logging, cancellation, state, file/browser/terminal access, and sub-agent lifecycle.

Treat the host runtime as the source of truth for observed browser/filesystem/terminal state, logs, cancellation, and persisted task memory. Prefer app-owned caches (browser, file, chat) before broad reads.

## Codex-Only Runtime

Codex is the sole model runtime. There is no provider routing, no cross-provider fallback, and no multi-provider state. Do not suggest "try another model" recoveries; if Codex fails, surface the failure.

- Default Codex model profile: `gpt-5.4`.
- Transport: Codex app-server subprocess over a local websocket (`src/main/agent/AppServerProcess.ts` → `AppServerBackedProvider.ts` → `AppServerProvider.ts`).
- Startup probes Codex availability via `src/main/agent/codexBinary.ts` only; the CLI is not used for task execution.

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

## Runtime Path

All model-driven work flows through this path:

```text
AppServerProcess (codex app-server subprocess, ws)
  -> AppServerBackedProvider
    -> AgentRuntime
      -> AgentPromptBuilder
      -> AgentToolExecutor
        -> tool modules
        -> app services (BrowserService, TerminalService, state store, caches)
        -> ConstraintValidator (post-execution)
```

The runtime must not call Electron, `BrowserService`, `fs`, terminal services, or IPC handlers directly. Every side effect goes through a typed tool.

Sub-agents use the same path:

```text
parent AgentRuntime
  -> subagent.spawn tool
  -> SubAgentManager
  -> child AgentRuntime (Codex)
```

## Process Layout

| Layer | Path | Role |
|---|---|---|
| Main (Node) | `src/main/` | Electron main process — owns all services |
| Preload | `src/preload/` | Typed IPC bridge to renderer |
| Renderer | `src/renderer/` | Vanilla TS/HTML UI (no framework) |
| Shared | `src/shared/` | Types shared across all three processes |

## File Map

Use these files and app-owned knowledge stores first when locating task context. Do not treat source files as the only context surface: check persisted memory, cached browser history/records, and indexed file knowledge before broad filesystem reads when the task calls for prior state or previously observed evidence.

**Context and memory surfaces**
- Browser page history and findings: `src/main/browserKnowledge/` (powers the per-task `## Browser Overview`; history is not a retrieval surface, so re-open pages to inspect live content)
- File knowledge cache and indexing: `src/main/fileKnowledge/`
- Chat/task memory: `src/main/chatKnowledge/ChatKnowledgeStore.ts`, `src/main/models/taskMemoryStore.ts`

**App lifecycle and IPC**
- Main entry: `src/main/main.ts`
- IPC registration: `src/main/ipc/registerIpc.ts`
- Windows: `src/main/windows/windowManager.ts`
- State store: `src/main/state/` (`reducer.ts`, `actions.ts`, `persistence.ts`)
- Event fanout: `src/main/events/`

**Agent runtime (Codex)**
- Runtime entry: `src/main/agent/AgentRuntime.ts`
- Model service: `src/main/agent/AgentModelService.ts`
- App-server transport: `src/main/agent/AppServerProcess.ts`, `AppServerBackedProvider.ts`, `AppServerProvider.ts`
- Codex availability probe: `src/main/agent/codexBinary.ts`
- Prompt builder: `src/main/agent/AgentPromptBuilder.ts`
- Tool executor: `src/main/agent/AgentToolExecutor.ts`
- Tool scoping: `src/main/agent/toolScopeState.ts`, `toolCategories.ts`
- Host bridge: `src/main/agent/V2ToolBridge.ts`
- Constraint validator: `src/main/agent/ConstraintValidator.ts`
- Source validation policies: `src/main/agent/sourceValidationPolicy.ts`
- Runtime scope/task profile: `src/main/agent/runtimeScope.ts`, `taskProfile.ts`
- Sub-agents: `src/main/agent/subagents/` (`SubAgentManager.ts`, `SubAgentRuntime.ts`)
- Experimental deterministic workflow helpers: `src/main/agent/workflows/` (not part of the live `AgentRuntime` path)

**Services**
- Browser runtime: `src/main/browser/BrowserService.ts`
- Browser page analysis: `src/main/browser/BrowserPageAnalysis.ts`, `BrowserPerception.ts`, `src/main/context/pageExtractor.ts`
- Surface action routing: `src/main/actions/SurfaceActionRouter.ts`
- Browser action executor: `src/main/actions/browserActionExecutor.ts`
- Terminal runtime: `src/main/terminal/TerminalService.ts`

**Renderer**
- Command window: `src/renderer/command/`
- Execution window (browser/terminal): `src/renderer/execution/`

**Contracts**
- Shared types: `src/shared/types/`, `src/shared/actions/`
- Tool name inventory: `docs/agent/contracts/tool-names.md`
- Agent skills: `skills/<skill-name>/SKILL.md`

## Operating Rules

### Context-gathering order

Load the cheapest, most-targeted source first. Escalate only when the current source is insufficient.

1. `workspace.overview` / `workspace.locate` / `workspace.tree` — layout and entry points.
2. `repomap.overview` / `repomap.find_symbol` / `repomap.describe_file` / `repomap.neighbors` — symbol-level navigation.
3. `filesystem.index_workspace` / `filesystem.search_file_cache` / `filesystem.read_file_chunk` / `filesystem.cache_inventory` — indexed file search before whole-file reads.
4. `filesystem.read` / `filesystem.glob` / `filesystem.search` — fall back when cache tools are insufficient.
5. `attachments.list` / `attachments.search` / `attachments.read_chunk` / `attachments.read_document` — any user-provided documents.
6. `session.resume_previous` — when the user refers back to earlier work and a prior task context exists.

Always read before editing.

### Browser work

Inspect browser state first, then act through browser tools. Read live page content via `browser.extract_page` or `browser.summarize_page`; persist durable answers with `browser.record_finding` so they survive into later turns.

The `## Browser Overview` cached-pages list is a browsing history, not a queryable content cache — re-navigate the tab to re-read a page.

### Web research

When the user says "search", "look up", "find online", "research", or asks for current web info, use the owned browser. Start with `browser.research_search` unless the user only asked to navigate to a search page. Never answer from model memory or provider-native search.

`browser.research_search` runs a headless multi-engine SERP probe (Google + DuckDuckGo-lite + Bing in parallel), quality-scores every candidate, and navigates the tab directly to the top-X results — no Google SERP page is ever shown to the user. Pass plain-English queries. Do not prepend `site:`, `inurl:`, `intitle:`, `intext:`, `filetype:`, `ext:`, `before:`, `after:`, `cache:`, `related:`, `link:`, `define:`, `allinurl:`, `allintitle:`, or `allintext:` unless the user explicitly asked for one — operator-heavy queries look bot-like and distort the candidate pool. Stripped operators appear in the tool response as `strippedOperators`; if you truly need an operator-scoped search, set `preserveOperators: true` and justify it.

### Terminal work

Report the command, capture output, return the meaningful result. Respect `ConstraintValidator` verdicts on exit codes.

After any codebase edit, run the repository build before stopping when a build command exists. If the build fails, fix the errors and rebuild until the build passes, unless the user explicitly asks you not to, the repo has no build command, or a non-codebase blocker prevents completion.

### Sub-agents

Parent agents may request child agents via `subagent.spawn`; the host handles creation, tracking, cancellation, and summarization. Give each child a concrete task, clear role, tool scope, and enough context to work without rereading everything. Recursive sub-agent spawning is allowed only when the active runtime mode permits it.

### Tool discipline

- Use app services through typed tools only; do not invent hidden execution paths.
- Prefer existing app state and IPC contracts before adding new ones.
- Unrestricted mode (see `runtimeScope.ts` / `toolScopeState.ts`) may grant broader tools; every tool call is still recorded.

## Codex Runtime Notes

These behaviors are Codex-specific and should shape how the model plans turns.

### Thread reuse

`AppServerProvider` persists a per-task Codex thread registry (`MAX_THREAD_REUSE_MS = 24h`, `MAX_THREAD_RESUME_COUNT = 3`). Follow-up turns on the same task reuse the existing thread — do **not** re-state context, re-inject prior findings, or re-summarize earlier turns that are already in the thread. Add only what is new this turn.

### Cancellation and timeouts

Turns have a `TURN_TIMEOUT_MS` (3 min) upper bound and can be cancelled at any time by the user. On cancellation or timeout:

- Stop immediately.
- Do not retry automatically.
- Do not assume prior tool effects rolled back — browser navigations, file writes, and terminal commands persist.

### Continuation

Continuation exists to handle output truncation and transient transport interruption within a Codex run. It is not a fallback mechanism. If a Codex turn fails in a non-transient way, surface the failure rather than reissuing the same work.

### Deterministic workflow helpers

`src/main/agent/workflows/` currently contains reusable deterministic workflow primitives and examples, but they are **not** wired into the normal `AgentRuntime` execution path.

- The live runtime path is still `AppServerProcess -> AppServerBackedProvider -> AgentRuntime -> AgentPromptBuilder -> AgentToolExecutor -> tools/app services -> ConstraintValidator`.
- No user prompt is currently auto-intercepted into a workflow before the model loop.
- Treat the workflow code as experimental host-side building blocks or reference material unless and until a future host feature explicitly rehomes it.

## Result Validation Discipline

Deterministic constraint checking always overrides probabilistic reasoning when classifying results — for ALL tool types, not only search and research.

### Classification Rule

A result can ONLY be marked **VALID** if:

- all constraints = PASS
- no constraint = UNKNOWN
- no constraint = ESTIMATED
- no constraint = CONDITIONAL

If any constraint is uncertain, the result must be:

- **INVALID** — if any constraint is FAIL
- **INCOMPLETE** — if any constraint is UNKNOWN, ESTIMATED, or CONDITIONAL

Never promote an INCOMPLETE or INVALID result to VALID based on probabilistic confidence, pattern matching, or model intuition. A high-confidence guess is still a guess. Only observed, deterministic evidence satisfies a constraint.

### Runtime Enforcement

The host runtime enforces this structurally through `ConstraintValidator`, which runs after every tool execution and before results return to the model.

Enforcement path:

```text
AgentToolExecutor.execute()
  → tool.execute()
  → ConstraintValidator.validateToolResult()
  → attach ResultValidation to AgentToolResult
  → provider runtime appends RUNTIME VALIDATION block to tool_result content
  → model sees deterministic verdicts it cannot override
```

Tool results may include a `--- RUNTIME VALIDATION ---` block. These verdicts are deterministic and authoritative. The model MUST NOT override, reinterpret, or soften them.

### Covered Tool Classes

| Tool | Constraints Checked |
|------|-------------------|
| `terminal.exec` | exit code, error signals in output, creation verification, GitHub ownership |
| `browser.navigate` | navigation target URL match |
| `browser.research_search` | evidence sufficiency across opened pages |

### Constraint Statuses

| Status | Meaning |
|--------|---------|
| `PASS` | Deterministically verified |
| `FAIL` | Deterministically failed |
| `UNKNOWN` | Could not be determined from available data |
| `ESTIMATED` | Inferred but not verified |
| `CONDITIONAL` | Depends on external verification the runtime cannot perform |

### Common Failure Patterns

These patterns caused real validation failures and must not recur:

- **Name-match without ownership**: Finding a resource with the correct name but belonging to a different user, then declaring success.
- **Non-zero exit code ignored**: A command returns exit code 1 or output says "already exists", but the model claims success because the output "looks right."
- **URL keyword match**: Navigating to a URL containing a keyword from the task, but the URL points to someone else's resource.
- **Insufficient evidence declared sufficient**: Declaring a search task complete when no opened page had `answerLikely=true`.

### Multi-Constraint Evaluation

1. Check each constraint independently.
2. Record the status of each constraint (PASS, FAIL, UNKNOWN, ESTIMATED, CONDITIONAL).
3. Apply the classification rule above to the full constraint set.
4. If any single constraint is not PASS, the result cannot be VALID regardless of how many other constraints passed.

## Skill Loading

Skills live in `skills/<skill-name>/SKILL.md`. They follow the Anthropic Agent Skills format: YAML frontmatter (`name`, `description`, `allowed-tools`, `references`) followed by a markdown body describing workflow and rules. Skill files define how the model should use tools for a task class; they do not execute code.

### Progressive Disclosure

Skill loading is **model-driven**, not regex-driven. The runtime never pre-injects skill bodies based on keyword matches.

1. `AgentSkillLoader` scans `skills/*/SKILL.md` at runtime and exposes `listSkills()` → `{ name, description }` for every skill on disk.
2. `AgentPromptBuilder` renders a compact "Skills Available" index section in the system prompt (name + one-line description per skill) whenever the `skill.load` tool is active.
3. The model picks a skill that matches the current task and calls `skill.load({ name })`.
4. `skill.load` returns the full skill body (workflow + rules + preferred tools) and widens the active tool scope to cover the skill's `allowed-tools`, bounded by the runtime's allowlist (`runtimeAllowedTools`).

Callers that need to force-load a specific skill (deterministic workflows, tests) can still pass `overrides.skillNames` into `scopeForPrompt` / the agent config. The default classifier in `taskProfile.ts` no longer pre-selects skills.

### Authoring a Skill

Every `SKILL.md` must begin with YAML frontmatter:

```yaml
---
name: skill-slug
description: One-line summary shown in the skill index. Describe *when* to load.
allowed-tools:
  - filesystem.read
  - filesystem.patch
references:
  - src/main/agent/AgentPromptBuilder.ts
---
```

- `name` must match the directory name.
- `description` is what the model sees in the index — keep it actionable and under ~150 chars.
- `allowed-tools` lists the dotted tool names (`docs/agent/contracts/tool-names.md`) the skill expects to call. These are unlocked on load, bounded by `runtimeAllowedTools`.
- `references` is a structured list of source paths the skill relies on. Kept for file-cache pre-warming and audit; not injected into the prompt body.

The body of the file below the frontmatter is the operating procedure: numbered workflow, rules, preferred tool sequences.

## Tool Naming

Use stable dotted tool names. The canonical tool inventory lives in `docs/agent/contracts/tool-names.md`. Keep that file updated when adding, removing, or renaming agent-facing tools. Tool names must remain stable even if implementation files move.
