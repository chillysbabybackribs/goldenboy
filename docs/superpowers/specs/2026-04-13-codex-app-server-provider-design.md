# Codex App-Server Provider Design

**Date:** 2026-04-13  
**Status:** Approved for implementation  
**Replaces:** `CodexProvider` (spawn-based `codex exec` loop)

---

## Problem

The current `CodexProvider` spawns a new `codex exec` process for every tool turn. A task with 8 tool turns launches 9+ separate processes. Each spawn:

- Re-injects ~28,000 input tokens of system context cold (confirmed via live token counts)
- Adds 300–500ms process startup latency per turn
- Reconstructs the conversation as a text transcript — lossy, no native history
- Has no session continuity — context is destroyed when the process exits
- Produces no mid-turn token streaming — the UI sees nothing until a turn completes
- Wastes the Codex subscription by using it as a stateless oracle

## Solution

Replace the spawn loop with the `codex app-server` WebSocket protocol — the same protocol used by VS Code and JetBrains. One persistent process, persistent threads, real streaming.

---

## Architecture

Three new components. Everything else (`AgentRuntime`, `AgentModelService`, `agentToolExecutor`, `ConstraintValidator`, `chatKnowledgeStore`, tool packs, `HaikuProvider`) is unchanged.

```
V2 Electron main process
│
├── V2ToolBridge          ← new: localhost HTTP server, wraps agentToolExecutor
│     port: random, localhost only
│     POST /tools/list    → agentToolExecutor.list()
│     POST /tools/call    → agentToolExecutor.execute() + ConstraintValidator
│
├── AppServerProcess      ← new: manages codex app-server child process
│     codex app-server --listen ws://127.0.0.1:APP_PORT
│     config.toml entry: [mcp_servers.v2-tools] pointing to shim
│
├── AppServerProvider     ← new: implements AgentProvider via WebSocket
│     connects to APP_PORT
│     thread registry: Map<taskId, threadId>
│     fires onToken / onStatus / onItem
│
└── v2-mcp-shim.js        ← new: 39-line stdio↔HTTP bridge (pre-built, in dist/)
      spawned by codex app-server as MCP server
      bridges MCP JSON-RPC → V2ToolBridge HTTP
      env: V2_BRIDGE_PORT, V2_TOOL_CONTEXT_PATH
```

### Call flow per task turn

```
AgentModelService.invoke()
  → AppServerProvider.invoke()
      → thread/start (first call for taskId) OR thread/resume (subsequent)
      → turn/start { input, developerInstructions, outputSchema }
      ← item/agentMessage/delta       → onToken(delta)            [streaming]
      ← item/started mcpToolCall      → onItem(started) + onStatus(tool-start:...)
      ← mcpToolCall routes to shim
          shim POST /tools/call
          V2ToolBridge.execute()
            agentToolExecutor.execute(toolName, input, ctx)
            ConstraintValidator.validateToolResult()
            chatKnowledgeStore.recordToolMessage()
          → returns { content: [{ type:'text', text: result+validation }] }
      ← item/completed mcpToolCall    → onItem(completed) + onStatus(tool-done:...)
      ← turn/completed                → build result, return AgentProviderResult
```

---

## New Files

### `src/main/agent/V2ToolBridge.ts`

In-process HTTP server (localhost only) that wraps `agentToolExecutor`. Runs for the lifetime of the app.

**Responsibilities:**
- `GET /tools/list` → returns all registered tools as MCP `{ tools: [{ name, description, inputSchema }] }` with dotted names translated to `__` (e.g. `filesystem.list` → `filesystem__list`)
- `POST /tools/call` → reads `{ name, arguments, context }`, translates name back, calls `agentToolExecutor.execute()`, appends `ConstraintValidator` output, calls `chatKnowledgeStore.recordToolMessage()`, returns MCP content array
- Reads active tool context (runId, agentId, taskId, mode) from a temp JSON file written by `AppServerProvider` before each turn
- Port is random (OS-assigned); exposed via `getPort(): number`

**Does not:** filter by allowed-tool scope. Scope enforcement happens in `AppServerProvider` via the system prompt — allowed tools are listed explicitly; out-of-scope tools are described as unavailable. MCP-level rejection is not needed because Codex only calls tools it's been told exist.

### `src/main/agent/AppServerProcess.ts`

Singleton that manages the `codex app-server` child process.

**Responsibilities:**
- Spawns `codex app-server --listen ws://127.0.0.1:0` (OS-assigned port)
- Parses the listening port from stdout (`listening on: ws://127.0.0.1:PORT`)
- Writes the `[mcp_servers.v2-tools]` entry to `~/.codex/config.toml` before spawning, pointing to the shim with `V2_BRIDGE_PORT` env
- Polls `/readyz` HTTP endpoint until 200
- Reconnects on crash with exponential backoff (1s, 2s, 4s, max 30s)
- Exposes `waitUntilReady(): Promise<{ wsPort: number }>` and `isReady(): boolean`
- Emits `mcpServerReady` event once `mcpServer/startupStatus/updated` for `v2-tools` shows `status: "ready"` (received via a bootstrap WebSocket connection)

### `src/main/agent/AppServerProvider.ts`

Implements `AgentProvider`. Drop-in replacement for `CodexProvider`.

**Key behaviors:**

**Thread registry:** `Map<taskId, string>` storing Codex thread IDs. On `invoke()`:
- If no thread for `taskId` → `thread/start`
- If thread exists → `thread/resume` (falls back to `thread/start` if resume fails with thread-not-found)

**Per-turn sequence:**
1. Write tool context JSON to temp file (`{ runId, agentId, taskId, mode }`)
2. Send `turn/start { threadId, input, outputSchema }` — `outputSchema` used only for final-answer-only turns (same structured JSON schema as today, but passed natively, no temp file)
3. Accumulate `item/agentMessage/delta` → `onToken(delta)` per chunk
4. On `item/started` / `item/completed` with `type: mcpToolCall` → fire `onItem` + `onStatus`
5. On `turn/completed` → build `AgentProviderResult` from accumulated state
6. Post-turn: check accumulated message for missing-capability pattern → if matched, expand tools and send a follow-up turn (same auto-expansion logic as today, now across turn boundaries)

**Tool pack scoping:** The system prompt (passed as `developerInstructions` on `thread/start`) lists only the currently allowed tools — same as today's `buildToolPlanningPrompt`. When the model requests a pack expansion via `runtime.request_tool_pack`, the mcpToolCall result triggers `resolveToolPackExpansion()`; `AppServerProvider` updates its active tool list and immediately starts a follow-up turn whose user input is a host note describing the expanded tools (e.g. "Host expanded tool pack 'implementation'. New tools available: filesystem.patch, filesystem.write..."). The thread's full context already contains the expansion result, so the model picks up immediately. `developerInstructions` is not updated mid-thread — tool scope is communicated via turn input messages after the first turn.

**Abort:** `abort()` sends `turn/interrupt { threadId, turnId }` if a turn is in flight, then sets an abort flag that causes the next `turn/completed` or error to be discarded.

**Usage tracking:** `thread/tokenUsage/updated` notification → accumulate `last.inputTokens` + `last.outputTokens` per turn, sum across turns for the final `AgentProviderResult.usage`.

**`supportsAppToolExecutor = true`** — same as `CodexProvider`.

### `src/main/agent/v2-mcp-shim.js` (pre-built, committed to `dist/`)

39-line stdio↔HTTP bridge. Spawned by `codex app-server` as the `v2-tools` MCP server. No TypeScript compilation needed — plain CommonJS, zero dependencies beyond Node built-ins.

```
stdin  ← MCP JSON-RPC (from codex app-server)
stdout → MCP JSON-RPC responses
HTTP   ↔ V2ToolBridge on V2_BRIDGE_PORT
```

Handles: `initialize`, `notifications/initialized`, `tools/list`, `tools/call`. All other methods return JSON-RPC method-not-found.

---

## Startup Sequence

```
AgentModelService.init()
  1. V2ToolBridge.start()
       → binds localhost HTTP on random port
       → registers agentToolExecutor tools

  2. AppServerProcess.start(bridgePort)
       → writes [mcp_servers.v2-tools] to ~/.codex/config.toml
            command = "node"
            args = ["/path/to/dist/v2-mcp-shim.js"]
            [mcp_servers.v2-tools.env]
            V2_BRIDGE_PORT = <bridgePort>
            V2_TOOL_CONTEXT_PATH = "/tmp/v2-tool-context.json"
       → spawns: codex app-server --listen ws://127.0.0.1:0
       → polls /readyz
       → opens bootstrap WS, waits for v2-tools mcpServer ready

  3. AppServerProvider.connect(wsPort)
       → opens WebSocket to app-server
       → sends initialize handshake
       → provider status → "available"

  4. HaikuProvider.init() [parallel, unchanged]

  5. AgentModelService registers AppServerProvider as PRIMARY_PROVIDER_ID
     CodexProvider kept in codebase, gated by CODEX_PROVIDER=exec env flag
```

---

## Behavioral Parity: Current → New

| Current CodexProvider | AppServerProvider |
|---|---|
| `onToken(text)` — fires once at end of turn | `onToken(delta)` — fires per streaming chunk |
| `onStatus("tool-start:...")` | Fired on `item/started` (mcpToolCall) |
| `onStatus("tool-done:...")` | Fired on `item/completed` (mcpToolCall) |
| `onItem({ item, eventType })` | Same — mapped from mcpToolCall ThreadItem |
| `chatKnowledgeStore.recordToolMessage()` | Called inside V2ToolBridge on every tool exec |
| `ConstraintValidator` block in tool result | Appended to result text in V2ToolBridge before returning to Codex |
| `resolveToolPackExpansion()` | Called in AppServerProvider on mcpToolCall result; triggers new turn with expanded instructions |
| `resolveAutoExpandedToolPack()` | Called post-turn on accumulated message text; triggers follow-up turn |
| `usage.inputTokens / outputTokens` | Summed from `thread/tokenUsage/updated` per turn |
| `codexItems[]` | Built from `item/started` + `item/completed` notifications |
| Session continuity | `Map<taskId, threadId>` — threads persist across invocations |
| Abort | `turn/interrupt { threadId, turnId }` |
| `--dangerously-bypass-approvals-and-sandbox` | `approvalPolicy: 'never'`, `sandbox: 'danger-full-access'` |
| `--output-schema <tempfile>` | `outputSchema` field on `turn/start` — no temp file |
| System prompt | `developerInstructions` on `thread/start` / `thread/resume` |

---

## Error Handling

| Failure | Response |
|---|---|
| `AppServerProcess` crash | Reject in-flight turn; restart with backoff; next invoke waits for ready |
| WebSocket disconnect mid-turn | Reject current turn; reconnect on next invoke |
| `v2-tools` MCP server fails to start | Surface as provider unavailable error on startup |
| `thread/resume` fails (thread expired/missing) | Fall back to `thread/start` with same instructions |
| Turn inactivity > 3 minutes | Reject turn with timeout error |
| `V2ToolBridge` tool execution error | Return MCP error content; Codex sees it as a tool failure |

---

## What Does NOT Change

- `AgentRuntime` — unchanged, still calls `provider.invoke()`
- `AgentModelService` — startup sequence extended, provider swap only
- `AgentPromptBuilder` — system prompt text reused as `developerInstructions`
- `agentToolExecutor` — unchanged, called by `V2ToolBridge`
- `ConstraintValidator` — unchanged, called by `V2ToolBridge`
- `chatKnowledgeStore` — unchanged, called by `V2ToolBridge`
- `toolPacks.ts` — unchanged, expansion logic reused in `AppServerProvider`
- `HaikuProvider` — unchanged
- `providerRouting.ts` — unchanged
- All tool definitions — unchanged

---

## Files to Create

| File | ~Lines | Purpose |
|---|---|---|
| `src/main/agent/V2ToolBridge.ts` | ~120 | In-process HTTP bridge to agentToolExecutor |
| `src/main/agent/AppServerProcess.ts` | ~150 | codex app-server lifecycle manager |
| `src/main/agent/AppServerProvider.ts` | ~350 | AgentProvider WebSocket implementation |
| `src/main/agent/v2-mcp-shim.js` | ~40 | stdio↔HTTP bridge shim (pre-built) |

## Files to Modify

| File | Change |
|---|---|
| `src/main/agent/AgentModelService.ts` | Startup: add V2ToolBridge + AppServerProcess; swap CodexProvider for AppServerProvider |
| `src/shared/types/model.ts` | No change to ProviderId — `gpt-5.4` stays as PRIMARY_PROVIDER_ID |

---

## Constraints

- `v2-mcp-shim.js` must use only Node.js built-ins — no npm dependencies
- `V2ToolBridge` binds `127.0.0.1` only — never `0.0.0.0`
- `AppServerProcess` writes config.toml non-destructively — merges only the `v2-tools` entry, preserves all existing entries
- `CodexProvider` stays in the codebase, activated by `CODEX_PROVIDER=exec` env var
- Thread IDs are not persisted across V2 app restarts — `Map<taskId, threadId>` is in-memory only; on restart, `thread/start` is used for all tasks
