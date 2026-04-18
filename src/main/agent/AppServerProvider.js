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
exports.AppServerProvider = void 0;
exports.pruneExpiredEntries = pruneExpiredEntries;
exports.loadThreadRegistry = loadThreadRegistry;
exports.saveThreadRegistry = saveThreadRegistry;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const electron_1 = require("electron");
const model_1 = require("../../shared/types/model");
const providerToolRuntime_1 = require("./providerToolRuntime");
const toolBindingScope_1 = require("./toolBindingScope");
// ─── Constants ───────────────────────────────────────────────────────────
const THREAD_FILE = 'codex-threads.json';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TURN_TIMEOUT_MS = 3 * 60 * 1000;
const DEFAULT_CONTEXT_PATH = path.join(os.tmpdir(), 'v2-tool-context.json');
// Use the Node 24 built-in WebSocket global via type cast.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const NativeWebSocket = globalThis.WebSocket;
// ─── Thread Registry Persistence ─────────────────────────────────────────
function getThreadFilePath() {
    try {
        return path.join(electron_1.app.getPath('userData'), THREAD_FILE);
    }
    catch {
        return path.join(os.tmpdir(), THREAD_FILE);
    }
}
function pruneExpiredEntries(entries, now) {
    const result = {};
    for (const [taskId, entry] of Object.entries(entries)) {
        if (now - entry.savedAt <= SEVEN_DAYS_MS) {
            result[taskId] = entry;
        }
    }
    return result;
}
function loadThreadRegistry() {
    try {
        const filePath = getThreadFilePath();
        if (!fs.existsSync(filePath))
            return {};
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return pruneExpiredEntries(typeof parsed === 'object' && parsed ? parsed : {}, Date.now());
    }
    catch {
        return {};
    }
}
function saveThreadRegistry(registry) {
    try {
        fs.writeFileSync(getThreadFilePath(), JSON.stringify(registry, null, 2), 'utf-8');
    }
    catch (err) {
        console.error('AppServerProvider: failed to persist thread registry:', err);
    }
}
// ─── MCP Name Translation ────────────────────────────────────────────────
function fromMcpName(mcpName) {
    return mcpName.replace(/__/g, '.');
}
function toMcpName(toolName) {
    return toolName.replace(/\./g, '__');
}
function shouldEmitThoughtStatus(text) {
    const trimmed = text.trim();
    if (!trimmed)
        return false;
    if (trimmed.endsWith('?'))
        return true;
    const lower = trimmed.toLowerCase();
    if (/(^|\b)(need|needs|choose|confirm|select|pick|provide|enter|paste|upload|share|tell me|let me know|which|what|where|when)(\b|$)/.test(lower)) {
        return true;
    }
    if (/(^|\b)(blocked|cannot|can't|unable|missing|permission|permissions|sign in|login|log in|authenticate|approval required)(\b|$)/.test(lower)) {
        return true;
    }
    return false;
}
// ─── Provider Implementation ─────────────────────────────────────────────
class AppServerProvider {
    options;
    providerId;
    modelId;
    supportsAppToolExecutor = true;
    aborted = false;
    abortCurrentTurn = null;
    ws = null;
    threadRegistry = loadThreadRegistry();
    nextId = 1;
    contextPath;
    constructor(options) {
        this.options = options;
        this.providerId = options.providerId ?? model_1.PRIMARY_PROVIDER_ID;
        this.modelId = options.modelId ?? this.providerId;
        this.contextPath = options.contextPath ?? DEFAULT_CONTEXT_PATH;
    }
    abort() {
        this.aborted = true;
        this.abortCurrentTurn?.();
    }
    async connect(wsPort) {
        return new Promise((resolve, reject) => {
            const ws = new NativeWebSocket(`ws://127.0.0.1:${wsPort}`);
            const initId = this.nextId++;
            const timer = setTimeout(() => {
                ws.removeEventListener('message', messageHandler);
                ws.close();
                reject(new Error('AppServerProvider: initialize handshake timed out'));
            }, 30_000);
            const messageHandler = (event) => {
                try {
                    const msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
                    if (msg.id === initId) {
                        clearTimeout(timer);
                        ws.removeEventListener('message', messageHandler);
                        if (msg.error) {
                            ws.close();
                            reject(new Error(`AppServerProvider: initialize failed: ${msg.error.message}`));
                        }
                        else {
                            this.ws = ws;
                            resolve();
                        }
                    }
                }
                catch {
                    // ignore parse errors during handshake
                }
            };
            ws.addEventListener('message', messageHandler);
            ws.addEventListener('open', () => {
                ws.send(JSON.stringify({
                    jsonrpc: '2.0',
                    id: initId,
                    method: 'initialize',
                    params: {
                        protocolVersion: '2024-11-05',
                        capabilities: { experimentalApi: true },
                        clientInfo: { name: 'v2', version: '1.0' },
                    },
                }));
            });
            ws.addEventListener('error', (event) => {
                clearTimeout(timer);
                ws.removeEventListener('message', messageHandler);
                ws.close();
                reject(new Error(`AppServerProvider: WebSocket error during connect: ${event.type}`));
            });
            ws.addEventListener('close', () => {
                clearTimeout(timer);
                ws.removeEventListener('message', messageHandler);
                if (!this.ws) {
                    reject(new Error('AppServerProvider: WebSocket closed before initialized'));
                }
            });
        });
    }
    async invoke(request) {
        this.aborted = false;
        const startedAt = Date.now();
        let inputTokens = 0;
        let outputTokens = 0;
        const codexItems = [];
        const toolCatalog = request.toolCatalog;
        const toolBindingStore = (0, toolBindingScope_1.createRequestToolBindingStore)(request);
        const maxToolTurns = (0, providerToolRuntime_1.normalizeProviderMaxToolTurns)(request.maxToolTurns ?? providerToolRuntime_1.DEFAULT_PROVIDER_MAX_TOOL_TURNS);
        const ws = this.ws;
        if (!ws)
            throw new Error('AppServerProvider: not connected');
        // Acquire or resume a thread
        const taskId = request.taskId ?? request.runId;
        const threadId = await this.acquireThread(ws, taskId, request.systemPrompt);
        if (this.aborted)
            throw new Error('Task cancelled by user.');
        let accumulatedMessage = '';
        let nextTurnInput = null;
        // Build the first turn's input text — prepend contextPrompt if present (same pattern as HaikuProvider)
        const firstTurnInput = request.contextPrompt?.trim()
            ? `${request.contextPrompt.trim()}\n\n## Current User Request\n\n${request.task}`
            : request.task;
        // Turn loop
        for (let turn = 0; turn < maxToolTurns; turn++) {
            if (this.aborted)
                throw new Error('Task cancelled by user.');
            const callableTools = toolBindingStore.beginTurn();
            const turnInput = nextTurnInput ?? (turn === 0 ? firstTurnInput : accumulatedMessage);
            nextTurnInput = null;
            this.writeContextFile(request, callableTools);
            const turnResult = await this.runOneTurn(ws, {
                threadId,
                task: turnInput,
                request,
                currentTools: callableTools,
                toolCatalog,
            });
            if (this.aborted)
                throw new Error('Task cancelled by user.');
            inputTokens += turnResult.inputTokens;
            outputTokens += turnResult.outputTokens;
            accumulatedMessage = turnResult.message;
            for (const item of turnResult.codexItems) {
                codexItems.push(item);
            }
            // Apply explicit tool pack expansion (from runtime.request_tool_pack)
            if (turnResult.toolPackExpanded && turnResult.expansion) {
                toolBindingStore.queueTools(turnResult.expansion.tools);
            }
            // Check for auto tool pack expansion
            if (turnResult.kind === 'final') {
                const autoExpansion = (0, providerToolRuntime_1.applyAutoExpandedToolPack)({
                    message: turnResult.message,
                    toolCatalog,
                    toolBindingStore,
                });
                if (autoExpansion) {
                    request.onStatus?.(`tool-auto-expand:${autoExpansion.pack}`);
                    nextTurnInput = (0, providerToolRuntime_1.formatAutoExpandedToolPackLines)(autoExpansion, { includeCallableStatus: true }).join('\n');
                    continue;
                }
                // Emit the final output
                const finalItem = (0, providerToolRuntime_1.publishProviderFinalOutput)({
                    request,
                    itemId: `${this.itemPrefix('final')}-${Date.now()}`,
                    text: turnResult.message,
                    emitToken: false,
                });
                codexItems.push(finalItem);
                return {
                    output: finalItem.text,
                    codexItems,
                    usage: {
                        inputTokens,
                        outputTokens,
                        durationMs: Date.now() - startedAt,
                    },
                };
            }
            // kind === 'tool_calls' -> next turn
        }
        // Exhausted tool turns; synthesize final
        const finalItem = (0, providerToolRuntime_1.publishProviderFinalOutput)({
            request,
            itemId: `${this.itemPrefix('final')}-${Date.now()}`,
            text: accumulatedMessage || 'Max tool turns reached without a final answer.',
            emitToken: false,
        });
        codexItems.push(finalItem);
        return {
            output: finalItem.text,
            codexItems,
            usage: {
                inputTokens,
                outputTokens,
                durationMs: Date.now() - startedAt,
            },
        };
    }
    // ─── Private: Thread Management ──────────────────────────────────────────
    async acquireThread(ws, taskId, systemPrompt) {
        const existing = this.threadRegistry[taskId];
        if (existing) {
            try {
                return await this.resumeThread(ws, taskId, existing.threadId, systemPrompt);
            }
            catch {
                // resume failed; delete stale entry and fall through to start new thread
                delete this.threadRegistry[taskId];
                saveThreadRegistry(this.threadRegistry);
            }
        }
        return this.startThread(ws, taskId, systemPrompt);
    }
    startThread(ws, taskId, developerInstructions) {
        const reqId = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                cleanup();
                reject(new Error('AppServerProvider: thread/start timed out'));
            }, TURN_TIMEOUT_MS);
            const handler = (event) => {
                try {
                    const msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
                    if (msg.id !== reqId)
                        return;
                    cleanup();
                    if (msg.error) {
                        reject(new Error(`AppServerProvider: thread/start failed: ${msg.error.message}`));
                        return;
                    }
                    const thread = msg.result?.thread;
                    const threadId = thread?.id;
                    if (!threadId) {
                        reject(new Error('AppServerProvider: thread/start response missing thread.id'));
                        return;
                    }
                    this.threadRegistry[taskId] = { threadId, savedAt: Date.now() };
                    saveThreadRegistry(this.threadRegistry);
                    resolve(threadId);
                }
                catch {
                    // ignore parse errors
                }
            };
            const cleanup = () => {
                clearTimeout(timer);
                ws.removeEventListener('message', handler);
            };
            ws.addEventListener('message', handler);
            ws.send(JSON.stringify({
                jsonrpc: '2.0',
                id: reqId,
                method: 'thread/start',
                params: {
                    developerInstructions,
                    approvalPolicy: 'never',
                    sandboxPolicy: { type: 'dangerFullAccess' },
                    persistFullHistory: true,
                    config: { web_search: 'disabled' },
                },
            }));
        });
    }
    resumeThread(ws, taskId, threadId, developerInstructions) {
        const reqId = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                cleanup();
                reject(new Error('AppServerProvider: thread/resume timed out'));
            }, TURN_TIMEOUT_MS);
            const handler = (event) => {
                try {
                    const msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
                    if (msg.id !== reqId)
                        return;
                    cleanup();
                    // If resume fails, reject so acquireThread falls back to start
                    if (msg.error) {
                        reject(new Error(`thread/resume failed: ${msg.error.message}`));
                        return;
                    }
                    this.threadRegistry[taskId] = { threadId, savedAt: Date.now() };
                    saveThreadRegistry(this.threadRegistry);
                    resolve(threadId);
                }
                catch {
                    // ignore parse errors
                }
            };
            const cleanup = () => {
                clearTimeout(timer);
                ws.removeEventListener('message', handler);
            };
            ws.addEventListener('message', handler);
            ws.send(JSON.stringify({
                jsonrpc: '2.0',
                id: reqId,
                method: 'thread/resume',
                params: {
                    threadId,
                    developerInstructions,
                    approvalPolicy: 'never',
                    sandboxPolicy: { type: 'dangerFullAccess' },
                    persistFullHistory: true,
                    config: { web_search: 'disabled' },
                },
            }));
        });
    }
    // ─── Private: Turn Execution ─────────────────────────────────────────────
    runOneTurn(ws, params) {
        const { threadId, task, request, currentTools, toolCatalog } = params;
        return new Promise((resolve, reject) => {
            let message = '';
            let streamThoughts = false;
            let pendingThoughtText = '';
            let lastInputTokens = 0;
            let lastOutputTokens = 0;
            let toolsCalled = false;
            let toolPackExpanded = false;
            let expansion;
            const turnCodexItems = [];
            let timer = null;
            const resetTimer = () => {
                if (timer)
                    clearTimeout(timer);
                timer = setTimeout(() => {
                    cleanup();
                    reject(new Error('AppServerProvider: turn timed out'));
                }, TURN_TIMEOUT_MS);
            };
            // Wire abort — JSON-RPC notification (no id)
            this.abortCurrentTurn = () => {
                ws.send(JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'turn/interrupt',
                    params: { threadId },
                }));
            };
            const handler = (event) => {
                try {
                    const flushPendingThoughtText = () => {
                        const text = pendingThoughtText.trim();
                        if (!text)
                            return;
                        if (shouldEmitThoughtStatus(text)) {
                            request.onStatus?.(`thought:${text}`);
                        }
                        pendingThoughtText = '';
                    };
                    resetTimer();
                    const raw = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
                    // Codex pushes notifications as { method, params } (no id field)
                    const method = typeof raw.method === 'string' ? raw.method : null;
                    if (!method)
                        return; // skip responses (they have id, not method)
                    const params = (raw.params && typeof raw.params === 'object')
                        ? raw.params
                        : {};
                    switch (method) {
                        case 'item/agentMessage/delta': {
                            const delta = typeof params.delta === 'string' ? params.delta : '';
                            message += delta;
                            if (streamThoughts) {
                                pendingThoughtText += delta;
                                if (/[.!?]\s*$|\n\s*$/.test(pendingThoughtText) || pendingThoughtText.length >= 160) {
                                    flushPendingThoughtText();
                                }
                            }
                            else {
                                request.onToken?.(delta);
                            }
                            break;
                        }
                        case 'item/started': {
                            const item = (params.item && typeof params.item === 'object')
                                ? params.item
                                : null;
                            if (item?.type === 'mcpToolCall') {
                                if (!toolsCalled) {
                                    if (message.trim()) {
                                        request.onStatus?.('thought-migrate');
                                    }
                                    streamThoughts = true;
                                }
                                flushPendingThoughtText();
                                toolsCalled = true;
                                const rawToolName = typeof item.tool === 'string' ? item.tool : '';
                                const toolName = fromMcpName(rawToolName);
                                const toolInput = (item.arguments && typeof item.arguments === 'object')
                                    ? item.arguments
                                    : {};
                                const callDescription = (0, providerToolRuntime_1.describeProviderToolCall)(toolName, toolInput);
                                request.onStatus?.(`tool-start:${callDescription}`);
                                const startedItem = {
                                    id: typeof item.id === 'string' ? item.id : `mcp-${Date.now()}`,
                                    type: 'mcp_tool_call',
                                    server: typeof item.server === 'string' ? item.server : 'v2-tools',
                                    tool: toolName,
                                    arguments: (toolInput && typeof toolInput === 'object')
                                        ? toolInput
                                        : {},
                                    result: null,
                                    error: null,
                                    status: 'in_progress',
                                };
                                request.onItem?.({ item: startedItem, eventType: 'item.started' });
                                turnCodexItems.push(startedItem);
                            }
                            break;
                        }
                        case 'item/completed': {
                            const item = (params.item && typeof params.item === 'object')
                                ? params.item
                                : null;
                            if (item?.type === 'mcpToolCall') {
                                const rawToolName = typeof item.tool === 'string' ? item.tool : '';
                                const toolName = fromMcpName(rawToolName);
                                const toolInput = (item.arguments && typeof item.arguments === 'object')
                                    ? item.arguments
                                    : {};
                                const result = item.result ?? null;
                                const error = item.error
                                    ? { message: typeof item.error.message === 'string' ? item.error.message : String(item.error) }
                                    : null;
                                const callDescription = (0, providerToolRuntime_1.describeProviderToolCall)(toolName, toolInput);
                                const resultSummary = error
                                    ? `error: ${error.message.slice(0, 80)}`
                                    : 'done';
                                request.onStatus?.(`tool-done:${callDescription} -> ${resultSummary}`);
                                const completedItem = {
                                    id: typeof item.id === 'string' ? item.id : `mcp-${Date.now()}`,
                                    type: 'mcp_tool_call',
                                    server: typeof item.server === 'string' ? item.server : 'v2-tools',
                                    tool: toolName,
                                    arguments: (toolInput && typeof toolInput === 'object')
                                        ? toolInput
                                        : {},
                                    result,
                                    error,
                                    status: error ? 'failed' : 'completed',
                                };
                                request.onItem?.({ item: completedItem, eventType: 'item.completed' });
                                turnCodexItems.push(completedItem);
                                // Check for runtime-driven scope expansion (tool search or pack load)
                                if ((toolName === 'runtime.request_tool_pack' || toolName === 'runtime.search_tools') && !error && result) {
                                    const toolResult = {
                                        summary: '',
                                        data: (typeof result === 'object' && result !== null)
                                            ? result
                                            : {},
                                    };
                                    const transientToolBindingStore = toolBindingScope_1.AgentToolBindingStore.fromTools(currentTools, toolCatalog);
                                    const exp = (0, providerToolRuntime_1.applyRuntimeToolExpansion)({
                                        request: { toolCatalog },
                                        toolBindingStore: transientToolBindingStore,
                                        toolName: toolName,
                                        result: toolResult,
                                    });
                                    if (exp) {
                                        toolPackExpanded = true;
                                        expansion = exp;
                                    }
                                }
                            }
                            break;
                        }
                        case 'thread/tokenUsage/updated': {
                            // Each event is a snapshot for the current turn (not a delta).
                            const tokenUsage = (params.tokenUsage && typeof params.tokenUsage === 'object')
                                ? params.tokenUsage
                                : null;
                            const last = (tokenUsage?.last && typeof tokenUsage.last === 'object')
                                ? tokenUsage.last
                                : null;
                            if (last) {
                                lastInputTokens = last.inputTokens ?? 0;
                                lastOutputTokens = last.outputTokens ?? 0;
                            }
                            break;
                        }
                        case 'turn/completed': {
                            flushPendingThoughtText();
                            cleanup();
                            resolve({
                                kind: toolsCalled ? 'tool_calls' : 'final',
                                message,
                                inputTokens: lastInputTokens,
                                outputTokens: lastOutputTokens,
                                toolPackExpanded,
                                expansion,
                                codexItems: turnCodexItems,
                            });
                            break;
                        }
                        case 'turn/failed': {
                            cleanup();
                            const turnData = (params.turn && typeof params.turn === 'object')
                                ? params.turn
                                : null;
                            const errMsg = turnData?.error?.message || 'Turn failed';
                            reject(new Error(`AppServerProvider: turn failed: ${errMsg}`));
                            break;
                        }
                        default:
                            break;
                    }
                }
                catch {
                    // ignore parse errors for individual messages
                }
            };
            const cleanup = () => {
                if (timer)
                    clearTimeout(timer);
                this.abortCurrentTurn = null;
                ws.removeEventListener('message', handler);
            };
            const turnReqId = this.nextId++;
            const input = this.buildTurnStartInput(task, request.attachments);
            ws.addEventListener('message', handler);
            resetTimer();
            ws.send(JSON.stringify({
                jsonrpc: '2.0',
                id: turnReqId,
                method: 'turn/start',
                params: {
                    threadId,
                    input,
                    approvalPolicy: 'never',
                    sandboxPolicy: { type: 'dangerFullAccess' },
                },
            }));
        });
    }
    // ─── Private: Helpers ────────────────────────────────────────────────────
    writeContextFile(request, currentTools) {
        try {
            const toolNames = (currentTools ?? (0, toolBindingScope_1.listCallableRequestTools)(request)).map((t) => t.name);
            fs.writeFileSync(this.contextPath, JSON.stringify({
                runId: request.runId,
                agentId: request.agentId,
                mode: request.mode,
                taskId: request.taskId,
                toolNames,
                toolCatalog: request.toolCatalog,
            }, null, 2), 'utf-8');
        }
        catch {
            // best-effort; the shim will fall back to defaults
        }
    }
    itemPrefix(kind) {
        return `${this.providerId.replace(/[^a-zA-Z0-9]+/g, '-')}-${kind}`;
    }
    buildTurnStartInput(task, attachments) {
        const input = [];
        const text = task.trim();
        if (text) {
            input.push({ type: 'text', text });
        }
        for (const attachment of attachments || []) {
            if (attachment.type !== 'image')
                continue;
            const filePath = attachment.path?.trim();
            if (filePath) {
                input.push({ type: 'local_image', path: filePath });
                continue;
            }
            input.push({
                type: 'input_image',
                image_url: `data:${attachment.mediaType};base64,${attachment.data}`,
            });
        }
        if (input.length === 0) {
            input.push({ type: 'text', text: task });
        }
        return input;
    }
}
exports.AppServerProvider = AppServerProvider;
//# sourceMappingURL=AppServerProvider.js.map