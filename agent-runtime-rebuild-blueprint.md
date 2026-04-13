# Agent Runtime Rebuild Blueprint

## Objective
Deliver a long-lived, sessionized agent execution model for V2 that preserves the existing tool orchestration contracts while removing per-turn runtime churn.

## Consolidated Plan

### 1) Target Shape
- Keep `AgentModelService` as the external entrypoint for agent operations.
- Remove the current behavior where `AgentModelService` creates a fresh invocation-scoped runtime on every turn.
- Introduce `SessionManager` as the in-process owner of live sessions.
- Make `AgentRuntime` session-bound (task conversation lifetime), not request-bound.
- Keep `AgentToolExecutor` largely unchanged as the host-side tool execution boundary.
- Treat chat/task memory as recoverability artifacts, not as the live runtime state source.

### 2) Core Domain Types
```ts
export type AgentSessionId = string;

export type AgentSessionStatus =
  | 'idle'
  | 'running'
  | 'waiting_for_tools'
  | 'interrupted'
  | 'errored'
  | 'closed';

export type AgentSessionCheckpoint = {
  sessionId: AgentSessionId;
  taskId: string;
  summary: string;
  activeConstraints: string[];
  unresolvedItems: string[];
  lastTurnAt: string;
  lastModelTurnId?: string;
  waitingForTool?: {
    toolCallId: string;
    toolName: string;
    requestedAt: string;
  };
};

export type AgentSessionState = {
  sessionId: AgentSessionId;
  taskId: string;
  status: AgentSessionStatus;
  runtime: {
    providerId: string;
    model: string;
    configHash: string;
  };
  checkpoint: AgentSessionCheckpoint;
  createdAt: string;
  updatedAt: string;
};
```

### 3) Components and Ownership

#### 3.1 `SessionManager`
- Holds a session registry keyed by `taskId` and/or `sessionId`.
- Responsibilities:
  - Create session if missing.
  - Rehydrate/attach to existing session.
  - Return existing runtime handle.
  - Handle session lifecycle transitions.
  - Enforce per-task single active runtime policy.
- Public interface concept:
  - `acquireSession(taskId, taskConfig): Promise<{sessionId, runtime, state}>`
  - `getSession(taskId): Promise<AgentSessionState | null>`
  - `interruptSession(taskId): Promise<void>`
  - `closeSession(taskId): Promise<void>`
  - `flushSession(taskId): Promise<AgentSessionCheckpoint>`

#### 3.2 `AgentRuntime` (session-bound)
- Initialize once per session and persist until explicit close/interruption/recovery.
- Own turn context, message buffers, tool callbacks, cancellation state, and recovery hooks for the session.
- Consume `SessionCheckpoint` for restoration after pause/failure.
- Update and emit checkpoint changes after each assistant/tool cycle.

#### 3.3 `AgentModelService`
- Continues to expose the current methods used by callers.
- Delegates all lifecycle state decisions to `SessionManager`.
- Maintains public API compatibility where practical.
- Only creates sessions via session manager (no per-turn runtime factory).

#### 3.4 `AgentToolExecutor`
- Leave execution semantics intact.
- Ensure it reads session-scoped runtime artifacts (session context and state store handles).
- Keep it as the host boundary for tool invocation/result ingestion.

### 4) Session Checkpointing Design
- Session checkpoint should be persisted whenever state changes:
  - on assistant output
  - on tool call request
  - on model error
  - on interruption request
- `checkpoint.summary` and `unresolvedItems` are derived from turn stream + memory layer.
- Recovery flow:
  - New process start for a task should attempt to hydrate checkpoint.
  - Reconstruct lightweight in-memory runtime only from checkpoint and persisted turn deltas.

### 5) Memory Strategy
- **Live state source**: session-bound runtime only.
- **Recovery source**: chat/task memory (append-only transcript + constraints).
- On resume:
  1. Load active checkpoint.
  2. Rehydrate session metadata.
  3. Replay minimal required chat/task context into runtime.
  4. Continue from last known turn marker.

### 6) Data and Contracts
- Add session metadata persistence table/collection keyed by `sessionId`.
- Extend current run/task metadata with:
  - `sessionId`
  - `status`
  - `checkpoint`
  - `lastProviderRequestAt`
  - `lastToolWaitStartedAt`
- Use idempotent writes (`sessionId + requestId`) for checkpoint update operations.

### 7) Error and Interruption Semantics
- Transition rules:
  - normal completion: `running -> waiting_for_tools` (if awaiting tool) or `idle`.
  - user interrupt: `running|waiting_for_tools -> interrupted`.
  - tool failure/provider failure: `running -> errored` (and persist checkpoint for triage/retry).
  - close/finished tasks: `* -> closed`.
- On `interrupted`/`errored` state, keep checkpoint and allow deterministic resume path.

### 8) Observability
- Emit status changes and checkpoint diffs via existing telemetry/logging layer.
- Log session duration and last tool wait latency.
- Include session id in command logs/tool events for correlation.

### 9) Migration and Compatibility Steps
1. Introduce `SessionManager` and `AgentSession*` types behind adapters.
2. Refactor `AgentModelService` to delegate session retrieval/creation and stop creating per-turn runtimes.
3. Refactor `AgentRuntime` to accept injected session context + checkpoint store.
4. Add persistence and resume for `AgentSessionCheckpoint` and status transitions.
5. Wire `AgentToolExecutor` to consume session id and wait-state semantics.
6. Run a small smoke matrix:
   - new turn creates/uses existing runtime
   - interruption then resume
   - tool wait + completion
   - failure + retry recovery path
7. Add contract tests around session hand-off and checkpoint restoration.

## Deployment Notes
- Keep public API shape stable where possible for existing UI callsites.
- Any constructor signature changes should remain behind defaulted dependencies.
- Prefer additive changes first; only convert callsites after migration guard passes.

## Next Steps (Execution Order)
1. Locate current `AgentModelService` and `AgentRuntime` implementations and map current turn lifecycle entrypoints.
2. Add new session interfaces/types (`AgentSessionId`, `AgentSessionStatus`, `AgentSessionCheckpoint`, `AgentSessionState`).
3. Implement `SessionManager` with in-memory map + persistence abstraction.
4. Refactor service path to acquire and reuse runtimes per session.
5. Implement checkpointing and status persistence.
6. Integrate interruption/retry semantics and smoke-test with representative task flows.
