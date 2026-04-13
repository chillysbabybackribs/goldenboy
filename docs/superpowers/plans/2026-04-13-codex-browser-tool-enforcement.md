# Codex Browser Tool Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Structurally disable codex's native web_search tool for all V2 sessions by passing `config: { web_search: "disabled" }` in `thread/start` and `thread/resume` WebSocket messages.

**Architecture:** `AppServerProvider` manages codex app-server threads over WebSocket. The `thread/start` and `thread/resume` messages accept a `config` object that overrides codex config per-session. Adding `web_search: "disabled"` to this object structurally removes native web search from the model's tool scope for the session, without affecting other codex sessions on the machine.

**Tech Stack:** TypeScript, existing `AppServerProvider.ts` WebSocket protocol, codex app-server JSON-RPC 2.0.

---

## File Map

| Action | File | Change |
|---|---|---|
| Modify | `src/main/agent/AppServerProvider.ts` | Add `config: { web_search: 'disabled' }` to `startThread` and `resumeThread` params |
| Modify | `src/main/agent/AppServerProvider.test.ts` | Add tests verifying the config field is sent in both thread/start and thread/resume |

---

## Task 1: Enforce web_search disabled in thread/start and thread/resume

**Files:**
- Modify: `src/main/agent/AppServerProvider.ts` (methods `startThread` ~line 386, `resumeThread` ~line 439)
- Modify: `src/main/agent/AppServerProvider.test.ts`

### Step 1: Read the existing test file to understand current test structure

Read `src/main/agent/AppServerProvider.test.ts` to understand how WebSocket messages are currently captured and asserted.

- [ ] **Step 1: Read the existing test file**

Open `src/main/agent/AppServerProvider.test.ts` and note the existing test helpers (`MockWebSocket`, message capture patterns, `startThread`/`resumeThread` test coverage if any).

### Step 2: Write failing tests

- [ ] **Step 2: Write failing tests for config field**

In `src/main/agent/AppServerProvider.test.ts`, add two tests — one verifying `thread/start` includes `config.web_search = "disabled"`, one for `thread/resume`. Add them after the existing tests.

The test pattern follows how the file already captures WebSocket `send` calls. Here is the full test code to add:

```typescript
describe('web_search config enforcement', () => {
  it('includes web_search disabled in thread/start params', async () => {
    const sentMessages: unknown[] = [];
    const mockWs = {
      send: (data: string) => {
        sentMessages.push(JSON.parse(data));
        // Simulate thread/start response for the matching id
        const msg = JSON.parse(data) as { id: number; method?: string };
        if (msg.method === 'thread/start') {
          setTimeout(() => {
            // find and call the message handler
            const handler = (mockWs as any)._messageHandlers?.[0];
            handler?.({ data: JSON.stringify({ id: msg.id, result: { thread: { id: 'thread-1' } } }) });
          }, 0);
        }
      },
      addEventListener: (event: string, handler: unknown) => {
        if (event === 'message') {
          (mockWs as any)._messageHandlers = (mockWs as any)._messageHandlers ?? [];
          (mockWs as any)._messageHandlers.push(handler);
        }
      },
      removeEventListener: () => {},
    } as unknown as WebSocket;

    const provider = new AppServerProvider({
      providerId: 'gpt-5.4' as any,
      modelId: 'gpt-5.4',
      process: {} as any,
    });
    // Access private method for testing
    await (provider as any).startThread(mockWs, 'task-1', 'system instructions');

    const threadStart = sentMessages.find(
      (m: any) => m.method === 'thread/start',
    ) as any;
    expect(threadStart).toBeDefined();
    expect(threadStart.params.config).toEqual({ web_search: 'disabled' });
  });

  it('includes web_search disabled in thread/resume params', async () => {
    const sentMessages: unknown[] = [];
    const mockWs = {
      send: (data: string) => {
        sentMessages.push(JSON.parse(data));
        const msg = JSON.parse(data) as { id: number; method?: string };
        if (msg.method === 'thread/resume') {
          setTimeout(() => {
            const handler = (mockWs as any)._messageHandlers?.[0];
            handler?.({ data: JSON.stringify({ id: msg.id, result: {} }) });
          }, 0);
        }
      },
      addEventListener: (event: string, handler: unknown) => {
        if (event === 'message') {
          (mockWs as any)._messageHandlers = (mockWs as any)._messageHandlers ?? [];
          (mockWs as any)._messageHandlers.push(handler);
        }
      },
      removeEventListener: () => {},
    } as unknown as WebSocket;

    const provider = new AppServerProvider({
      providerId: 'gpt-5.4' as any,
      modelId: 'gpt-5.4',
      process: {} as any,
    });
    await (provider as any).resumeThread(mockWs, 'task-1', 'thread-1', 'system instructions');

    const threadResume = sentMessages.find(
      (m: any) => m.method === 'thread/resume',
    ) as any;
    expect(threadResume).toBeDefined();
    expect(threadResume.params.config).toEqual({ web_search: 'disabled' });
  });
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

```bash
npx jest src/main/agent/AppServerProvider.test.ts --testNamePattern="web_search config enforcement" --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `expect(received).toEqual(expected)` because `config` is not currently sent.

- [ ] **Step 4: Implement the fix in AppServerProvider.ts**

In `src/main/agent/AppServerProvider.ts`, find the `startThread` method and add `config: { web_search: 'disabled' }` to the params object:

```typescript
// In startThread — the ws.send call, around line 386
ws.send(JSON.stringify({
  jsonrpc: '2.0',
  id: reqId,
  method: 'thread/start',
  params: {
    instructions: developerInstructions,
    approvalPolicy: 'never',
    sandboxPolicy: { type: 'dangerFullAccess' },
    persistFullHistory: true,
    config: { web_search: 'disabled' },
  },
}));
```

Then find the `resumeThread` method and add the same `config` field:

```typescript
// In resumeThread — the ws.send call, around line 439
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
    config: { web_search: 'disabled' },
  },
}));
```

- [ ] **Step 5: Run the tests to confirm they pass**

```bash
npx jest src/main/agent/AppServerProvider.test.ts --no-coverage 2>&1 | tail -20
```

Expected: All tests PASS including the two new `web_search config enforcement` tests.

- [ ] **Step 6: Run the full agent test suite to check for regressions**

```bash
npx jest src/main/agent/ --no-coverage 2>&1 | tail -30
```

Expected: All pre-existing tests pass. No regressions.

- [ ] **Step 7: Commit**

```bash
git add src/main/agent/AppServerProvider.ts src/main/agent/AppServerProvider.test.ts
git commit -m "feat(codex): disable native web_search via session-scoped config in thread/start and thread/resume"
```

---

## Fallback: If session config doesn't propagate

If after deploying the above you observe codex still using native web search (verifiable by watching the V2 tool log — no `browser.*` tool records appear during a web research task), apply the fallback:

In `src/main/agent/AppServerProcess.ts`, modify `mergeTomlMcpEntry` to also write the `web_search` config key at the top-level config:

```typescript
// In mergeTomlMcpEntry, add this line to newBlock:
const newBlock = [
  'web_search = "disabled"',   // ← add this line
  '',
  '[mcp_servers.v2-tools]',
  'command = "node"',
  `args = [${JSON.stringify(shimPath)}]`,
  '',
  '[mcp_servers.v2-tools.env]',
  `V2_BRIDGE_PORT = "${bridgePort}"`,
  `V2_TOOL_CONTEXT_PATH = "${contextPath}"`,
].join('\n');
```

This is a global config write (affects all codex sessions) so only do this if the session-scoped approach fails.
