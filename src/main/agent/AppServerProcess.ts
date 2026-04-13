import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { EventEmitter } from 'events';

const CODEX_CONFIG_DIR = path.join(os.homedir(), '.codex');
const CODEX_CONFIG_PATH = path.join(CODEX_CONFIG_DIR, 'config.toml');
const READYZ_TIMEOUT_MS = 30_000;
const READYZ_POLL_INTERVAL_MS = 200;
const MAX_BACKOFF_MS = 30_000;

export function parseListeningPort(line: string): number | null {
  const match = /listening on: ws:\/\/127\.0\.0\.1:(\d+)/.exec(line);
  return match ? Number(match[1]) : null;
}

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

// Use the Node 24 built-in WebSocket global via type cast.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const NativeWebSocket = (globalThis as any).WebSocket as typeof WebSocket;

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
    try {
      await this.spawnAndWait();
    } catch (err) {
      this.readyReject?.(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
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

      const portTimer = setTimeout(() => {
        if (!portFound) {
          child.kill();
          reject(new Error('codex app-server did not emit a listening port within 30s'));
        }
      }, READYZ_TIMEOUT_MS);

      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        for (const line of text.split('\n')) {
          const port = parseListeningPort(line.trim());
          if (port && !portFound) {
            portFound = true;
            clearTimeout(portTimer);
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
      const ws = new NativeWebSocket(`ws://127.0.0.1:${wsPort}`);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('v2-tools MCP server did not become ready within 30s'));
      }, READYZ_TIMEOUT_MS);

      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ type: 'initialize', version: '2' }));
      });

      ws.addEventListener('message', (event: MessageEvent) => {
        try {
          const msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString()) as Record<string, unknown>;
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
          // ignore parse errors
        }
      });

      ws.addEventListener('error', (event: Event) => {
        clearTimeout(timer);
        ws.close();
        reject(new Error(`WebSocket error: ${event.type}`));
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
        this.readyReject?.(err instanceof Error ? err : new Error(String(err)));
        this.handleCrash('restart failed');
      });
    }, this.backoffMs);
  }
}
