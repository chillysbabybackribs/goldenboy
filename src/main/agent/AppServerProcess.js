"use strict";
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
exports.AppServerProcess = void 0;
exports.parseListeningPort = parseListeningPort;
exports.mergeTomlMcpEntry = mergeTomlMcpEntry;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const http = __importStar(require("http"));
const events_1 = require("events");
const CODEX_CONFIG_DIR = path.join(os.homedir(), '.codex');
const CODEX_CONFIG_PATH = path.join(CODEX_CONFIG_DIR, 'config.toml');
const READYZ_TIMEOUT_MS = 30_000;
const READYZ_POLL_INTERVAL_MS = 200;
const MAX_BACKOFF_MS = 30_000;
function parseListeningPort(line) {
    const match = /listening on: ws:\/\/127\.0\.0\.1:(\d+)/.exec(line);
    return match ? Number(match[1]) : null;
}
function mergeTomlMcpEntry(existing, shimPath, bridgePort, contextPath) {
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
    const stripManagedSections = (source) => {
        const lines = source.split('\n');
        const kept = [];
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
            if (!skip)
                kept.push(line);
        }
        return kept.join('\n').trimEnd();
    };
    const cleaned = stripManagedSections(existing);
    return cleaned ? `${cleaned}\n\n${newBlock}\n` : `${newBlock}\n`;
}
class AppServerProcess extends events_1.EventEmitter {
    bridgePort;
    shimPath;
    contextPath;
    state = { status: 'stopped' };
    child = null;
    wsPort = 0;
    backoffMs = 1_000;
    stopped = false;
    readyPromise = null;
    readyResolve = null;
    readyReject = null;
    cleanupHandlersInstalled = false;
    processExitHandler = () => {
        this.stop();
    };
    constructor(bridgePort, shimPath, contextPath) {
        super();
        this.bridgePort = bridgePort;
        this.shimPath = shimPath;
        this.contextPath = contextPath;
    }
    isReady() {
        return this.state.status === 'ready';
    }
    async waitUntilReady() {
        if (this.state.status === 'ready')
            return { wsPort: this.wsPort };
        if (!this.readyPromise) {
            this.readyPromise = new Promise((resolve, reject) => {
                this.readyResolve = resolve;
                this.readyReject = reject;
            });
        }
        return this.readyPromise;
    }
    async start() {
        this.stopped = false;
        this.installCleanupHandlers();
        this.writeConfig();
        try {
            await this.spawnAndWait();
        }
        catch (err) {
            this.readyReject?.(err instanceof Error ? err : new Error(String(err)));
            throw err;
        }
    }
    stop() {
        this.stopped = true;
        this.killChildProcessTree();
        this.child = null;
        this.state = { status: 'stopped' };
        this.clearConfig();
        this.removeCleanupHandlers();
    }
    clearConfig() {
        try {
            if (!fs.existsSync(CODEX_CONFIG_PATH))
                return;
            const existing = fs.readFileSync(CODEX_CONFIG_PATH, 'utf-8');
            // Re-use the same strip logic from mergeTomlMcpEntry but write without appending a new block.
            const lines = existing.split('\n');
            const kept = [];
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
                if (!skip)
                    kept.push(line);
            }
            fs.writeFileSync(CODEX_CONFIG_PATH, kept.join('\n').trimEnd() + '\n', 'utf-8');
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`AppServerProcess: failed to clear config.toml: ${message}`);
        }
    }
    writeConfig() {
        try {
            if (!fs.existsSync(CODEX_CONFIG_DIR)) {
                fs.mkdirSync(CODEX_CONFIG_DIR, { recursive: true });
            }
            const existing = fs.existsSync(CODEX_CONFIG_PATH)
                ? fs.readFileSync(CODEX_CONFIG_PATH, 'utf-8')
                : '';
            const merged = mergeTomlMcpEntry(existing, this.shimPath, this.bridgePort, this.contextPath);
            fs.writeFileSync(CODEX_CONFIG_PATH, merged, 'utf-8');
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`AppServerProcess: failed to write config.toml: ${message}`);
        }
    }
    async spawnAndWait() {
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
    spawnProcess() {
        return new Promise((resolve, reject) => {
            const child = (0, child_process_1.spawn)('codex', ['app-server', '--listen', 'ws://127.0.0.1:0'], {
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: process.platform !== 'win32',
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
            const scanForPort = (data) => {
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
            child.stderr?.on('data', (data) => {
                stderr += data.toString();
                scanForPort(data);
            });
            child.on('error', (err) => {
                if (!portFound)
                    reject(err);
                else
                    this.handleCrash(`process error: ${err.message}`);
            });
            child.on('close', (code) => {
                if (!portFound) {
                    reject(new Error(`codex app-server exited early (${code}): ${stderr.trim().slice(0, 200)}`));
                }
                else {
                    this.handleCrash(`process exited with code ${code}`);
                }
            });
        });
    }
    pollReadyz(wsPort) {
        return new Promise((resolve, reject) => {
            const deadline = Date.now() + READYZ_TIMEOUT_MS;
            const poll = () => {
                if (Date.now() > deadline) {
                    reject(new Error('codex app-server /readyz did not return 200 within 30s'));
                    return;
                }
                const req = http.get(`http://127.0.0.1:${wsPort}/readyz`, (res) => {
                    if (res.statusCode === 200) {
                        resolve();
                        return;
                    }
                    setTimeout(poll, READYZ_POLL_INTERVAL_MS);
                });
                req.on('error', () => setTimeout(poll, READYZ_POLL_INTERVAL_MS));
                req.end();
            };
            poll();
        });
    }
    handleCrash(reason) {
        if (this.stopped)
            return;
        console.error(`AppServerProcess: crashed (${reason}); restarting in ${this.backoffMs}ms`);
        this.state = { status: 'error', error: reason };
        this.emit('crash', { reason });
        setTimeout(() => {
            if (this.stopped)
                return;
            this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
            this.writeConfig();
            void this.spawnAndWait().catch((err) => {
                console.error(`AppServerProcess: restart failed: ${err instanceof Error ? err.message : String(err)}`);
                this.readyReject?.(err instanceof Error ? err : new Error(String(err)));
                this.handleCrash('restart failed');
            });
        }, this.backoffMs);
    }
    killChildProcessTree() {
        const child = this.child;
        if (!child)
            return;
        try {
            if (process.platform !== 'win32' && typeof child.pid === 'number') {
                process.kill(-child.pid, 'SIGTERM');
                return;
            }
        }
        catch {
            // Fall through to direct-child termination.
        }
        try {
            child.kill('SIGTERM');
        }
        catch {
            // Best-effort cleanup.
        }
    }
    installCleanupHandlers() {
        if (this.cleanupHandlersInstalled)
            return;
        this.cleanupHandlersInstalled = true;
        process.once('exit', this.processExitHandler);
        process.once('SIGINT', this.processExitHandler);
        process.once('SIGTERM', this.processExitHandler);
    }
    removeCleanupHandlers() {
        if (!this.cleanupHandlersInstalled)
            return;
        this.cleanupHandlersInstalled = false;
        process.removeListener('exit', this.processExitHandler);
        process.removeListener('SIGINT', this.processExitHandler);
        process.removeListener('SIGTERM', this.processExitHandler);
    }
}
exports.AppServerProcess = AppServerProcess;
//# sourceMappingURL=AppServerProcess.js.map