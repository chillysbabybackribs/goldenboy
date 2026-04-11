// ═══════════════════════════════════════════════════════════════════════════
// Terminal Service — Plain PTY, no tmux
// ═══════════════════════════════════════════════════════════════════════════

import * as os from 'os';
import * as pty from 'node-pty';
import { TerminalSessionInfo, TerminalSessionStatus, CommandState, CommandFinishResult, createDefaultCommandState } from '../../shared/types/terminal';
import { parseOscSequences, stripAnsi, type OscEvent } from './oscParser';
import { getShellIntegrationScript } from './shellIntegration';
import { eventBus } from '../events/eventBus';
import { appStateStore } from '../state/appStateStore';
import { ActionType } from '../state/actions';
import { AppEventType } from '../../shared/types/events';
import { generateId } from '../../shared/utils/ids';
import { loadTerminalData, saveTerminalData, PersistedTerminalData } from './terminalSessionStore';

function resolveShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

export class TerminalService {
  private session: TerminalSessionInfo | null = null;
  private ptyProcess: pty.IPty | null = null;
  private disposed = false;
  private commandState: CommandState = createDefaultCommandState();
  private outputBuffer: string[] = [];
  private readonly MAX_BUFFER_LINES = 200;
  private readonly MAX_COMMAND_OUTPUT = 65536; // 64KB cap on per-command output
  private commandFinishResolvers: Array<(result: CommandFinishResult) => void> = [];

  getSession(): TerminalSessionInfo | null {
    return this.session;
  }

  init(): void {
    this.emitLog('info', 'Terminal service ready');
  }

  startSession(cols?: number, rows?: number): TerminalSessionInfo {
    if (this.session && this.session.status === 'running' && this.ptyProcess) {
      return this.session;
    }

    this.cleanupPty();

    const shell = resolveShell();
    const persisted = loadTerminalData();
    const cwd = persisted.lastCwd || process.env.HOME || os.homedir();
    const c = (cols && cols > 0) ? cols : 80;
    const r = (rows && rows > 0) ? rows : 24;
    const id = generateId('term');

    this.session = {
      id,
      pid: null,
      shell,
      cwd,
      startedAt: Date.now(),
      lastActivityAt: null,
      status: 'starting',
      exitCode: null,
      cols: c,
      rows: r,
      persistent: false,
      tmuxSession: null,
      restored: false,
    };

    this.updateState();
    eventBus.emit(AppEventType.TERMINAL_SESSION_CREATED, { session: { ...this.session } });

    try {
      this.ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: c,
        rows: r,
        cwd,
        env: { ...process.env } as Record<string, string>,
      });

      this.session.pid = this.ptyProcess.pid;
      this.session.status = 'running';
      this.updateState();
      this.emitStatus();

      eventBus.emit(AppEventType.TERMINAL_SESSION_STARTED, { session: { ...this.session } });
      this.emitLog('info', `Terminal started: ${shell} (PID ${this.ptyProcess.pid})`);

      this.wirePtyEvents();

      // Inject shell integration for structured command tracking
      const integrationScript = getShellIntegrationScript(shell);
      if (integrationScript) {
        this.ptyProcess!.write(integrationScript + '\n');
        this.commandState = createDefaultCommandState(cwd);
        this.emitLog('info', 'Shell integration injected (OSC 633)');
      } else {
        this.commandState = createDefaultCommandState(cwd);
        this.emitLog('info', 'Shell integration unavailable for this shell — using fallback');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.session.status = 'error';
      this.updateState();
      this.emitStatus();
      eventBus.emit(AppEventType.TERMINAL_SESSION_ERROR, {
        sessionId: this.session.id,
        error: message,
      });
      this.emitLog('error', `Terminal spawn failed: ${message}`);
    }

    return { ...this.session };
  }

  captureScrollback(): string {
    return '';
  }

  write(data: string): void {
    if (!this.ptyProcess || !this.session || this.session.status !== 'running') return;
    this.ptyProcess.write(data);
  }

  getRecentOutput(lineCount: number = 50): string {
    const count = Math.min(Math.max(1, lineCount), this.MAX_BUFFER_LINES);
    return this.outputBuffer.slice(-count).join('\n');
  }

  getCommandState(): CommandState {
    return { ...this.commandState };
  }

  getCwd(): string {
    return this.commandState.cwd || this.session?.cwd || '';
  }

  waitForCommandFinish(timeoutMs: number = 10_000): Promise<CommandFinishResult | null> {
    // Always wait for the next prompt-started event — never resolve with stale data.
    // The caller writes a command to PTY before calling this, and the OSC 633;C marker
    // may not have arrived yet. Resolving immediately with a previous command's result
    // would be a race condition.

    return new Promise<CommandFinishResult | null>((resolve) => {
      let settled = false;

      const wrappedResolve = (result: CommandFinishResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const idx = this.commandFinishResolvers.indexOf(wrappedResolve);
        if (idx !== -1) this.commandFinishResolvers.splice(idx, 1);
        resolve(result);
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const idx = this.commandFinishResolvers.indexOf(wrappedResolve);
        if (idx !== -1) this.commandFinishResolvers.splice(idx, 1);
        resolve(null);
      }, timeoutMs);

      this.commandFinishResolvers.push(wrappedResolve);
    });
  }

  resize(cols: number, rows: number): void {
    if (!this.ptyProcess || !this.session || this.session.status !== 'running') return;
    if (cols < 1 || rows < 1) return;

    this.ptyProcess.resize(cols, rows);
    this.session.cols = cols;
    this.session.rows = rows;
    this.updateState();
    eventBus.emit(AppEventType.TERMINAL_SESSION_RESIZED, {
      sessionId: this.session.id,
      cols,
      rows,
    });
  }

  restart(): TerminalSessionInfo {
    this.outputBuffer = [];
    this.commandFinishResolvers = [];
    const oldSessionId = this.session?.id || 'none';
    const lastCols = this.session?.cols;
    const lastRows = this.session?.rows;

    this.cleanupPty();

    const session = this.startSession(lastCols, lastRows);

    eventBus.emit(AppEventType.TERMINAL_SESSION_RESTARTED, {
      oldSessionId,
      session: { ...session },
    });
    this.emitLog('info', 'Terminal session restarted');

    return session;
  }

  setAppQuitting(): void {
    // no-op
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.persistNow();
    this.cleanupPty();
    if (this.session) {
      this.session.status = 'exited';
      this.updateState();
    }
  }

  isPersistent(): boolean {
    return false;
  }

  persistNow(): void {
    saveTerminalData({
      tmuxSession: null,
      lastCwd: this.session?.cwd || null,
      shell: this.session?.shell || resolveShell(),
      persistent: false,
    });
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private wirePtyEvents(): void {
    if (!this.ptyProcess || !this.session) return;
    const sessionId = this.session.id;

    this.ptyProcess.onData((data: string) => {
      if (!this.session) return;
      this.session.lastActivityAt = Date.now();

      // Parse OSC 633 sequences — extract markers, clean output for renderer
      const { cleaned, events } = parseOscSequences(data);

      // Process shell integration events
      for (const event of events) {
        this.handleOscEvent(event);
      }

      // Append ANSI-stripped lines to ring buffer
      if (cleaned.length > 0) {
        const stripped = stripAnsi(cleaned);
        const lines = stripped.split('\n');
        this.outputBuffer.push(...lines);
        if (this.outputBuffer.length > this.MAX_BUFFER_LINES) {
          this.outputBuffer = this.outputBuffer.slice(-this.MAX_BUFFER_LINES);
        }

        // Accumulate output for current command
        if (this.commandState.phase === 'executing') {
          this.commandState.outputSinceCommandStart += stripped;
          if (this.commandState.outputSinceCommandStart.length > this.MAX_COMMAND_OUTPUT) {
            this.commandState.outputSinceCommandStart =
              this.commandState.outputSinceCommandStart.slice(-this.MAX_COMMAND_OUTPUT);
          }
        }
      }

      // Forward cleaned data to renderer (OSC 633 stripped, all else preserved)
      eventBus.emit(AppEventType.TERMINAL_SESSION_OUTPUT, { sessionId, data: cleaned || data });
    });

    this.ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      if (!this.session) return;
      this.session.status = 'exited';
      this.session.exitCode = exitCode;
      this.ptyProcess = null;
      this.updateState();
      this.emitStatus();
      eventBus.emit(AppEventType.TERMINAL_SESSION_EXITED, { sessionId, exitCode });
      this.emitLog('info', `Terminal exited with code ${exitCode}`);
    });
  }

  private cleanupPty(): void {
    if (this.ptyProcess) {
      try { this.ptyProcess.kill(); } catch {}
      this.ptyProcess = null;
    }
    if (this.session) {
      this.session.status = 'exited';
    }
  }

  private updateState(): void {
    appStateStore.dispatch({
      type: ActionType.SET_TERMINAL_SESSION,
      session: this.session ? { ...this.session } : null,
    });

    appStateStore.dispatch({
      type: ActionType.SET_SURFACE_STATUS,
      surface: 'terminal',
      status: {
        status: this.mapToSurfaceStatus(),
        lastUpdatedAt: Date.now(),
        detail: this.session
          ? `${this.session.shell} (PID ${this.session.pid || '?'})`
          : '',
      },
    });
  }

  private mapToSurfaceStatus(): 'idle' | 'running' | 'done' | 'error' {
    if (!this.session) return 'idle';
    switch (this.session.status) {
      case 'idle':
      case 'starting': return 'idle';
      case 'running': return 'running';
      case 'exited': return 'done';
      case 'error': return 'error';
      default: return 'idle';
    }
  }

  private emitStatus(): void {
    if (!this.session) return;
    eventBus.emit(AppEventType.TERMINAL_STATUS_UPDATED, {
      sessionId: this.session.id,
      status: this.session.status,
    });
  }

  private emitLog(level: 'info' | 'warn' | 'error', message: string): void {
    appStateStore.dispatch({
      type: ActionType.ADD_LOG,
      log: {
        id: generateId('log'),
        timestamp: Date.now(),
        level,
        source: 'terminal',
        message,
      },
    });
  }

  private handleOscEvent(event: OscEvent): void {
    switch (event.type) {
      case 'command-started':
        this.commandState.phase = 'executing';
        this.commandState.startedAt = Date.now();
        this.commandState.outputSinceCommandStart = '';
        break;

      case 'exit-code':
        this.commandState.lastExitCode = event.code;
        break;

      case 'cwd':
        this.commandState.cwd = event.path;
        if (this.session) {
          this.session.cwd = event.path;
          this.updateState();
        }
        break;

      case 'prompt-started': {
        if (this.commandState.phase === 'executing') {
          const result: CommandFinishResult = {
            exitCode: this.commandState.lastExitCode ?? 0,
            output: this.commandState.outputSinceCommandStart,
            cwd: this.commandState.cwd,
            durationMs: this.commandState.startedAt
              ? Date.now() - this.commandState.startedAt
              : 0,
            command: '',
          };

          this.commandState.phase = 'idle';

          // Emit event
          if (this.session) {
            eventBus.emit(AppEventType.TERMINAL_COMMAND_FINISHED, {
              sessionId: this.session.id,
              ...result,
            });
          }

          // Resolve any waiters
          this.resolveCommandFinish(result);
        }
        break;
      }
    }
  }

  private resolveCommandFinish(result: CommandFinishResult): void {
    const resolvers = this.commandFinishResolvers.splice(0);
    for (const resolve of resolvers) {
      resolve(result);
    }
  }
}

export const terminalService = new TerminalService();
