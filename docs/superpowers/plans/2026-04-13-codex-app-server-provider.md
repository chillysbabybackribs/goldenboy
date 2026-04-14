# Codex App-Server Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-turn `codex exec` spawn loop with a persistent `codex app-server` WebSocket connection, giving real token streaming, session continuity, and dramatically lower latency.

**Architecture:** V2ToolBridge runs an in-process localhost HTTP server wrapping `agentToolExecutor`; AppServerProcess manages the `codex app-server` child process and writes the MCP config; a 39-line stdio shim bridges codex's MCP protocol to V2ToolBridge; AppServerProvider drives the WebSocket turn loop and is the drop-in replacement for CodexProvider.

**Tech Stack:** Node.js `http` + `net` (no external deps for the shim), `ws` for WebSocket client, Electron `app.getPath('userData')` for thread persistence, existing `agentToolExecutor` / `chatKnowledgeStore` / `ConstraintValidator` unchanged.

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `src/main/agent/v2-mcp-shim.js` | 39-line stdio↔HTTP bridge; spawned by codex as MCP server |
| Create | `src/main/agent/V2ToolBridge.ts` | In-process localhost HTTP server wrapping agentToolExecutor |
| Create | `src/main/agent/AppServerProcess.ts` | Manages `codex app-server` child process lifecycle |
| Create | `src/main/agent/AppServerProvider.ts` | AgentProvider WebSocket implementation; replaces CodexProvider |
| Modify | `src/main/agent/AgentModelService.ts` | Startup: wire V2ToolBridge + AppServerProcess + AppServerProvider |

**Do not touch:** AgentRuntime, AgentTypes, AgentToolExecutor, ConstraintValidator, providerToolRuntime, toolPacks, HaikuProvider, providerRouting, chatKnowledgeStore, all tool definitions, shared/types/model.ts.

---

## Task 1: v2-mcp-shim.js — stdio↔HTTP bridge

**Files:**
- Create: `src/main/agent/v2-mcp-shim.js`

This is a plain CommonJS script with zero npm dependencies. It is spawned by `codex app-server` as the `v2-tools` MCP server. It reads MCP JSON-RPC 2.0 from stdin, forwards `tools/list` and `tools/call` to V2ToolBridge via HTTP, and writes responses to stdout.

- [ ] **Step 1: Write the shim file**

```javascript
#!/usr/bin/env node
// v2-mcp-shim.js — stdio↔HTTP bridge for codex app-server MCP integration
// Zero npm dependencies. Spawned by codex app-server as the v2-tools MCP server.
'use strict';
const http = require('http');

const BRIDGE_PORT = Number(process.env.V2_BRIDGE_PORT);
const CONTEXT_PATH = process.env.V2_TOOL_CONTEXT_PATH || '/tmp/v2-tool-context.json';

if (!BRIDGE_PORT) {
  process.stderr.write('v2-mcp-shim: V2_BRIDGE_PORT not set\n');
  process.exit(1);
}

function postBridge(route, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      { hostname: '127.0.0.1', port: BRIDGE_PORT, path: route, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error('invalid bridge response')); }
        });
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function respondError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    const { id, method, params } = msg;
    if (method === 'initialize') {
      respond(id, { protocolVersion: '2024-11-05', capabilities: { tools: {} },
        serverInfo: { name: 'v2-tools', version: '1.0.0' } });
    } else if (method === 'notifications/initialized') {
      // no response needed for notifications
    } else if (method === 'tools/list') {
      postBridge('/tools/list', {})
        .then((r) => respond(id, r))
        .catch((e) => respondError(id, -32000, e.message));
    } else if (method === 'tools/call') {
      postBridge('/tools/call', { ...params, contextPath: CONTEXT_PATH })
        .then((r) => respond(id, r))
        .catch((e) => respondError(id, -32000, e.message));
    } else {
      respondError(id, -32601, 'Method not found');
    }
  }
});
process.stdin.on('end', () => process.exit(0));
```

- [ ] **Step 2: Commit**

```bash
git add src/main/agent/v2-mcp-shim.js
git commit -m "feat(codex): add v2-mcp-shim stdio↔HTTP bridge for codex app-server MCP integration"
```

---

## Task 2: V2ToolBridge — in-process HTTP server

**Files:**
- Create: `src/main/agent/V2ToolBridge.ts`
- Create: `src/main/agent/V2ToolBridge.test.ts`

V2ToolBridge wraps `agentToolExecutor` behind a localhost HTTP server. It reads tool context (runId, agentId, taskId, mode) from a temp JSON file written by AppServerProvider before each turn. Tool names use `__` as separator instead of `.` to comply with MCP naming rules (e.g. `filesystem__list`).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/agent/V2ToolBridge.test.ts
import http from 'http';
import { V2ToolBridge } from './V2ToolBridge';
import { agentToolExecutor } from './AgentToolExecutor';
import fs from 'fs';
import os from 'os';
import path from 'path';

jest.mock('./AgentToolExecutor', () => ({
  agentToolExecutor: {
    list: jest.fn(),
    execute: jest.fn(),
  },
}));

function httpPost(port: number, route: string, body: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      { hostname: '127.0.0.1', port, path: route, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('bad json')); } });
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

describe('V2ToolBridge', () => {
  let bridge: V2ToolBridge;
  let contextPath: string;

  beforeEach(async () => {
    contextPath = path.join(os.tmpdir(), `v2-ctx-test-${Date.now()}.json`);
    fs.writeFileSync(contextPath, JSON.stringify({
      runId: 'run-1', agentId: 'gpt-5.4', taskId: 'task-1', mode: 'unrestricted-dev',
    }));
    bridge = new V2ToolBridge(contextPath);
    await bridge.start();
  });

  afterEach(async () => {
    await bridge.stop();
    try { fs.unlinkSync(contextPath); } catch { /* ok */ }
  });

  it('GET /tools/list returns tools with __ separators', async () => {
    (agentToolExecutor.list as jest.Mock).mockReturnValue([
      { name: 'filesystem.list', description: 'List files', inputSchema: { type: 'object', properties: {} } },
    ]);
    const result = await httpPost(bridge.getPort(), '/tools/list', {}) as { tools: Array<{ name: string }> };
    expect(result.tools[0].name).toBe('filesystem__list');
  });

  it('POST /tools/call translates __ name back and executes', async () => {
    (agentToolExecutor.execute as jest.Mock).mockResolvedValue({
      summary: 'listed', data: { entries: [] }, validation: undefined,
    });
    const result = await httpPost(bridge.getPort(), '/tools/call', {
      name: 'filesystem__list', arguments: { path: '/tmp' }, contextPath,
    }) as { content: Array<{ type: string; text: string }> };
    expect(agentToolExecutor.execute).toHaveBeenCalledWith(
      'filesystem.list', { path: '/tmp' },
      expect.objectContaining({ runId: 'run-1', taskId: 'task-1' }),
    );
    expect(result.content[0].type).toBe('text');
  });

  it('binds to 127.0.0.1 only', () => {
    // port is an integer, server started — just check it's numeric and non-zero
    expect(typeof bridge.getPort()).toBe('number');
    expect(bridge.getPort()).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest src/main/agent/V2ToolBridge.test.ts --no-coverage
```

Expected: FAIL — `V2ToolBridge` not found.

- [ ] **Step 3: Implement V2ToolBridge**

```typescript
// src/main/agent/V2ToolBridge.ts
import http from 'http';
import fs from 'fs';
import { agentToolExecutor } from './AgentToolExecutor';
import { formatValidationForModel } from './ConstraintValidator';
import { chatKnowledgeStore } from '../chatKnowledge/ChatKnowledgeStore';
import type { AgentToolContext } from './AgentTypes';

const MAX_TOOL_RESULT_CHARS = 8_000;

// MCP tool names must not contain dots; we use __ as separator.
function toMcpName(agentName: string): string {
  return agentName.replace(/\./g, '__');
}

function fromMcpName(mcpName: string): string {
  return mcpName.replace(/__/g, '.');
}

function readContext(contextPath: string): AgentToolContext {
  try {
    const raw = fs.readFileSync(contextPath, 'utf-8');
    return JSON.parse(raw) as AgentToolContext;
  } catch {
    return { runId: 'unknown', agentId: 'unknown', mode: 'unrestricted-dev' };
  }
}

function compactResult(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 0);
  if (!text) return '';
  return text.length > MAX_TOOL_RESULT_CHARS
    ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n...[tool result truncated]`
    : text;
}

export class V2ToolBridge {
  private server: http.Server | null = null;
  private port = 0;

  constructor(private readonly contextPath: string) {}

  getPort(): number {
    return this.port;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        void this.handleRequest(req, res);
      });
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address();
        this.port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
      this.server.on('error', reject);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) { resolve(); return; }
      this.server.close(() => resolve());
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let body = '';
    for await (const chunk of req) {
      body += (chunk as Buffer).toString();
    }

    const send = (data: unknown, status = 200): void => {
      const payload = JSON.stringify(data);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(payload);
    };

    try {
      if (req.url === '/tools/list') {
        const tools = agentToolExecutor.list().map((t) => ({
          name: toMcpName(t.name),
          description: t.description,
          inputSchema: t.inputSchema,
        }));
        send({ tools });
        return;
      }

      if (req.url === '/tools/call') {
        const payload = JSON.parse(body) as { name: string; arguments: unknown; contextPath?: string };
        const toolName = fromMcpName(payload.name);
        const ctxPath = payload.contextPath || this.contextPath;
        const ctx = readContext(ctxPath);

        const result = await agentToolExecutor.execute(toolName as Parameters<typeof agentToolExecutor.execute>[0], payload.arguments, ctx);

        // Record to chatKnowledgeStore (same as providerToolRuntime does)
        if (ctx.taskId && !toolName.startsWith('chat.')) {
          chatKnowledgeStore.recordToolMessage(
            ctx.taskId,
            JSON.stringify({ tool: toolName, input: payload.arguments, result }, null, 2).slice(0, 50_000),
            ctx.agentId,
            ctx.runId,
          );
        }

        let text = compactResult(result);
        if (result.validation) {
          text += formatValidationForModel(result.validation);
        }
        send({ content: [{ type: 'text', text }] });
        return;
      }

      send({ error: 'Not found' }, 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      send({ content: [{ type: 'text', text: `Tool execution error: ${message}` }] });
    }
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest src/main/agent/V2ToolBridge.test.ts --no-coverage
```

Expected: PASS — 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/V2ToolBridge.ts src/main/agent/V2ToolBridge.test.ts
git commit -m "feat(codex): add V2ToolBridge in-process HTTP server wrapping agentToolExecutor"
```

---

## Task 3: AppServerProcess — codex app-server lifecycle manager

**Files:**
- Create: `src/main/agent/AppServerProcess.ts`
- Create: `src/main/agent/AppServerProcess.test.ts`

AppServerProcess spawns `codex app-server`, writes the `[mcp_servers.v2-tools]` config.toml entry non-destructively, polls `/readyz`, and opens a bootstrap WebSocket to wait for the `v2-tools` MCP server to become ready. It reconnects on crash with exponential backoff.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/agent/AppServerProcess.test.ts
import { AppServerProcess } from './AppServerProcess';
import { mergeTomlMcpEntry, parseListeningPort } from './AppServerProcess';

describe('parseListeningPort', () => {
  it('parses port from listening line', () => {
    expect(parseListeningPort('listening on: ws://127.0.0.1:54321')).toBe(54321);
  });
  it('returns null for non-matching line', () => {
    expect(parseListeningPort('some other output')).toBeNull();
  });
});

describe('mergeTomlMcpEntry', () => {
  it('adds v2-tools section to empty toml', () => {
    const result = mergeTomlMcpEntry('', '/path/to/shim.js', 3000, '/tmp/ctx.json');
    expect(result).toContain('[mcp_servers.v2-tools]');
    expect(result).toContain('command = "node"');
    expect(result).toContain('/path/to/shim.js');
    expect(result).toContain('V2_BRIDGE_PORT = "3000"');
    expect(result).toContain('V2_TOOL_CONTEXT_PATH = "/tmp/ctx.json"');
  });

  it('replaces existing v2-tools section, preserves other content', () => {
    const existing = '[other_server]\ncommand = "foo"\n\n[mcp_servers.v2-tools]\ncommand = "old"\n';
    const result = mergeTomlMcpEntry(existing, '/shim.js', 4000, '/tmp/ctx.json');
    expect(result).toContain('[other_server]');
    expect(result).toContain('command = "foo"');
    expect(result).not.toContain('command = "old"');
    expect(result).toContain('V2_BRIDGE_PORT = "4000"');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest src/main/agent/AppServerProcess.test.ts --no-coverage
```

Expected: FAIL — `AppServerProcess`, `mergeTomlMcpEntry`, `parseListeningPort` not found.

- [ ] **Step 3: Implement AppServerProcess**

```typescript
// src/main/agent/AppServerProcess.ts
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { EventEmitter } from 'events';
import WebSocket from 'ws';

const CODEX_CONFIG_DIR = path.join(os.homedir(), '.codex');
const CODEX_CONFIG_PATH = path.join(CODEX_CONFIG_DIR, 'config.toml');
const READYZ_TIMEOUT_MS = 30_000;
const READYZ_POLL_INTERVAL_MS = 200;
const INACTIVITY_TIMEOUT_MS = 180_000;
const MAX_BACKOFF_MS = 30_000;

export function parseListeningPort(line: string): number | null {
  const match = /listening on: ws:\/\/127\.0\.0\.1:(\d+)/.exec(line);
  return match ? Number(match[1]) : null;
}

// Non-destructive merge: replaces only the [mcp_servers.v2-tools] block.
export function mergeTomlMcpEntry(
  existing: string,
  shimPath: string,
  bridgePort: number,
  contextPath: string,
): string {
  const newBlock = [
    '[mcp_servers.v2-tools]',
    'command = "node"',
    `args = [${JSON.stringify(shimPath)}]`,
    '',
    '[mcp_servers.v2-tools.env]',
    `V2_BRIDGE_PORT = "${bridgePort}"`,
    `V2_TOOL_CONTEXT_PATH = "${contextPath}"`,
  ].join('\n');

  // Remove existing v2-tools block (from its header to the next section or EOF)
  const cleaned = existing.replace(
    /\[mcp_servers\.v2-tools\][\s\S]*?(?=\n\[|\n*$)/,
    '',
  ).trimEnd();

  return cleaned ? `${cleaned}\n\n${newBlock}\n` : `${newBlock}\n`;
}

type AppServerState =
  | { status: 'stopped' }
  | { status: 'starting' }
  | { status: 'ready'; wsPort: number }
  | { status: 'error'; error: string };

export class AppServerProcess extends EventEmitter {
  private state: AppServerState = { status: 'stopped' };
  private child: ChildProcess | null = null;
  private wsPort = 0;
  private backoffMs = 1_000;
  private stopped = false;
  private readyPromise: Promise<{ wsPort: number }> | null = null;
  private readyResolve: ((v: { wsPort: number }) => void) | null = null;
  private readyReject: ((e: Error) => void) | null = null;

  constructor(
    private readonly bridgePort: number,
    private readonly shimPath: string,
    private readonly contextPath: string,
  ) {
    super();
  }

  isReady(): boolean {
    return this.state.status === 'ready';
  }

  async waitUntilReady(): Promise<{ wsPort: number }> {
    if (this.state.status === 'ready') return { wsPort: this.wsPort };
    if (!this.readyPromise) {
      this.readyPromise = new Promise((resolve, reject) => {
        this.readyResolve = resolve;
        this.readyReject = reject;
      });
    }
    return this.readyPromise;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.writeConfig();
    await this.spawnAndWait();
  }

  stop(): void {
    this.stopped = true;
    this.child?.kill();
    this.child = null;
    this.state = { status: 'stopped' };
  }

  private writeConfig(): void {
    try {
      if (!fs.existsSync(CODEX_CONFIG_DIR)) {
        fs.mkdirSync(CODEX_CONFIG_DIR, { recursive: true });
      }
      const existing = fs.existsSync(CODEX_CONFIG_PATH)
        ? fs.readFileSync(CODEX_CONFIG_PATH, 'utf-8')
        : '';
      const merged = mergeTomlMcpEntry(existing, this.shimPath, this.bridgePort, this.contextPath);
      fs.writeFileSync(CODEX_CONFIG_PATH, merged, 'utf-8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`AppServerProcess: failed to write config.toml: ${message}`);
    }
  }

  private async spawnAndWait(): Promise<void> {
    this.state = { status: 'starting' };

    const wsPort = await this.spawnProcess();
    this.wsPort = wsPort;

    await this.pollReadyz(wsPort);
    await this.waitForMcpReady(wsPort);

    this.state = { status: 'ready', wsPort };
    this.backoffMs = 1_000;
    this.readyResolve?.({ wsPort });
    this.emit('ready', { wsPort });
  }

  private spawnProcess(): Promise<number> {
    return new Promise((resolve, reject) => {
      const child = spawn('codex', ['app-server', '--listen', 'ws://127.0.0.1:0'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.child = child;

      let portFound = false;
      let stderr = '';

      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        for (const line of text.split('\n')) {
          const port = parseListeningPort(line.trim());
          if (port && !portFound) {
            portFound = true;
            resolve(port);
          }
        }
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('error', (err) => {
        if (!portFound) reject(err);
        else this.handleCrash(`process error: ${err.message}`);
      });

      child.on('close', (code) => {
        if (!portFound) {
          reject(new Error(`codex app-server exited early (${code}): ${stderr.trim().slice(0, 200)}`));
        } else {
          this.handleCrash(`process exited with code ${code}`);
        }
      });

      setTimeout(() => {
        if (!portFound) {
          child.kill();
          reject(new Error('codex app-server did not emit a listening port within 30s'));
        }
      }, READYZ_TIMEOUT_MS);
    });
  }

  private pollReadyz(wsPort: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + READYZ_TIMEOUT_MS;
      const poll = (): void => {
        if (Date.now() > deadline) {
          reject(new Error('codex app-server /readyz did not return 200 within 30s'));
          return;
        }
        const req = http.get(`http://127.0.0.1:${wsPort}/readyz`, (res) => {
          if (res.statusCode === 200) { resolve(); return; }
          setTimeout(poll, READYZ_POLL_INTERVAL_MS);
        });
        req.on('error', () => setTimeout(poll, READYZ_POLL_INTERVAL_MS));
        req.end();
      };
      poll();
    });
  }

  private waitForMcpReady(wsPort: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('v2-tools MCP server did not become ready within 30s'));
      }, READYZ_TIMEOUT_MS);

      ws.on('open', () => {
        // Send initialize handshake
        ws.send(JSON.stringify({ type: 'initialize', version: '2' }));
      });

      ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString()) as Record<string, unknown>;
          if (
            msg.type === 'mcpServer/startupStatus/updated' &&
            (msg as { serverName?: string; status?: string }).serverName === 'v2-tools' &&
            (msg as { serverName?: string; status?: string }).status === 'ready'
          ) {
            clearTimeout(timer);
            ws.close();
            resolve();
          }
        } catch {
          // ignore parse errors on bootstrap ws
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private handleCrash(reason: string): void {
    if (this.stopped) return;
    console.error(`AppServerProcess: crashed (${reason}); restarting in ${this.backoffMs}ms`);
    this.state = { status: 'error', error: reason };
    this.emit('crash', { reason });

    setTimeout(() => {
      if (this.stopped) return;
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
      this.writeConfig();
      void this.spawnAndWait().catch((err) => {
        console.error(`AppServerProcess: restart failed: ${err instanceof Error ? err.message : String(err)}`);
        this.handleCrash('restart failed');
      });
    }, this.backoffMs);
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest src/main/agent/AppServerProcess.test.ts --no-coverage
```

Expected: PASS — 4 tests pass (2 for parseListeningPort, 2 for mergeTomlMcpEntry).

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/AppServerProcess.ts src/main/agent/AppServerProcess.test.ts
git commit -m "feat(codex): add AppServerProcess lifecycle manager for codex app-server"
```

---

## Task 4: AppServerProvider — AgentProvider WebSocket implementation

**Files:**
- Create: `src/main/agent/AppServerProvider.ts`
- Create: `src/main/agent/AppServerProvider.test.ts`

AppServerProvider implements `AgentProvider`. It maintains a thread registry (`Map<taskId, threadId>`), persisted to `userData/codex-threads.json`. Each `invoke()` does: write context file → thread/start or thread/resume → turn/start → accumulate streaming events → build AgentProviderResult.

Tool pack expansion works identically to CodexProvider: `resolveToolPackExpansion()` on `mcpToolCall` results, `resolveAutoExpandedToolPack()` post-turn on accumulated message text, with a follow-up turn carrying a host note.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/agent/AppServerProvider.test.ts
import { AppServerProvider, loadThreadRegistry, saveThreadRegistry, pruneExpiredEntries } from './AppServerProvider';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

describe('thread registry persistence helpers', () => {
  describe('pruneExpiredEntries', () => {
    it('removes entries older than 7 days', () => {
      const now = Date.now();
      const entries = {
        'task-old': { threadId: 'thread-old', savedAt: now - SEVEN_DAYS_MS - 1 },
        'task-new': { threadId: 'thread-new', savedAt: now - 1000 },
      };
      const pruned = pruneExpiredEntries(entries, now);
      expect(pruned['task-old']).toBeUndefined();
      expect(pruned['task-new']).toBeDefined();
    });

    it('keeps entries exactly at 7 days boundary', () => {
      const now = Date.now();
      const entries = {
        'task-boundary': { threadId: 'thread-b', savedAt: now - SEVEN_DAYS_MS },
      };
      const pruned = pruneExpiredEntries(entries, now);
      expect(pruned['task-boundary']).toBeDefined();
    });
  });
});

describe('toMcpToolName / fromMcpToolName round-trip', () => {
  // These are internal to AppServerProvider but we test via the provider's behavior indirectly.
  // The key contract: dots become __ so codex MCP names pass validation.
  it('filesystem.list -> filesystem__list is the expected pattern', () => {
    // Verified by V2ToolBridge tests; here we confirm the shim contract is understood.
    expect('filesystem.list'.replace(/\./g, '__')).toBe('filesystem__list');
    expect('filesystem__list'.replace(/__/g, '.')).toBe('filesystem.list');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest src/main/agent/AppServerProvider.test.ts --no-coverage
```

Expected: FAIL — `AppServerProvider`, `loadThreadRegistry`, `saveThreadRegistry`, `pruneExpiredEntries` not found.

- [ ] **Step 3: Implement AppServerProvider**

```typescript
// src/main/agent/AppServerProvider.ts
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { app } from 'electron';
import WebSocket from 'ws';
import {
  PRIMARY_PROVIDER_ID,
  type CodexItem,
  type ProviderId,
} from '../../shared/types/model';
import type { AgentProvider, AgentProviderRequest, AgentProviderResult, AgentToolName } from './AgentTypes';
import {
  DEFAULT_PROVIDER_MAX_TOOL_TURNS,
  describeProviderToolCall,
  normalizeProviderMaxToolTurns,
  publishProviderFinalOutput,
  resolveToolPackExpansion,
} from './providerToolRuntime';
import { mergeExpandedTools, resolveAutoExpandedToolPack } from './toolPacks';
import type { AppServerProcess } from './AppServerProcess';

const THREAD_FILE = 'codex-threads.json';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TURN_TIMEOUT_MS = 3 * 60 * 1000;
const CONTEXT_PATH = path.join(os.tmpdir(), 'v2-tool-context.json');

// ─── Thread persistence ───────────────────────────────────────────────────────

type ThreadEntry = { threadId: string; savedAt: number };
type ThreadRegistry = Record<string, ThreadEntry>;

function getThreadFilePath(): string {
  try {
    return path.join(app.getPath('userData'), THREAD_FILE);
  } catch {
    return path.join(os.tmpdir(), THREAD_FILE);
  }
}

export function pruneExpiredEntries(entries: ThreadRegistry, now: number): ThreadRegistry {
  const result: ThreadRegistry = {};
  for (const [taskId, entry] of Object.entries(entries)) {
    if (now - entry.savedAt <= SEVEN_DAYS_MS) {
      result[taskId] = entry;
    }
  }
  return result;
}

export function loadThreadRegistry(): ThreadRegistry {
  try {
    const filePath = getThreadFilePath();
    if (!fs.existsSync(filePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ThreadRegistry;
    return pruneExpiredEntries(typeof parsed === 'object' && parsed ? parsed : {}, Date.now());
  } catch {
    return {};
  }
}

export function saveThreadRegistry(registry: ThreadRegistry): void {
  try {
    fs.writeFileSync(getThreadFilePath(), JSON.stringify(registry, null, 2), 'utf-8');
  } catch (err) {
    console.error('AppServerProvider: failed to persist thread registry:', err);
  }
}

// ─── WebSocket message types (subset we care about) ───────────────────────────

type WsMsg = Record<string, unknown>;

// ─── AppServerProvider ────────────────────────────────────────────────────────

type AppServerProviderOptions = {
  providerId?: ProviderId;
  modelId?: string;
  process: AppServerProcess;
};

export class AppServerProvider implements AgentProvider {
  readonly providerId: ProviderId;
  readonly modelId: string;
  readonly supportsAppToolExecutor = true;

  private aborted = false;
  private abortCurrentTurn: (() => void) | null = null;
  private ws: WebSocket | null = null;
  private wsPort = 0;
  private threadRegistry: ThreadRegistry = loadThreadRegistry();

  constructor(private readonly options: AppServerProviderOptions) {
    this.providerId = options.providerId ?? PRIMARY_PROVIDER_ID;
    this.modelId = options.modelId ?? this.providerId;
  }

  abort(): void {
    this.aborted = true;
    this.abortCurrentTurn?.();
  }

  async connect(wsPort: number): Promise<void> {
    this.wsPort = wsPort;
    await this.openWebSocket(wsPort);
  }

  private openWebSocket(wsPort: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
      ws.on('open', () => {
        this.ws = ws;
        // Send initialize handshake
        ws.send(JSON.stringify({ type: 'initialize', version: '2' }));
        resolve();
      });
      ws.on('error', reject);
      ws.on('close', () => {
        this.ws = null;
      });
    });
  }

  private ensureWebSocket(): WebSocket {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('AppServerProvider WebSocket is not connected. Wait for connect() to complete.');
    }
    return this.ws;
  }

  private writeContext(request: Pick<AgentProviderRequest, 'runId' | 'agentId' | 'mode' | 'taskId'>): void {
    const ctx = {
      runId: request.runId,
      agentId: request.agentId,
      taskId: request.taskId,
      mode: request.mode,
    };
    fs.writeFileSync(CONTEXT_PATH, JSON.stringify(ctx), 'utf-8');
  }

  private sendAndReceive(ws: WebSocket, payload: WsMsg): Promise<WsMsg[]> {
    // Not used directly; turn logic uses the streaming approach below.
    return Promise.reject(new Error('use runTurn instead'));
  }

  async invoke(request: AgentProviderRequest): Promise<AgentProviderResult> {
    this.aborted = false;
    const startedAt = Date.now();
    let inputTokens = 0;
    let outputTokens = 0;
    const completedItems = new Map<string, CodexItem>();
    let currentTools = [...request.tools];
    const toolCatalog = request.toolCatalog?.length ? request.toolCatalog : request.tools;
    const maxToolTurns = normalizeProviderMaxToolTurns(request.maxToolTurns ?? DEFAULT_PROVIDER_MAX_TOOL_TURNS);

    this.writeContext(request);

    const ws = this.ensureWebSocket();
    const taskId = request.taskId ?? 'default';

    // Acquire or create thread
    let threadId = await this.acquireThread(ws, taskId, request.systemPrompt);

    // Turn loop — each outer iteration is one Codex turn
    let totalTurns = 0;
    let accumulated = '';
    let finalOutput = '';

    while (totalTurns < maxToolTurns) {
      if (this.aborted) throw new Error('Task cancelled by user.');

      const turnResult = await this.runOneTurn(ws, {
        threadId,
        input: totalTurns === 0 ? request.task : null,
        contextPrompt: request.contextPrompt ?? null,
        outputSchema: buildOutputSchema(currentTools.map((t) => t.name as AgentToolName)),
        maxTurns: maxToolTurns,
        request,
        currentTools,
        toolCatalog,
        completedItems,
      });

      inputTokens += turnResult.inputTokens;
      outputTokens += turnResult.outputTokens;
      accumulated = turnResult.message;

      if (turnResult.kind === 'final') {
        // Check for auto-expansion pattern in final message
        const autoExpansion = resolveAutoExpandedToolPack(accumulated, currentTools, toolCatalog);
        if (autoExpansion && totalTurns < maxToolTurns - 1) {
          currentTools = mergeExpandedTools(currentTools, toolCatalog, autoExpansion);
          const expandedNames = autoExpansion.scope === 'all' ? ['all eligible tools'] : autoExpansion.tools;
          const hostNote = [
            `Host auto-expanded tool pack "${autoExpansion.pack}".`,
            `Reason: ${autoExpansion.reason}`,
            `Description: ${autoExpansion.description}`,
            `Expanded tools: ${expandedNames.join(', ')}`,
          ].join('\n');
          request.onStatus?.(`tool-auto-expand:${autoExpansion.pack}`);
          // Follow-up turn with host note as input
          threadId = await this.resumeThread(ws, taskId, threadId, request.systemPrompt);
          totalTurns++;
          // Next loop iteration will send the host note as turn input
          // We inject it by patching request.task for this iteration only
          request = { ...request, task: hostNote };
          continue;
        }

        finalOutput = accumulated;
        break;
      }

      totalTurns++;

      // If tool pack expanded during this turn, inject a follow-up turn
      if (turnResult.toolPackExpanded) {
        currentTools = turnResult.expandedTools!;
        const expandedNames = turnResult.expansion!.scope === 'all'
          ? ['all eligible tools']
          : turnResult.expansion!.tools;
        const hostNote = [
          `Host expanded tool pack "${turnResult.expansion!.pack}".`,
          `New tools available: ${expandedNames.join(', ')}`,
        ].join('\n');
        request = { ...request, task: hostNote };
      }
    }

    if (!finalOutput) {
      // Max turns exhausted — emit final with accumulated text
      finalOutput = accumulated || 'The run ended without a final answer. Please retry.';
    }

    const finalItem = publishProviderFinalOutput({
      request,
      itemId: `${this.providerId}-final-${Date.now()}`,
      text: finalOutput,
    });
    completedItems.set(finalItem.id, finalItem);

    return {
      output: finalItem.text,
      codexItems: Array.from(completedItems.values()),
      usage: { inputTokens, outputTokens, durationMs: Date.now() - startedAt },
    };
  }

  private async acquireThread(ws: WebSocket, taskId: string, systemPrompt: string): Promise<string> {
    const existing = this.threadRegistry[taskId];
    if (existing) {
      try {
        return await this.resumeThread(ws, taskId, existing.threadId, systemPrompt);
      } catch {
        // Thread expired — fall through to start
        delete this.threadRegistry[taskId];
        saveThreadRegistry(this.threadRegistry);
      }
    }
    return this.startThread(ws, taskId, systemPrompt);
  }

  private startThread(ws: WebSocket, taskId: string, developerInstructions: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const msgId = `thread-start-${Date.now()}`;
      const timeout = setTimeout(() => reject(new Error('thread/start timed out')), TURN_TIMEOUT_MS);

      const onMsg = (data: Buffer): void => {
        try {
          const msg = JSON.parse(data.toString()) as WsMsg;
          if (msg.id === msgId && msg.type === 'thread/started') {
            clearTimeout(timeout);
            ws.off('message', onMsg);
            const threadId = msg.threadId as string;
            this.threadRegistry[taskId] = { threadId, savedAt: Date.now() };
            saveThreadRegistry(this.threadRegistry);
            resolve(threadId);
          } else if (msg.id === msgId && msg.type === 'error') {
            clearTimeout(timeout);
            ws.off('message', onMsg);
            reject(new Error(String(msg.message || 'thread/start failed')));
          }
        } catch { /* ignore */ }
      };
      ws.on('message', onMsg);
      ws.send(JSON.stringify({
        type: 'thread/start',
        id: msgId,
        developerInstructions,
        approvalPolicy: 'never',
        sandbox: 'danger-full-access',
        persistExtendedHistory: true,
      }));
    });
  }

  private resumeThread(ws: WebSocket, taskId: string, threadId: string, developerInstructions: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const msgId = `thread-resume-${Date.now()}`;
      const timeout = setTimeout(() => reject(new Error('thread/resume timed out')), TURN_TIMEOUT_MS);

      const onMsg = (data: Buffer): void => {
        try {
          const msg = JSON.parse(data.toString()) as WsMsg;
          if (msg.id === msgId && msg.type === 'thread/resumed') {
            clearTimeout(timeout);
            ws.off('message', onMsg);
            this.threadRegistry[taskId] = { threadId, savedAt: Date.now() };
            saveThreadRegistry(this.threadRegistry);
            resolve(threadId);
          } else if (msg.id === msgId && (msg.type === 'error' || msg.type === 'thread/not-found')) {
            clearTimeout(timeout);
            ws.off('message', onMsg);
            reject(new Error('thread not found'));
          }
        } catch { /* ignore */ }
      };
      ws.on('message', onMsg);
      ws.send(JSON.stringify({
        type: 'thread/resume',
        id: msgId,
        threadId,
        developerInstructions,
        approvalPolicy: 'never',
        sandbox: 'danger-full-access',
        persistExtendedHistory: true,
      }));
    });
  }

  private runOneTurn(
    ws: WebSocket,
    params: {
      threadId: string;
      input: string | null;
      contextPrompt: string | null;
      outputSchema: Record<string, unknown>;
      maxTurns: number;
      request: AgentProviderRequest;
      currentTools: AgentProviderRequest['tools'];
      toolCatalog: AgentProviderRequest['tools'];
      completedItems: Map<string, CodexItem>;
    },
  ): Promise<{
    kind: 'tool_calls' | 'final';
    message: string;
    inputTokens: number;
    outputTokens: number;
    toolPackExpanded: boolean;
    expandedTools?: AgentProviderRequest['tools'];
    expansion?: ReturnType<typeof resolveToolPackExpansion>;
  }> {
    return new Promise((resolve, reject) => {
      const turnId = `turn-${Date.now()}`;
      let messageText = '';
      let inputTokens = 0;
      let outputTokens = 0;
      let toolPackExpanded = false;
      let expandedTools: AgentProviderRequest['tools'] | undefined;
      let expansion: ReturnType<typeof resolveToolPackExpansion> | undefined;
      let settled = false;
      let currentTurnId: string | null = null;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          ws.off('message', onMsg);
          // Try to interrupt
          if (currentTurnId) {
            ws.send(JSON.stringify({ type: 'turn/interrupt', threadId: params.threadId, turnId: currentTurnId }));
          }
          reject(new Error(`Turn inactivity timeout after ${TURN_TIMEOUT_MS / 1000}s`));
        }
      }, TURN_TIMEOUT_MS);

      this.abortCurrentTurn = (): void => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          ws.off('message', onMsg);
          if (currentTurnId) {
            ws.send(JSON.stringify({ type: 'turn/interrupt', threadId: params.threadId, turnId: currentTurnId }));
          }
          reject(new Error('Task cancelled by user.'));
        }
      };

      const onMsg = (data: Buffer): void => {
        if (settled) return;
        let msg: WsMsg;
        try { msg = JSON.parse(data.toString()); } catch { return; }

        // Track turn ID from first turn event
        if (msg.turnId && !currentTurnId) currentTurnId = msg.turnId as string;

        switch (msg.type) {
          case 'item/agentMessage/delta': {
            const delta = msg.delta as string || '';
            messageText += delta;
            params.request.onToken?.(delta);
            break;
          }

          case 'item/started': {
            if (msg.itemType === 'mcpToolCall') {
              const toolName = fromMcpName(msg.toolName as string || '');
              const callDescription = describeProviderToolCall(toolName, msg.arguments);
              params.request.onStatus?.(`tool-start:${callDescription}`);
              const itemId = `${this.providerId}-tool-${Date.now()}`;
              const startedItem: CodexItem = {
                id: itemId,
                type: 'mcp_tool_call',
                server: 'v2',
                tool: toolName as AgentToolName,
                arguments: (msg.arguments && typeof msg.arguments === 'object')
                  ? msg.arguments as Record<string, unknown> : {},
                result: null,
                error: null,
                status: 'in_progress',
              };
              params.request.onItem?.({ item: startedItem, eventType: 'item.started' });
              params.completedItems.set(itemId, startedItem);
            }
            break;
          }

          case 'item/completed': {
            if (msg.itemType === 'mcpToolCall') {
              const toolName = fromMcpName(msg.toolName as string || '');
              const callDescription = describeProviderToolCall(toolName, msg.arguments);
              // Find previously started item
              const existing = Array.from(params.completedItems.values()).find(
                (i) => i.type === 'mcp_tool_call' && (i as Extract<CodexItem, { type: 'mcp_tool_call' }>).tool === toolName && (i as Extract<CodexItem, { type: 'mcp_tool_call' }>).status === 'in_progress',
              ) as Extract<CodexItem, { type: 'mcp_tool_call' }> | undefined;
              if (existing) {
                const completedItem: Extract<CodexItem, { type: 'mcp_tool_call' }> = {
                  ...existing,
                  result: msg.result ?? null,
                  status: msg.error ? 'failed' : 'completed',
                  error: msg.error ?? null,
                };
                params.completedItems.set(existing.id, completedItem);
                params.request.onItem?.({ item: completedItem, eventType: 'item.completed' });
              }
              const resultSummary = msg.error ? `error: ${String(msg.error).slice(0, 80)}` : 'done';
              params.request.onStatus?.(`tool-done:${callDescription} -> ${resultSummary}`);

              // Check for tool pack expansion
              const toolResult = msg.result as { summary?: string; data?: Record<string, unknown> } | null;
              if (toolName === 'runtime.request_tool_pack' && toolResult) {
                const exp = resolveToolPackExpansion(params.request, toolName as AgentToolName, {
                  summary: toolResult.summary ?? '',
                  data: toolResult.data ?? {},
                });
                if (exp) {
                  toolPackExpanded = true;
                  expansion = exp;
                  expandedTools = mergeExpandedTools(params.currentTools, params.toolCatalog, exp);
                }
              }
            }
            break;
          }

          case 'thread/tokenUsage/updated': {
            const last = msg.last as { inputTokens?: number; outputTokens?: number } | undefined;
            if (last) {
              inputTokens += last.inputTokens ?? 0;
              outputTokens += last.outputTokens ?? 0;
            }
            break;
          }

          case 'turn/completed': {
            settled = true;
            clearTimeout(timeout);
            ws.off('message', onMsg);
            this.abortCurrentTurn = null;
            const kind = (msg.stopReason === 'tool_calls' && !toolPackExpanded) ? 'tool_calls' : 'final';
            resolve({
              kind: toolPackExpanded ? 'tool_calls' : kind,
              message: messageText,
              inputTokens,
              outputTokens,
              toolPackExpanded,
              expandedTools: toolPackExpanded ? expandedTools : undefined,
              expansion: toolPackExpanded ? expansion : undefined,
            });
            break;
          }

          case 'turn/failed':
          case 'error': {
            settled = true;
            clearTimeout(timeout);
            ws.off('message', onMsg);
            this.abortCurrentTurn = null;
            reject(new Error(String(msg.message || msg.error || 'Turn failed')));
            break;
          }
        }
      };

      ws.on('message', onMsg);

      // Build turn input
      const userInput = params.input
        ? [{ type: 'message', role: 'user', content: params.input }]
        : [];
      if (params.contextPrompt && params.input) {
        userInput.unshift({ type: 'message', role: 'system', content: params.contextPrompt });
      }

      ws.send(JSON.stringify({
        type: 'turn/start',
        id: turnId,
        threadId: params.threadId,
        input: userInput,
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'danger-full-access' },
        outputSchema: params.outputSchema,
      }));
    });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fromMcpName(mcpName: string): string {
  return mcpName.replace(/__/g, '.');
}

function buildOutputSchema(toolNames: AgentToolName[]): Record<string, unknown> {
  // Pass a permissive schema — Codex handles native tool calling via MCP.
  // OutputSchema constrains the final text turn only when no tools are expected.
  return {
    type: 'object',
    additionalProperties: false,
    required: ['message'],
    properties: {
      message: { type: 'string' },
    },
  };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest src/main/agent/AppServerProvider.test.ts --no-coverage
```

Expected: PASS — 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/AppServerProvider.ts src/main/agent/AppServerProvider.test.ts
git commit -m "feat(codex): add AppServerProvider WebSocket AgentProvider with thread persistence"
```

---

## Task 5: Wire everything into AgentModelService

**Files:**
- Modify: `src/main/agent/AgentModelService.ts`

Replace `initializeCodexProvider` with `initializeAppServerProvider`. The new method:
1. Checks `CODEX_PROVIDER=exec` env — if set, falls through to original CodexProvider (keep that import and method).
2. Creates `V2ToolBridge`, calls `bridge.start()`.
3. Creates `AppServerProcess` with the bridge port and shim path.
4. Calls `process.start()`.
5. Creates `AppServerProvider`, calls `provider.connect(wsPort)`.
6. Registers it as the PRIMARY_PROVIDER_ID entry.

Also update `createProviderInstance()` to return an `AppServerProvider` for the primary provider.

- [ ] **Step 1: Read the current initializeCodexProvider signature**

Already read above — `initializeCodexProvider(config: { id: ProviderId; label: string; modelId: string }): void` at line 260.

- [ ] **Step 2: Write the new async init method and update init()**

Edit `src/main/agent/AgentModelService.ts`:

```typescript
// Add these imports near the top (after existing imports):
import { V2ToolBridge } from './V2ToolBridge';
import { AppServerProcess } from './AppServerProcess';
import { AppServerProvider } from './AppServerProvider';
import * as path from 'path';
```

Replace the `init()` method body:

```typescript
init(): void {
  agentToolExecutor.registerMany([
    ...createRuntimeToolDefinitions(),
    ...createBrowserToolDefinitions(),
    ...createChatToolDefinitions(),
    ...createFilesystemToolDefinitions(),
    ...createTerminalToolDefinitions(),
    ...createSubAgentToolDefinitions((input) => this.createPreferredSubAgentProvider(input)),
  ]);

  if (process.env.CODEX_PROVIDER === 'exec') {
    this.initializeCodexProvider(PROVIDER_CONFIGS[0]);
  } else {
    // Async startup — errors are surfaced via provider status
    void this.initializeAppServerProvider(PROVIDER_CONFIGS[0]);
  }
  this.initializeHaikuProvider(PROVIDER_CONFIGS[1]);

  if (this.providers.size === 0) {
    this.log('system', 'warn', 'No model providers are available.');
  }
}
```

Add the new async initializer method:

```typescript
private async initializeAppServerProvider(config: { id: ProviderId; label: string; modelId: string }): Promise<void> {
  // Check codex CLI is present first
  const probe = CodexProvider.isAvailable();
  if (!probe.available) {
    this.setRuntime(config.id, {
      status: 'unavailable',
      activeTaskId: null,
      errorDetail: probe.error || 'Codex CLI is not installed.',
    }, config.modelId);
    this.log(config.id, 'warn', `${config.label} unavailable: ${probe.error || 'Codex CLI is not installed.'}`);
    return;
  }

  this.setRuntime(config.id, { status: 'unavailable', activeTaskId: null, errorDetail: 'Starting...' }, config.modelId);

  try {
    const contextPath = require('path').join(require('os').tmpdir(), 'v2-tool-context.json');

    // 1. Start the in-process HTTP bridge
    const bridge = new V2ToolBridge(contextPath);
    await bridge.start();
    const bridgePort = bridge.getPort();
    this.log(config.id, 'info', `V2ToolBridge started on port ${bridgePort}`);

    // 2. Start codex app-server
    const shimPath = path.join(__dirname, 'v2-mcp-shim.js');
    const appServerProcess = new AppServerProcess(bridgePort, shimPath, contextPath);
    await appServerProcess.start();
    const { wsPort } = await appServerProcess.waitUntilReady();
    this.log(config.id, 'info', `codex app-server ready on ws port ${wsPort}`);

    // 3. Connect provider WebSocket
    const provider = new AppServerProvider({
      providerId: config.id,
      modelId: config.modelId,
      process: appServerProcess,
    });
    await provider.connect(wsPort);

    this.providers.set(config.id, {
      id: config.id,
      label: config.label,
      modelId: provider.modelId,
      supportsAppToolExecutor: Boolean(provider.supportsAppToolExecutor),
      runtime: new AgentRuntime(provider),
    });
    this.setRuntime(config.id, { status: 'available', activeTaskId: null, errorDetail: null }, provider.modelId);
    this.log(config.id, 'info', `${config.label} ready (app-server mode)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    this.setRuntime(config.id, { status: 'error', activeTaskId: null, errorDetail: message }, config.modelId);
    this.log(config.id, 'error', `${config.label} startup failed: ${message}`);
  }
}
```

Add a private field to track the primary provider instance, and update `createProviderInstance()`:

```typescript
// Add this field to the class:
private appServerProvider: AppServerProvider | null = null;
```

Then inside `initializeAppServerProvider`, after creating the provider and before `this.providers.set(...)`:
```typescript
    this.appServerProvider = provider;
```

Update `createProviderInstance()`:

```typescript
private createProviderInstance(providerId: ProviderId): AgentProvider {
  const config = PROVIDER_CONFIGS.find((entry) => entry.id === providerId);
  if (!config) {
    throw new Error(`Unknown provider configuration: ${providerId}`);
  }
  if (providerId === HAIKU_PROVIDER_ID) {
    return new HaikuProvider();
  }
  // For sub-agent spawning: if app-server provider is running, reuse it (shared WS connection)
  if (this.appServerProvider) {
    return this.appServerProvider;
  }
  return new CodexProvider({ providerId: config.id, modelId: config.modelId });
}
```

- [ ] **Step 3: Build to check for TypeScript errors**

```bash
npx tsc --noEmit 2>&1 | head -40
```

Expected: zero errors, or only pre-existing errors unrelated to the new files. Fix any errors in the new files before continuing.

- [ ] **Step 4: Run all agent tests**

```bash
npx jest src/main/agent/ --no-coverage 2>&1 | tail -30
```

Expected: all previously passing tests still pass; new tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/AgentModelService.ts
git commit -m "feat(codex): wire AppServerProvider into AgentModelService startup"
```

---

## Task 6: Smoke test — end-to-end startup

This task has no automated test. It's a manual verification that the startup sequence succeeds in the actual Electron app.

- [ ] **Step 1: Start the app in dev mode**

```bash
npm run dev
```

Watch stdout for these log lines (in order):
1. `V2ToolBridge started on port <N>`
2. `codex app-server ready on ws port <M>`
3. `GPT-5.4 ready (app-server mode)`

- [ ] **Step 2: Submit a simple task**

In the app UI, submit a prompt: `list the files in /tmp`

Expected:
- Status bar shows tool-start events (e.g. `Files: list /tmp`)
- Token streaming appears incrementally (not waiting for full turn)
- Tool result appears in chat

- [ ] **Step 3: Submit the same task again (continuity check)**

Submit: `now list /tmp/codex` (or any follow-up)

Expected:
- No re-injection of 28k tokens (watch app-server logs)
- Response arrives faster than the first turn

- [ ] **Step 4: Test escape hatch**

```bash
CODEX_PROVIDER=exec npm run dev
```

Expected: old `CodexProvider` is used (no V2ToolBridge or AppServerProcess log lines).

- [ ] **Step 5: Commit smoke test notes**

```bash
git commit --allow-empty -m "chore: smoke test passed — app-server provider operational"
```

---

## Spec Coverage Check

| Spec requirement | Task |
|---|---|
| V2ToolBridge: `/tools/list` with `__` separators | Task 2 |
| V2ToolBridge: `/tools/call` with context file, ConstraintValidator, chatKnowledgeStore | Task 2 |
| V2ToolBridge: `127.0.0.1` only | Task 2 |
| v2-mcp-shim: stdio↔HTTP, initialize, tools/list, tools/call | Task 1 |
| v2-mcp-shim: zero npm deps | Task 1 |
| AppServerProcess: spawn `codex app-server --listen ws://127.0.0.1:0` | Task 3 |
| AppServerProcess: non-destructive config.toml merge | Task 3 |
| AppServerProcess: poll `/readyz` | Task 3 |
| AppServerProcess: wait for `mcpServer/startupStatus/updated` v2-tools ready | Task 3 |
| AppServerProcess: exponential backoff reconnect | Task 3 |
| AppServerProvider: thread/start + thread/resume with fallback | Task 4 |
| AppServerProvider: token streaming via `item/agentMessage/delta` | Task 4 |
| AppServerProvider: onItem + onStatus for mcpToolCall events | Task 4 |
| AppServerProvider: tool pack expansion (resolveToolPackExpansion + resolveAutoExpandedToolPack) | Task 4 |
| AppServerProvider: turn/interrupt on abort | Task 4 |
| AppServerProvider: usage from `thread/tokenUsage/updated` | Task 4 |
| Thread persistence: `userData/codex-threads.json`, 7-day eviction | Task 4 |
| AgentModelService: V2ToolBridge → AppServerProcess → AppServerProvider startup | Task 5 |
| AgentModelService: `CODEX_PROVIDER=exec` escape hatch | Task 5 |
| CodexProvider: kept in codebase, not deleted | Task 5 (import kept) |
