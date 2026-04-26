import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { EventEmitter } from 'events';

const READYZ_TIMEOUT_MS = 30_000;
const READYZ_POLL_INTERVAL_MS = 200;
const MAX_BACKOFF_MS = 30_000;

export function codexConfigDirForHome(homeDir: string): string {
  return path.join(homeDir, '.codex');
}

export function codexConfigPathForHome(homeDir: string): string {
  return path.join(codexConfigDirForHome(homeDir), 'config.toml');
}

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

  // Remove all v2-tools sections (both [mcp_servers.v2-tools] and any
  // [mcp_servers.v2-tools.*] subsections like .env that may appear anywhere).
  // Also remove the legacy local-agent server and any stray quoted-path sections
  // left by previous bad runs so Codex does not pick a Claude-Browser bridge.
  const stripManagedSections = (source: string): string => {
    const lines = source.split('\n');
    const kept: string[] = [];
    let skip = false;

    for (const line of lines) {
      const sectionMatch = /^\[(.+)\]\s*$/.exec(line.trim());
      if (sectionMatch) {
        const sectionName = sectionMatch[1];
        skip = sectionName === 'mcp_servers.v2-tools'
          || sectionName.startsWith('mcp_servers.v2-tools.')
          || sectionName === 'mcp_servers.local-agent'
          || sectionName.startsWith('mcp_servers.local-agent.')
          || /v2-mcp-shim/.test(sectionName);
      }

      if (!skip) kept.push(line);
    }

    return kept.join('\n').trimEnd();
  };

  const cleaned = stripManagedSections(existing);

  return cleaned ? `${cleaned}\n\n${newBlock}\n` : `${newBlock}\n`;
}

function stripManagedSections(source: string): string {
  const lines = source.split('\n');
  const kept: string[] = [];
  let skip = false;

  for (const line of lines) {
    const sectionMatch = /^\[(.+)\]\s*$/.exec(line.trim());
    if (sectionMatch) {
      const sectionName = sectionMatch[1];
      skip = sectionName === 'mcp_servers.v2-tools'
        || sectionName.startsWith('mcp_servers.v2-tools.')
        || sectionName === 'mcp_servers.local-agent'
        || sectionName.startsWith('mcp_servers.local-agent.')
        || /v2-mcp-shim/.test(sectionName);
    }

    if (!skip) kept.push(line);
  }

  return kept.join('\n').trimEnd();
}

const CODEX_BASELINE_ALLOWLIST = new Set([
  'auth.json',
  'config.json',
  'installation_id',
  'version.json',
]);

function syncCodexBaselinePrereqs(realHomeDir: string, isolatedHomeDir: string): void {
  const realCodexDir = codexConfigDirForHome(realHomeDir);
  const isolatedCodexDir = codexConfigDirForHome(isolatedHomeDir);
  fs.mkdirSync(isolatedCodexDir, { recursive: true });
  if (!fs.existsSync(realCodexDir)) return;

  for (const entry of fs.readdirSync(realCodexDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!CODEX_BASELINE_ALLOWLIST.has(entry.name)) continue;
    const source = path.join(realCodexDir, entry.name);
    const target = path.join(isolatedCodexDir, entry.name);
    fs.copyFileSync(source, target);
  }
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
  private readonly realHomeDir: string;
  private readonly codexHomeDir: string;
  private readonly codexConfigDir: string;
  private readonly codexConfigPath: string;

  constructor(
    private readonly bridgePort: number,
    private readonly shimPath: string,
    private readonly contextPath: string,
    options?: { homeDir?: string; isolatedHomeDir?: string },
  ) {
    super();
    this.realHomeDir = options?.homeDir ?? os.homedir();
    this.codexHomeDir = options?.isolatedHomeDir
      ?? fs.mkdtempSync(path.join(os.tmpdir(), 'goldenboy-codex-home-'));
    this.codexConfigDir = codexConfigDirForHome(this.codexHomeDir);
    this.codexConfigPath = codexConfigPathForHome(this.codexHomeDir);
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
    this.clearConfig();
    try {
      fs.rmSync(this.codexHomeDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }
  }

  private clearConfig(): void {
    try {
      if (!fs.existsSync(this.codexConfigPath)) return;
      const existing = fs.readFileSync(this.codexConfigPath, 'utf-8');
      fs.writeFileSync(this.codexConfigPath, `${stripManagedSections(existing)}\n`, 'utf-8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`AppServerProcess: failed to clear config.toml: ${message}`);
    }
  }

  private writeConfig(): void {
    try {
      syncCodexBaselinePrereqs(this.realHomeDir, this.codexHomeDir);
      if (!fs.existsSync(this.codexConfigDir)) {
        fs.mkdirSync(this.codexConfigDir, { recursive: true });
      }
      const existing = fs.existsSync(this.codexConfigPath)
        ? fs.readFileSync(this.codexConfigPath, 'utf-8')
        : '';
      const merged = mergeTomlMcpEntry(existing, this.shimPath, this.bridgePort, this.contextPath);
      fs.writeFileSync(this.codexConfigPath, merged, 'utf-8');
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
    // MCP server readiness is checked lazily on first thread/turn/start;
    // no separate WS handshake needed here.

    this.state = { status: 'ready', wsPort };
    this.backoffMs = 1_000;
    this.readyResolve?.({ wsPort });
    this.emit('ready', { wsPort });
  }

  private spawnProcess(): Promise<number> {
    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        HOME: this.codexHomeDir,
        USERPROFILE: this.codexHomeDir,
      };
      const child = spawn('codex', ['app-server', '--listen', 'ws://127.0.0.1:0'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
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

      const scanForPort = (data: Buffer): void => {
        const text = data.toString();
        for (const line of text.split('\n')) {
          const port = parseListeningPort(line.trim());
          if (port && !portFound) {
            portFound = true;
            clearTimeout(portTimer);
            resolve(port);
          }
        }
      };

      // codex app-server writes "listening on: ws://..." to stderr (not stdout)
      child.stdout?.on('data', scanForPort);
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
        scanForPort(data);
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
