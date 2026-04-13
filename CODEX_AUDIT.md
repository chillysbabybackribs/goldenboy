# Codex-Native Audit

## What V2 Already Is

V2 is not just a chat shell with tool hooks. It already has the core shape of an operator workbench:

- a control plane (`command`) and work surface (`execution`)
- a real browser runtime and a real terminal runtime
- a single model runtime path through `AgentRuntime -> AgentToolExecutor -> tool modules -> app services`
- deterministic post-tool validation
- persistent browser, file, and chat knowledge stores
- runtime-managed sub-agents

That baseline is strong. The app already has the right ownership boundary: the model plans, while V2 owns execution, state, and observation.

## Current Strengths

### 1. Strong runtime choke points

The architecture already centralizes model behavior through:

- `src/main/agent/AgentRuntime.ts`
- `src/main/agent/AgentToolExecutor.ts`
- `src/main/agent/tools/*`

That is the right place to make Codex-specific improvements without leaking model logic into Electron services or renderer code.

### 2. Real local operating surfaces

The browser and terminal are not mock abstractions. They are first-class runtimes:

- `src/main/browser/BrowserService.ts`
- `src/main/terminal/TerminalService.ts`
- `src/main/actions/SurfaceActionRouter.ts`

This matters because Codex is strongest when it can operate against real stateful environments instead of stateless API wrappers.

### 3. Good evidence discipline

The constraint validator and cache-first contract are unusually strong:

- `src/main/agent/ConstraintValidator.ts`
- `src/main/agent/sourceValidationPolicy.ts`
- `src/main/browserKnowledge/PageKnowledgeStore.ts`
- `src/main/fileKnowledge/FileKnowledgeStore.ts`

This is a real differentiator. Codex benefits from explicit runtime truth because it reduces hallucinated completion.

### 4. Useful provider abstraction

`AgentModelService` already separates provider choice from runtime behavior and keeps the app-level execution path stable.

## Where Codex Is Still Being Underused

### 1. Codex is integrated as a subprocess, not as a first-class runtime strategy

`src/main/agent/CodexProvider.ts` currently builds one large prompt string and shells out to:

`codex exec --json --dangerously-bypass-approvals-and-sandbox`

That means Codex is mostly being used as a remote reasoning engine that emits text and item events. The app is not yet exploiting Codex as:

- a planner that can operate with tighter scoped contexts
- a routing target for specific task classes
- a durable execution partner with structured memory and resumable work
- a specialized coordinator for sub-agents and code-change workflows

### 2. Prompt assembly is still too monolithic

`src/main/agent/AgentPromptBuilder.ts` appends `AGENT.md`, validation protocols, tool names, and full skill bodies into one system prompt. This works, but it fights the token-discipline goals in `AGENT.md`.

Right now the app is relying heavily on prompt instruction density instead of runtime context selection.

### 3. Sub-agents are present, but shallow

`src/main/agent/subagents/SubAgentManager.ts` can spawn children, but results are reduced to a short summary with empty `findings` and `changedFiles`.

That leaves a lot of Codex value on the table:

- no structured delegation outputs
- no child-produced patch or evidence ledger
- no strong parent/child merge contract
- no role-specialized routing beyond simple keyword heuristics

### 4. Tool selection is broad rather than deliberate

`runtimeScope.ts` mostly decides between broad bundles. In practice most runs still get almost all tools.

Codex performs best when the runtime sharply constrains the tool surface for the specific job. Today the scope system is directionally right, but not yet strong enough.

### 5. The command window is still conversation-first, not operation-first

The renderer already shows logs, progress, and Codex item streams, but the mental model is still close to “chat plus activity.”

To really become Codex-native, the command surface should foreground:

- plan state
- active constraints
- tool execution ledger
- evidence status
- delegation tree
- completion validation

instead of treating those mostly as side-channel details.

## Highest-Leverage Codex Moves

### Priority 1: Replace prompt bulk with context assembly

Keep `AGENT.md` as the contract, but stop injecting so much of it every run.

Move toward a prompt model with:

- a compact always-on base contract
- task-specific policy fragments
- task-specific skill fragments
- targeted cache excerpts
- explicit execution objective and validation target

Why this matters:

- lower token pressure
- less repeated instruction noise
- better Codex focus
- better sub-agent efficiency

### Priority 2: Make Codex the default for code/workspace tasks by strategy, not just ordering

`AgentModelService` currently prefers Codex through provider order. That is better than nothing, but still weak.

Codex should become the explicit strategy owner for:

- code edits
- repo analysis
- debugging
- terminal-heavy flows
- sub-agent coordination

Haiku should remain useful for narrow synthesis and low-cost summarization, not as a peer for the same classes of work.

### Priority 3: Upgrade sub-agents into structured workers

Sub-agents should return:

- findings
- changed files
- commands run
- validation results
- unresolved blockers

Codex is especially strong when decomposing work into bounded workers. The current sub-agent layer has the shell, but not the operational contract.

### Priority 4: Promote tool/result traces into first-class UI objects

The command window should render the run as an execution graph, not just a chat transcript.

The main objects to expose:

- active plan
- tool calls and validation status
- browser evidence collected
- terminal commands and outcomes
- file edits
- sub-agent tree

This would make Codex feel materially different from a standard chat model inside the same shell.

### Priority 5: Add task-class-specific execution modes

The runtime should distinguish between at least:

- research mode
- implementation mode
- debug mode
- review mode
- orchestration mode

Each mode should define:

- default provider
- tool allowlist
- prompt fragments
- cache strategy
- validation expectations
- sub-agent policy

This is a better use of Codex than one generic “unrestricted-dev” path.

## Concrete Roadmap

### Phase 1: Codex-native runtime shaping

1. Split `AgentPromptBuilder` into compact base contract plus composable fragments.
2. Replace broad `scopeForPrompt()` heuristics with explicit task modes.
3. Make provider routing strategy-driven in `AgentModelService`, not just ordered fallback.

### Phase 2: Structured delegation

1. Expand `SubAgentResult` to include findings, changed files, command log, and validation summary.
2. Add parent-visible delegation state to the command UI.
3. Make Codex the preferred coordinator for multi-step code and debugging tasks.

### Phase 3: Execution-first command UI

1. Promote tool calls, validations, and plan progress above free-form chat.
2. Show active constraints and completion state directly in the run view.
3. Surface browser/file cache hits so the user can see why a run stayed efficient.

### Phase 4: Specialized Codex workflows

Build dedicated paths for:

- code review
- failing test triage
- browser investigation
- repo-wide refactors
- long-running implementation tasks with checkpoints

## Theoretical Upside If You Push This Hard

If V2 becomes truly Codex-native, it stops being “an Electron wrapper around model calls” and becomes:

- a local operator IDE
- a stateful coding and research machine
- a supervised delegation system
- a deterministic execution environment with model planning layered on top

That is a materially stronger product category than “multi-provider chat app with tools.”

## Bottom Line

The architecture is already good enough to support something much stronger than a provider swap. The biggest missing step is to stop treating Codex as just another model endpoint and start treating it as the primary operator for bounded local work, structured delegation, and execution-aware reasoning.
