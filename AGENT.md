# V2 Agent Contract

V2 Workspace is a local Electron application with two primary windows:

- `command`: task control, logs, model conversation, and run status.
- `execution`: browser and terminal surfaces used to complete work.

The model is not the application. The model is a planner and operator that asks V2 to run typed tools. V2 owns execution, logging, cancellation, state, file access, browser state, terminal state, and sub-agent lifecycle.

## Application Mental Model

Users interact with V2 as a local workbench, not as a standalone chatbot.

The `command` window is the control plane: conversation, task creation, run status, provider status, and logs.

The `execution` window is the work surface: owned browser tabs and terminal sessions that V2 can inspect and operate through tools.

The model plans, decides what evidence is needed, asks for typed tool calls, and explains results. It should treat V2 as the source of truth for observed browser state, filesystem state, terminal output, logs, cancellation, and persisted task memory.

Prefer app-owned caches before broad reads. Browser, file, and chat caches exist to reduce repeated context loading and to keep model input focused.

## Current Integration State

This repository contains the browser build, terminal surface, agent runtime, Haiku provider integration, optional Gemini sidecar support, sub-agent runtime, browser page cache, and file knowledge cache.

Haiku 4.5 connects through `src/main/agent/AgentRuntime.ts`. It must not call Electron, `BrowserService`, `fs`, terminal services, or IPC handlers directly.

Gemini sidecar models are optional internal helpers. They may rank search results or judge whether cached page evidence is sufficient, but they do not operate browser, filesystem, terminal, or sub-agent tools.

## Runtime Path

All model-driven work should flow through this path:

```text
HaikuProvider
  -> AgentRuntime
  -> AgentPromptBuilder
  -> AgentToolExecutor
  -> tool modules
  -> existing app services
```

Sub-agents use the same path:

```text
parent AgentRuntime
  -> subagent.spawn tool
  -> SubAgentManager
  -> child AgentRuntime
```

## File Map

Use these files first when locating task context:

- Main app lifecycle: `src/main/main.ts`
- IPC registration: `src/main/ipc/registerIpc.ts`
- Window creation and layout: `src/main/windows/windowManager.ts`
- App state store and reducer: `src/main/state/`
- Event fanout: `src/main/events/`
- Browser runtime: `src/main/browser/BrowserService.ts`
- Browser page analysis and extraction: `src/main/browser/BrowserPageAnalysis.ts`, `src/main/browser/BrowserPerception.ts`, `src/main/context/pageExtractor.ts`
- Surface action routing: `src/main/actions/SurfaceActionRouter.ts`
- Browser action executor: `src/main/actions/browserActionExecutor.ts`
- Terminal runtime: `src/main/terminal/TerminalService.ts`
- Renderer command UI: `src/renderer/command/`
- Renderer browser/terminal UI: `src/renderer/execution/`
- Shared IPC and app contracts: `src/shared/types/`, `src/shared/actions/`
- Agent runtime scaffold: `src/main/agent/`
- Constraint validation: `src/main/agent/ConstraintValidator.ts`
- Source validation policies: `src/main/agent/sourceValidationPolicy.ts`
- Gemini sidecar: `src/main/agent/GeminiSidecar.ts`
- File knowledge cache: `src/main/fileKnowledge/`
- Agent skills: `skills/`

## Operating Rules

Use app services through typed tools only. Do not invent hidden execution paths.

Prefer existing app state and IPC contracts before adding new contracts.

When a task requires browser work, inspect browser state first, then act through browser tools.

When the user says "search", "look up", "find online", "research", or asks for current web information, use the owned browser. Start with `browser.research_search` unless the user only asked to navigate to a search page. It opens result pages sequentially and stops when cached evidence is sufficient. Do not answer from model memory or any provider-native search behavior.

When a task requires browser research or page understanding, search cached page chunks first. Prefer `browser.search_page_cache`, `browser.list_cached_sections`, and `browser.read_cached_chunk` over broad page extraction. Use `browser.extract_page` only when cached retrieval is missing or insufficient.

When a task requires file understanding, index and search cached file chunks first. Prefer `filesystem.index_workspace`, `filesystem.answer_from_cache`, `filesystem.search_file_cache`, and `filesystem.read_file_chunk` over broad file reads. Use `filesystem.read` only when cached retrieval is missing or insufficient, and read before editing.

When a task requires terminal work, report the command, capture output, and return the meaningful result.

When spawning sub-agents, give each child a concrete task, clear role, and enough context to work without rereading everything.

In unrestricted development mode, the runtime may grant broad tools. Even then, every tool call must be recorded.

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

The V2 runtime enforces this structurally through `ConstraintValidator`, which runs after every tool execution and before results return to the model.

Enforcement path:

```text
AgentToolExecutor.execute()
  → tool.execute()
  → ConstraintValidator.validateToolResult()
  → attach ResultValidation to AgentToolResult
  → HaikuProvider appends RUNTIME VALIDATION block to tool_result content
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

## Token Discipline

The build is input-token cost sensitive. Preserve quality by being selective, not by skipping necessary evidence.

Load the smallest context that can answer the task: search indexes and caches first, read bounded chunks before whole files, summarize long observations, and avoid repeating tool output already captured in task memory.

Do not inject every skill, cached page, file, or chat message into a run. Add broader context only when the current task needs it.

## Sub-Agent Rules

Sub-agents are runtime-managed child agent runs.

Parent agents may request child agents. V2 decides how to create, track, cancel, and summarize them.

Every sub-agent must have:

- a parent run id
- a role
- a task
- a mode
- a tool scope
- a run record
- a final result or failure

Recursive sub-agent spawning is allowed only when the active runtime mode permits it.

## Skill Loading

Skills live in `skills/<skill-name>/SKILL.md`.

The runtime should load only skills relevant to the current task. Do not inject every skill into every prompt.

Skill files define how the model should use tools for a task class. They do not execute code.

## Tool Naming

Use stable dotted tool names:

- `browser.navigate`
- `browser.search_web`
- `browser.research_search`
- `browser.click`
- `browser.type`
- `browser.drag`
- `browser.hit_test`
- `browser.get_console_events`
- `browser.get_network_events`
- `browser.run_intent_program`
- `browser.extract_page`
- `browser.answer_from_cache`
- `browser.search_page_cache`
- `browser.read_cached_chunk`
- `filesystem.index_workspace`
- `filesystem.answer_from_cache`
- `filesystem.search_file_cache`
- `filesystem.read_file_chunk`
- `filesystem.read`
- `filesystem.search`
- `filesystem.patch`
- `terminal.exec`
- `subagent.spawn`
- `subagent.wait`
- `subagent.cancel`

Tool names should remain stable even if implementation files move.

## Response Style

Be direct, operational, and specific.

Say what changed, what was observed, and what remains.

Do not claim a browser action, file edit, terminal command, or sub-agent result happened unless V2 has a corresponding tool record.
