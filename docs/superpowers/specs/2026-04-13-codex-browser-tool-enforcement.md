# Codex Browser Tool Enforcement

## Problem

Codex (running via `AppServerProvider` + `codex app-server`) has a built-in native web search tool. When a user asks a research or browsing question, codex reaches for its native search instead of the V2 in-app browser tools (`browser.*`). This bypasses:

- The app-owned browser surface (users don't see research happening)
- The V2 constraint validation and tool record system
- The quality and UX consistency of the built-in browser pipeline

The existing V2 Tool Priority block in the system prompt is soft guidance — text instructions alone are insufficient to override codex's trained behavior of using its native search tool.

## Scope

- **File changed:** `src/main/agent/AppServerProvider.ts` only
- **Methods changed:** `startThread` and `resumeThread`
- **Not changed:** `AppServerProcess`, `V2ToolBridge`, `AgentPromptBuilder`, `HaikuProvider`, `CodexProvider`, tool definitions, `config.toml` writes

## Solution

Pass `config: { web_search: "disabled" }` in the `thread/start` and `thread/resume` WebSocket messages. This is a **structural, session-scoped suppression** — codex never offers its native web_search tool to the model for the duration of the V2 session. It does not affect the user's other codex sessions on the machine.

The `ThreadStartParams.config` field accepts arbitrary codex config overrides (`additionalProperties: true` in the JSON schema). The `web_search` config key has enum values `"disabled" | "cached" | "live"` — setting it to `"disabled"` removes the native tool from the model's tool scope.

## What Changes

### `startThread` — add `config` to params

```typescript
ws.send(JSON.stringify({
  jsonrpc: '2.0',
  id: reqId,
  method: 'thread/start',
  params: {
    instructions: developerInstructions,
    approvalPolicy: 'never',
    sandboxPolicy: { type: 'dangerFullAccess' },
    persistFullHistory: true,
    config: { web_search: 'disabled' },  // ← new
  },
}));
```

### `resumeThread` — add `config` to params

```typescript
ws.send(JSON.stringify({
  jsonrpc: '2.0',
  id: reqId,
  method: 'thread/resume',
  params: {
    threadId,
    instructions: developerInstructions,
    approvalPolicy: 'never',
    sandboxPolicy: { type: 'dangerFullAccess' },
    persistFullHistory: true,
    config: { web_search: 'disabled' },  // ← new
  },
}));
```

## Out of Scope

- **Terminal native tools:** Not addressed — behavior TBD.
- **Filesystem native tools:** Intentionally left alone. No UI surface for filesystem; native access is acceptable.
- **Fallback:** If session-scoped `config` does not propagate (i.e., the fix has no effect), the fallback is to write `web_search = "disabled"` into `~/.codex/config.toml` via `AppServerProcess.writeConfig()` — Option A from the design discussion.

## Risk

- If `config.web_search` in `thread/start` is ignored by the codex runtime, behavior is unchanged from today — no regression.
- No effect on `HaikuProvider`, `CodexProvider` (exec mode), or sub-agents.
- The V2 Tool Priority block in the system prompt remains as belt-and-suspenders for other native capabilities.
