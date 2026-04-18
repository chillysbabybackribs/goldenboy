"use strict";
// ═══════════════════════════════════════════════════════════════════════════
// Terminal Service — Plain PTY, no tmux
// ═══════════════════════════════════════════════════════════════════════════
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.terminalService = exports.TerminalService = void 0;
const os = __importStar(require("os"));
const child_process_1 = require("child_process");
const pty = __importStar(require("node-pty"));
const terminal_1 = require("../../shared/types/terminal");
const oscParser_1 = require("./oscParser");
const shellIntegration_1 = require("./shellIntegration");
const eventBus_1 = require("../events/eventBus");
const appStateStore_1 = require("../state/appStateStore");
const actions_1 = require("../state/actions");
const events_1 = require("../../shared/types/events");
const ids_1 = require("../../shared/utils/ids");
const terminalSessionStore_1 = require("./terminalSessionStore");
const workspaceRoot_1 = require("../workspaceRoot");
function resolveShell() {
    if (process.platform === 'win32') {
        return process.env.COMSPEC || 'cmd.exe';
    }
    return process.env.SHELL || '/bin/bash';
}
function resolveDefaultCwd(persisted) {
    return persisted?.lastCwd || workspaceRoot_1.APP_WORKSPACE_ROOT || process.env.HOME || os.homedir();
}
class TerminalService {
    session = null;
    ptyProcess = null;
    disposed = false;
    commandState = (0, terminal_1.createDefaultCommandState)();
    shellIntegrationEnabled = false;
    shellIntegrationReady = false;
    outputBuffer = [];
    MAX_BUFFER_LINES = 200;
    MAX_COMMAND_OUTPUT = 65536; // 64KB cap on per-command output
    commandFinishResolvers = [];
    shellReadyResolvers = [];
    commandExecutionChain = Promise.resolve();
    lastCommandDispatchAt = null;
    getSession() {
        return this.session;
    }
    init() {
        this.emitLog('info', 'Terminal service ready');
    }
    startSession(cols, rows) {
        if (this.session && this.session.status === 'running' && this.ptyProcess) {
            return this.session;
        }
        this.cleanupPty();
        const shell = resolveShell();
        const persisted = (0, terminalSessionStore_1.loadTerminalData)();
        const cwd = resolveDefaultCwd(persisted);
        const c = (cols && cols > 0) ? cols : 80;
        const r = (rows && rows > 0) ? rows : 24;
        const id = (0, ids_1.generateId)('term');
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
            restored: false,
        };
        this.updateState();
        eventBus_1.eventBus.emit(events_1.AppEventType.TERMINAL_SESSION_CREATED, { session: { ...this.session } });
        try {
            this.ptyProcess = pty.spawn(shell, [], {
                name: 'xterm-256color',
                cols: c,
                rows: r,
                cwd,
                env: { ...process.env },
            });
            this.session.pid = this.ptyProcess.pid;
            this.session.status = 'running';
            this.updateState();
            this.emitStatus();
            eventBus_1.eventBus.emit(events_1.AppEventType.TERMINAL_SESSION_STARTED, { session: { ...this.session } });
            this.emitLog('info', `Terminal started: ${shell} (PID ${this.ptyProcess.pid})`);
            this.wirePtyEvents();
            // Inject shell integration for structured command tracking
            const integrationScript = (0, shellIntegration_1.getShellIntegrationScript)(shell);
            if (integrationScript) {
                this.shellIntegrationEnabled = true;
                this.shellIntegrationReady = false;
                this.ptyProcess.write(integrationScript + '\n');
                this.commandState = (0, terminal_1.createDefaultCommandState)(cwd);
                this.emitLog('info', 'Shell integration injected (OSC 633)');
            }
            else {
                this.shellIntegrationEnabled = false;
                this.shellIntegrationReady = true;
                this.commandState = (0, terminal_1.createDefaultCommandState)(cwd);
                this.emitLog('info', 'Shell integration unavailable for this shell — using fallback');
            }
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.session.status = 'error';
            this.updateState();
            this.emitStatus();
            eventBus_1.eventBus.emit(events_1.AppEventType.TERMINAL_SESSION_ERROR, {
                sessionId: this.session.id,
                error: message,
            });
            this.emitLog('error', `Terminal spawn failed: ${message}`);
        }
        return { ...this.session };
    }
    write(data) {
        if (!this.ptyProcess || !this.session || this.session.status !== 'running')
            return;
        this.ptyProcess.write(data);
    }
    dispatchCommand(command) {
        this.lastCommandDispatchAt = Date.now();
        this.write(`${command}\n`);
    }
    getRecentOutput(lineCount = 50) {
        const count = Math.min(Math.max(1, lineCount), this.MAX_BUFFER_LINES);
        return this.outputBuffer.slice(-count).join('\n');
    }
    getCommandState() {
        return { ...this.commandState };
    }
    getCwd() {
        return this.commandState.cwd || this.session?.cwd || '';
    }
    isBusy(graceMs = 1500) {
        if (this.commandState.phase === 'executing')
            return true;
        if (this.lastCommandDispatchAt === null)
            return false;
        return (Date.now() - this.lastCommandDispatchAt) <= graceMs;
    }
    waitForCommandFinish(timeoutMs = 10_000) {
        // Always wait for the next prompt-started event — never resolve with stale data.
        // The caller writes a command to PTY before calling this, and the OSC 633;C marker
        // may not have arrived yet. Resolving immediately with a previous command's result
        // would be a race condition.
        return new Promise((resolve) => {
            let settled = false;
            const wrappedResolve = (result) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                const idx = this.commandFinishResolvers.indexOf(wrappedResolve);
                if (idx !== -1)
                    this.commandFinishResolvers.splice(idx, 1);
                resolve(result);
            };
            const timer = setTimeout(() => {
                if (settled)
                    return;
                settled = true;
                const idx = this.commandFinishResolvers.indexOf(wrappedResolve);
                if (idx !== -1)
                    this.commandFinishResolvers.splice(idx, 1);
                resolve(null);
            }, timeoutMs);
            this.commandFinishResolvers.push(wrappedResolve);
        });
    }
    waitForShellReady(timeoutMs = 2_000) {
        if (!this.shellIntegrationEnabled || this.shellIntegrationReady) {
            return Promise.resolve(true);
        }
        return new Promise((resolve) => {
            let settled = false;
            const wrappedResolve = (ready) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                const idx = this.shellReadyResolvers.indexOf(wrappedResolve);
                if (idx !== -1)
                    this.shellReadyResolvers.splice(idx, 1);
                resolve(ready);
            };
            const timer = setTimeout(() => {
                if (settled)
                    return;
                settled = true;
                const idx = this.shellReadyResolvers.indexOf(wrappedResolve);
                if (idx !== -1)
                    this.shellReadyResolvers.splice(idx, 1);
                resolve(false);
            }, timeoutMs);
            this.shellReadyResolvers.push(wrappedResolve);
        });
    }
    async executeCommand(command, timeoutMs = 10_000) {
        return this.enqueueExclusiveCommand(async () => {
            await this.waitForShellReady(Math.min(timeoutMs, 2_000));
            const resultPromise = this.waitForCommandFinish(timeoutMs);
            this.dispatchCommand(command);
            return resultPromise;
        });
    }
    async executeCommandIsolated(command, options = {}) {
        const cwd = this.resolveCommandCwd(options.cwd);
        const timeoutMs = Math.max(1, options.timeoutMs ?? 10_000);
        const shell = resolveShell();
        return new Promise((resolve, reject) => {
            const startedAt = Date.now();
            let output = '';
            let timedOut = false;
            let settled = false;
            let forceKillTimer = null;
            const child = (0, child_process_1.spawn)(command, {
                cwd,
                env: { ...process.env },
                shell,
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
            });
            const appendOutput = (chunk) => {
                output += chunk.toString();
                if (output.length > this.MAX_COMMAND_OUTPUT) {
                    output = output.slice(-this.MAX_COMMAND_OUTPUT);
                }
            };
            const finish = (exitCode) => {
                if (settled)
                    return;
                settled = true;
                if (timeoutTimer)
                    clearTimeout(timeoutTimer);
                if (forceKillTimer)
                    clearTimeout(forceKillTimer);
                resolve({
                    command,
                    cwd,
                    durationMs: Date.now() - startedAt,
                    exitCode: timedOut ? null : exitCode,
                    output,
                    timedOut,
                });
            };
            child.stdout?.on('data', appendOutput);
            child.stderr?.on('data', appendOutput);
            child.on('error', (error) => {
                if (settled)
                    return;
                settled = true;
                if (timeoutTimer)
                    clearTimeout(timeoutTimer);
                if (forceKillTimer)
                    clearTimeout(forceKillTimer);
                reject(error);
            });
            child.on('close', (exitCode) => finish(exitCode));
            const timeoutTimer = setTimeout(() => {
                timedOut = true;
                child.kill('SIGTERM');
                forceKillTimer = setTimeout(() => {
                    child.kill('SIGKILL');
                }, 1_000);
            }, timeoutMs);
        });
    }
    resize(cols, rows) {
        if (!this.ptyProcess || !this.session || this.session.status !== 'running')
            return;
        if (cols < 1 || rows < 1)
            return;
        this.ptyProcess.resize(cols, rows);
        this.session.cols = cols;
        this.session.rows = rows;
        this.updateState();
        eventBus_1.eventBus.emit(events_1.AppEventType.TERMINAL_SESSION_RESIZED, {
            sessionId: this.session.id,
            cols,
            rows,
        });
    }
    restart() {
        this.outputBuffer = [];
        this.commandFinishResolvers = [];
        const oldSessionId = this.session?.id || 'none';
        const lastCols = this.session?.cols;
        const lastRows = this.session?.rows;
        this.cleanupPty();
        const session = this.startSession(lastCols, lastRows);
        eventBus_1.eventBus.emit(events_1.AppEventType.TERMINAL_SESSION_RESTARTED, {
            oldSessionId,
            session: { ...session },
        });
        this.emitLog('info', 'Terminal session restarted');
        return session;
    }
    setAppQuitting() {
        // no-op
    }
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.persistNow();
        this.cleanupPty();
        if (this.session) {
            this.session.status = 'exited';
            this.updateState();
        }
    }
    persistNow() {
        (0, terminalSessionStore_1.saveTerminalData)({
            lastCwd: this.session?.cwd || null,
            shell: this.session?.shell || resolveShell(),
        });
    }
    // ─── Private ──────────────────────────────────────────────────────────────
    wirePtyEvents() {
        if (!this.ptyProcess || !this.session)
            return;
        const sessionId = this.session.id;
        this.ptyProcess.onData((data) => {
            if (!this.session)
                return;
            this.session.lastActivityAt = Date.now();
            // Parse OSC 633 sequences — extract markers, clean output for renderer
            const { cleaned, parts } = (0, oscParser_1.parseOscSequences)(data);
            for (const part of parts) {
                if (part.type === 'event') {
                    this.handleOscEvent(part.event);
                    continue;
                }
                if (part.value.length === 0)
                    continue;
                const stripped = (0, oscParser_1.stripAnsi)(part.value);
                const lines = stripped.split('\n');
                this.outputBuffer.push(...lines);
                if (this.outputBuffer.length > this.MAX_BUFFER_LINES) {
                    this.outputBuffer = this.outputBuffer.slice(-this.MAX_BUFFER_LINES);
                }
                if (this.commandState.phase === 'executing') {
                    this.commandState.outputSinceCommandStart += stripped;
                    if (this.commandState.outputSinceCommandStart.length > this.MAX_COMMAND_OUTPUT) {
                        this.commandState.outputSinceCommandStart =
                            this.commandState.outputSinceCommandStart.slice(-this.MAX_COMMAND_OUTPUT);
                    }
                }
            }
            // Forward cleaned data to renderer (OSC 633 stripped, all else preserved)
            eventBus_1.eventBus.emit(events_1.AppEventType.TERMINAL_SESSION_OUTPUT, { sessionId, data: cleaned || data });
        });
        this.ptyProcess.onExit(({ exitCode }) => {
            if (!this.session)
                return;
            this.session.status = 'exited';
            this.session.exitCode = exitCode;
            this.ptyProcess = null;
            this.resolveShellReady(false);
            this.updateState();
            this.emitStatus();
            eventBus_1.eventBus.emit(events_1.AppEventType.TERMINAL_SESSION_EXITED, { sessionId, exitCode });
            this.emitLog('info', `Terminal exited with code ${exitCode}`);
        });
    }
    resolveCommandCwd(preferredCwd) {
        if (preferredCwd && preferredCwd.trim())
            return preferredCwd;
        if (this.commandState.cwd.trim())
            return this.commandState.cwd;
        if (this.session?.cwd?.trim())
            return this.session.cwd;
        return resolveDefaultCwd((0, terminalSessionStore_1.loadTerminalData)());
    }
    cleanupPty() {
        if (this.ptyProcess) {
            try {
                this.ptyProcess.kill();
            }
            catch { }
            this.ptyProcess = null;
        }
        this.resolveShellReady(false);
        this.shellIntegrationEnabled = false;
        this.shellIntegrationReady = false;
        this.lastCommandDispatchAt = null;
        if (this.session) {
            this.session.status = 'exited';
        }
    }
    enqueueExclusiveCommand(work) {
        const run = this.commandExecutionChain
            .catch(() => undefined)
            .then(work);
        this.commandExecutionChain = run.then(() => undefined, () => undefined);
        return run;
    }
    updateState() {
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.SET_TERMINAL_SESSION,
            session: this.session ? { ...this.session } : null,
        });
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.SET_SURFACE_STATUS,
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
    mapToSurfaceStatus() {
        if (!this.session)
            return 'idle';
        switch (this.session.status) {
            case 'idle':
            case 'starting': return 'idle';
            case 'running': return 'running';
            case 'exited': return 'done';
            case 'error': return 'error';
            default: return 'idle';
        }
    }
    emitStatus() {
        if (!this.session)
            return;
        eventBus_1.eventBus.emit(events_1.AppEventType.TERMINAL_STATUS_UPDATED, {
            sessionId: this.session.id,
            status: this.session.status,
        });
    }
    emitLog(level, message) {
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.ADD_LOG,
            log: {
                id: (0, ids_1.generateId)('log'),
                timestamp: Date.now(),
                level,
                source: 'terminal',
                message,
            },
        });
    }
    handleOscEvent(event) {
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
                if (this.shellIntegrationEnabled && !this.shellIntegrationReady) {
                    this.shellIntegrationReady = true;
                    this.resolveShellReady(true);
                    this.emitLog('info', 'Shell integration ready');
                }
                if (this.commandState.phase === 'executing') {
                    const result = {
                        exitCode: this.commandState.lastExitCode ?? 0,
                        output: this.commandState.outputSinceCommandStart,
                        cwd: this.commandState.cwd,
                        durationMs: this.commandState.startedAt
                            ? Date.now() - this.commandState.startedAt
                            : 0,
                        command: '',
                    };
                    this.commandState.phase = 'idle';
                    this.lastCommandDispatchAt = null;
                    // Emit event
                    if (this.session) {
                        eventBus_1.eventBus.emit(events_1.AppEventType.TERMINAL_COMMAND_FINISHED, {
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
    resolveCommandFinish(result) {
        const resolvers = this.commandFinishResolvers.splice(0);
        for (const resolve of resolvers) {
            resolve(result);
        }
    }
    resolveShellReady(ready) {
        const resolvers = this.shellReadyResolvers.splice(0);
        for (const resolve of resolvers) {
            resolve(ready);
        }
    }
}
exports.TerminalService = TerminalService;
exports.terminalService = new TerminalService();
//# sourceMappingURL=TerminalService.js.map