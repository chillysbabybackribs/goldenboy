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
exports.CodexProvider = void 0;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const model_1 = require("../../shared/types/model");
const providerToolRuntime_1 = require("./providerToolRuntime");
const toolBindingScope_1 = require("./toolBindingScope");
const CODEX_INACTIVITY_TIMEOUT_MS = 180_000;
const CODEX_WEB_SEARCH_DISABLED_CONFIG = 'web_search="disabled"';
const MAX_TOOL_DESCRIPTION_CHARS = 160;
const MAX_TOOL_SCHEMA_CHARS = 600;
const MAX_PROMPT_HISTORY_ENTRIES = 12;
const MAX_PROMPT_HISTORY_CHARS = 12_000;
function firstNonEmptyLine(value) {
    for (const line of value.split('\n')) {
        const trimmed = line.trim();
        if (trimmed)
            return trimmed;
    }
    return null;
}
function compactPromptText(text, maxChars, suffix) {
    const trimmed = text.trim();
    if (trimmed.length <= maxChars)
        return trimmed;
    const limit = Math.max(0, maxChars - suffix.length);
    return `${trimmed.slice(0, limit)}${suffix}`;
}
function compactSchema(schema) {
    return compactPromptText(JSON.stringify(schema), MAX_TOOL_SCHEMA_CHARS, '...[schema truncated]');
}
function buildToolRegistryText(tools) {
    if (tools.length === 0)
        return 'No tools are available in this runtime.';
    return tools.map((tool) => [
        `- ${tool.name}`,
        `  Description: ${compactPromptText(tool.description, MAX_TOOL_DESCRIPTION_CHARS, '...')}`,
        `  Input schema: ${compactSchema(tool.inputSchema)}`,
    ].join('\n')).join('\n\n');
}
function buildTranscriptHistory(transcript) {
    if (transcript.length === 0)
        return 'No prior tool calls yet.';
    const recent = transcript.slice(-MAX_PROMPT_HISTORY_ENTRIES);
    const selected = [];
    let usedChars = 0;
    for (let index = recent.length - 1; index >= 0; index -= 1) {
        const entry = recent[index];
        const nextSize = entry.content.length + (selected.length > 0 ? 2 : 0);
        if (selected.length > 0 && usedChars + nextSize > MAX_PROMPT_HISTORY_CHARS)
            break;
        selected.unshift(entry);
        usedChars += nextSize;
    }
    const omittedCount = transcript.length - selected.length;
    const sections = [];
    if (omittedCount > 0) {
        sections.push(`Earlier history omitted to control prompt size (${omittedCount} older steps skipped).`);
    }
    sections.push(selected.map((entry, index) => [
        `### Step ${omittedCount + index + 1} (${entry.type})`,
        compactPromptText(entry.content, MAX_PROMPT_HISTORY_CHARS, '\n...[step truncated]'),
    ].join('\n')).join('\n\n'));
    return sections.join('\n\n');
}
function buildToolPlanningPromptFrame(request, tools, forceFinal) {
    const sections = [
        '# System Instructions',
        request.systemPrompt.trim(),
        '# Codex Runtime Contract',
        [
            'You are running inside the V2 runtime as a model transport only.',
            'Do not execute shell commands, do not edit files directly, and do not use Codex built-in MCP or browser capabilities.',
            'If you need external state, request one or more V2 tools and wait for the host to return results.',
            'The user cannot see raw tool results or raw terminal/browser output unless you restate them in assistant text. Tool status lines are only compact progress indicators.',
            'Respect runtime validation blocks exactly as written. Do not override INVALID or INCOMPLETE verdicts.',
            forceFinal
                ? 'The host will not execute any more tools in this turn. Produce the best final answer from the evidence already gathered.'
                : 'When you need tools, respond with kind="tool_calls" and provide only the minimal next calls needed.',
        ].join('\n'),
    ];
    if (request.contextPrompt?.trim()) {
        sections.push('# Runtime Context', request.contextPrompt.trim());
    }
    sections.push('# Available Tools', buildToolRegistryText(tools), '# Current User Request', request.task.trim(), '# Response Rules', [
        'Return JSON matching the provided response schema.',
        forceFinal
            ? 'Set kind="final", tool_calls=[], and place the user-facing answer in message.'
            : 'Either set kind="tool_calls" with tool_calls populated and keep message empty unless you need a short blocker, clarification request, or material state-change note, or set kind="final" with tool_calls=[].',
        'Each tool call arguments_json must be valid JSON encoding of the tool input object.',
        'Do not wrap JSON in markdown fences.',
    ].join('\n'));
    return sections.join('\n\n');
}
function buildToolPlanningPrompt(request, tools, transcript, forceFinal) {
    return [
        buildToolPlanningPromptFrame(request, tools, forceFinal),
        '# Prior Turn History',
        buildTranscriptHistory(transcript),
    ].join('\n\n');
}
function buildToolLoopOutputSchema(toolNames) {
    return {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'tool_calls', 'message'],
        properties: {
            kind: {
                type: 'string',
                enum: ['tool_calls', 'final'],
            },
            tool_calls: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['name', 'arguments_json'],
                    properties: {
                        name: {
                            type: 'string',
                            enum: toolNames,
                        },
                        arguments_json: {
                            type: 'string',
                        },
                    },
                },
            },
            message: {
                type: 'string',
            },
        },
    };
}
function buildFinalOnlyOutputSchema() {
    return {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'tool_calls', 'message'],
        properties: {
            kind: {
                type: 'string',
                enum: ['final'],
            },
            tool_calls: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['name', 'arguments_json'],
                    properties: {
                        name: {
                            type: 'string',
                            enum: ['__no_tools__'],
                        },
                        arguments_json: {
                            type: 'string',
                        },
                    },
                },
                maxItems: 0,
            },
            message: {
                type: 'string',
            },
        },
    };
}
function parseStructuredResponse(text) {
    const parsed = JSON.parse(text);
    if ((parsed.kind !== 'tool_calls' && parsed.kind !== 'final')
        || !Array.isArray(parsed.tool_calls)
        || typeof parsed.message !== 'string') {
        throw new Error('Codex returned a response that does not match the runtime schema.');
    }
    return {
        kind: parsed.kind,
        tool_calls: parsed.tool_calls.map((call) => {
            if (!call || typeof call !== 'object') {
                throw new Error('Codex returned an invalid tool call entry.');
            }
            const name = call.name;
            const argumentsJson = call.arguments_json;
            if (typeof name !== 'string' || typeof argumentsJson !== 'string') {
                throw new Error('Codex returned an invalid tool call payload.');
            }
            return {
                name: name,
                arguments_json: argumentsJson,
            };
        }),
        message: parsed.message,
    };
}
class CodexProvider {
    providerId;
    modelId;
    supportsAppToolExecutor = true;
    aborted = false;
    activeProcess = null;
    constructor(options = {}) {
        this.providerId = options.providerId ?? model_1.PRIMARY_PROVIDER_ID;
        this.modelId = options.modelId ?? this.providerId;
    }
    static isAvailable() {
        const probe = (0, child_process_1.spawnSync)('codex', ['--version'], {
            cwd: process.cwd(),
            encoding: 'utf8',
        });
        if (probe.error) {
            return { available: false, error: probe.error.message };
        }
        if (probe.status !== 0) {
            const stderr = firstNonEmptyLine(probe.stderr || '');
            return { available: false, error: stderr || `codex --version exited with status ${probe.status}` };
        }
        return { available: true };
    }
    abort() {
        this.aborted = true;
        this.activeProcess?.kill();
    }
    async invoke(request) {
        this.aborted = false;
        const startedAt = Date.now();
        let inputTokens = 0;
        let outputTokens = 0;
        const completedItems = new Map();
        const transcript = [];
        const toolCatalog = request.toolCatalog;
        const toolBindingStore = (0, toolBindingScope_1.createRequestToolBindingStore)(request);
        const promptFrameCache = new Map();
        const maxToolTurns = (0, providerToolRuntime_1.normalizeProviderMaxToolTurns)(request.maxToolTurns ?? providerToolRuntime_1.DEFAULT_PROVIDER_MAX_TOOL_TURNS);
        const buildPrompt = (tools, forceFinal) => {
            const cacheKey = `${forceFinal ? 'final' : 'loop'}:${tools.map((tool) => tool.name).join('|')}`;
            let frame = promptFrameCache.get(cacheKey);
            if (!frame) {
                frame = buildToolPlanningPromptFrame(request, tools, forceFinal);
                promptFrameCache.set(cacheKey, frame);
            }
            return [frame, '# Prior Turn History', buildTranscriptHistory(transcript)].join('\n\n');
        };
        if (toolBindingStore.getCallableTools().length === 0) {
            const finalResult = await this.invokeCodexTurn(buildPrompt([], true), buildFinalOnlyOutputSchema());
            inputTokens += finalResult.usage.inputTokens;
            outputTokens += finalResult.usage.outputTokens;
            const finalText = (0, providerToolRuntime_1.normalizeProviderFinalOutput)(finalResult.response.message);
            request.onToken?.(finalText);
            const finalItem = (0, providerToolRuntime_1.publishProviderFinalOutput)({
                request,
                itemId: `${this.itemPrefix('final')}-${Date.now()}`,
                text: finalText,
                emitToken: false,
            });
            completedItems.set(finalItem.id, finalItem);
            return {
                output: finalItem.text,
                codexItems: Array.from(completedItems.values()),
                usage: {
                    inputTokens,
                    outputTokens,
                    durationMs: Date.now() - startedAt,
                },
            };
        }
        for (let turn = 0; turn < maxToolTurns; turn++) {
            if (this.aborted)
                throw new Error('Task cancelled by user.');
            const callableTools = toolBindingStore.beginTurn();
            const turnResult = await this.invokeCodexTurn(buildPrompt(callableTools, false), buildToolLoopOutputSchema(callableTools.map(tool => tool.name)));
            inputTokens += turnResult.usage.inputTokens;
            outputTokens += turnResult.usage.outputTokens;
            const response = turnResult.response;
            if (response.kind === 'final') {
                const autoExpansion = (0, providerToolRuntime_1.applyAutoExpandedToolPack)({
                    message: response.message,
                    toolCatalog,
                    toolBindingStore,
                });
                if (autoExpansion) {
                    if (response.message.trim()) {
                        transcript.push({
                            type: 'assistant',
                            content: response.message.trim(),
                        });
                    }
                    request.onStatus?.(`tool-auto-expand:${autoExpansion.pack}`);
                    transcript.push({
                        type: 'tool',
                        content: (0, providerToolRuntime_1.formatAutoExpandedToolPackLines)(autoExpansion).join('\n'),
                    });
                    continue;
                }
                const finalText = (0, providerToolRuntime_1.normalizeProviderFinalOutput)(response.message);
                request.onToken?.(finalText);
                const finalItem = (0, providerToolRuntime_1.publishProviderFinalOutput)({
                    request,
                    itemId: `${this.itemPrefix('final')}-${Date.now()}`,
                    text: finalText,
                    emitToken: false,
                });
                completedItems.set(finalItem.id, finalItem);
                return {
                    output: finalItem.text,
                    codexItems: Array.from(completedItems.values()),
                    usage: {
                        inputTokens,
                        outputTokens,
                        durationMs: Date.now() - startedAt,
                    },
                };
            }
            if (response.message.trim()) {
                transcript.push({
                    type: 'assistant',
                    content: response.message.trim(),
                });
            }
            if (response.tool_calls.length === 0) {
                throw new Error('Codex requested a tool turn without any tool calls.');
            }
            for (let index = 0; index < response.tool_calls.length; index++) {
                const toolCall = response.tool_calls[index];
                const allowedToolNames = new Set(callableTools.map(tool => tool.name));
                if (!allowedToolNames.has(toolCall.name)) {
                    const message = `Tool is not available in this runtime scope: ${toolCall.name}`;
                    transcript.push({
                        type: 'tool',
                        content: [
                            `Tool: ${toolCall.name}`,
                            `Error: ${message}`,
                        ].join('\n'),
                    });
                    request.onStatus?.(`tool-done:${toolCall.name} ... error: ${message.slice(0, 80)}`);
                    continue;
                }
                let toolInput;
                try {
                    toolInput = JSON.parse(toolCall.arguments_json);
                }
                catch (err) {
                    const message = `Invalid JSON for tool ${toolCall.name}: ${err instanceof Error ? err.message : String(err)}`;
                    transcript.push({
                        type: 'tool',
                        content: [
                            `Tool: ${toolCall.name}`,
                            `Input parse error: ${message}`,
                        ].join('\n'),
                    });
                    request.onStatus?.(`tool-done:${toolCall.name} ... error: ${message.slice(0, 80)}`);
                    continue;
                }
                const itemId = `${this.itemPrefix('tool')}-${turn + 1}-${index + 1}-${Date.now()}`;
                const execution = await (0, providerToolRuntime_1.executeProviderToolCallWithEvents)({
                    providerId: this.providerId,
                    request,
                    toolName: toolCall.name,
                    toolInput,
                    itemId,
                    currentTools: callableTools,
                });
                completedItems.set(itemId, execution.completedItem);
                if (execution.ok) {
                    const expansion = (0, providerToolRuntime_1.applyRuntimeToolExpansion)({
                        request,
                        toolBindingStore,
                        toolName: toolCall.name,
                        result: execution.result,
                    });
                    if (expansion) {
                        transcript.push({
                            type: 'tool',
                            content: [
                                `Tool: ${toolCall.name}`,
                                `Input: ${(0, providerToolRuntime_1.encodeToolInput)(toolInput)}`,
                                ...(0, providerToolRuntime_1.formatQueuedExpansionLines)(expansion, { style: 'codex' }),
                            ].join('\n'),
                        });
                        continue;
                    }
                    transcript.push({
                        type: 'tool',
                        content: [
                            `Tool: ${toolCall.name}`,
                            `Input: ${(0, providerToolRuntime_1.encodeToolInput)(toolInput)}`,
                            'Result:',
                            execution.toolContent,
                        ].join('\n'),
                    });
                    continue;
                }
                const message = execution.errorMessage;
                transcript.push({
                    type: 'tool',
                    content: [
                        `Tool: ${toolCall.name}`,
                        `Input: ${(0, providerToolRuntime_1.encodeToolInput)(toolInput)}`,
                        `Error: ${message}`,
                    ].join('\n'),
                });
            }
        }
        const finalResult = await this.invokeCodexTurn(buildPrompt(toolBindingStore.beginTurn(), true), buildFinalOnlyOutputSchema());
        inputTokens += finalResult.usage.inputTokens;
        outputTokens += finalResult.usage.outputTokens;
        const finalText = (0, providerToolRuntime_1.normalizeProviderFinalOutput)(finalResult.response.message);
        request.onToken?.(finalText);
        const finalItem = (0, providerToolRuntime_1.publishProviderFinalOutput)({
            request,
            itemId: `${this.itemPrefix('final')}-${Date.now()}`,
            text: finalText,
            emitToken: false,
        });
        completedItems.set(finalItem.id, finalItem);
        return {
            output: finalItem.text,
            codexItems: Array.from(completedItems.values()),
            usage: {
                inputTokens,
                outputTokens,
                durationMs: Date.now() - startedAt,
            },
        };
    }
    async invokeCodexTurn(prompt, outputSchema) {
        const schemaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-provider-'));
        const schemaPath = path.join(schemaDir, 'output-schema.json');
        fs.writeFileSync(schemaPath, JSON.stringify(outputSchema));
        return new Promise((resolve, reject) => {
            let codexProcess;
            try {
                codexProcess = (0, child_process_1.spawn)('codex', [
                    'exec',
                    '--json',
                    '--model',
                    this.modelId,
                    '-c',
                    CODEX_WEB_SEARCH_DISABLED_CONFIG,
                    '--dangerously-bypass-approvals-and-sandbox',
                    '--output-schema',
                    schemaPath,
                    '-',
                ], {
                    cwd: process.cwd(),
                    stdio: ['pipe', 'pipe', 'pipe'],
                });
            }
            catch (err) {
                try {
                    fs.rmSync(schemaDir, { recursive: true, force: true });
                }
                catch {
                    // Best-effort temp cleanup.
                }
                reject(err instanceof Error ? err : new Error(String(err)));
                return;
            }
            this.activeProcess = codexProcess;
            let stderr = '';
            let stdoutRemainder = '';
            let inputTokens = 0;
            let outputTokens = 0;
            let finalFailureMessage = null;
            let finalMessageText = '';
            let settled = false;
            let inactivityTimer = null;
            const cleanup = () => {
                if (inactivityTimer) {
                    clearTimeout(inactivityTimer);
                    inactivityTimer = null;
                }
                this.activeProcess = null;
                try {
                    fs.rmSync(schemaDir, { recursive: true, force: true });
                }
                catch {
                    // Best-effort temp cleanup.
                }
            };
            const finish = (fn) => {
                if (settled)
                    return;
                settled = true;
                cleanup();
                fn();
            };
            const resetInactivityTimer = () => {
                if (settled)
                    return;
                if (inactivityTimer)
                    clearTimeout(inactivityTimer);
                inactivityTimer = setTimeout(() => {
                    codexProcess.kill();
                    finish(() => reject(new Error(`Codex exec was inactive for ${CODEX_INACTIVITY_TIMEOUT_MS / 1000}s`)));
                }, CODEX_INACTIVITY_TIMEOUT_MS);
            };
            const handleEvent = (event) => {
                switch (event.type) {
                    case 'turn.completed':
                        inputTokens = event.usage.input_tokens || 0;
                        outputTokens = event.usage.output_tokens || 0;
                        return;
                    case 'turn.failed':
                        finalFailureMessage = event.error?.message || 'Codex turn failed.';
                        return;
                    case 'item.completed':
                        if (event.item.type === 'agent_message') {
                            finalMessageText = event.item.text;
                        }
                        return;
                    case 'error':
                        finalFailureMessage = event.message;
                        return;
                    default:
                        return;
                }
            };
            const flushStdout = () => {
                const lines = stdoutRemainder.split('\n');
                stdoutRemainder = lines.pop() ?? '';
                for (const rawLine of lines) {
                    const line = rawLine.trim();
                    if (!line)
                        continue;
                    try {
                        handleEvent(JSON.parse(line));
                    }
                    catch (err) {
                        finalFailureMessage = `Failed to parse Codex response: ${err instanceof Error ? err.message : String(err)}`;
                    }
                }
            };
            resetInactivityTimer();
            codexProcess.stdin?.on('error', () => {
                // Ignore broken-pipe style errors; close/error handling below is authoritative.
            });
            codexProcess.stdin?.end(prompt);
            codexProcess.stdout?.on('data', (data) => {
                resetInactivityTimer();
                stdoutRemainder += data.toString();
                flushStdout();
            });
            codexProcess.stderr?.on('data', (data) => {
                resetInactivityTimer();
                stderr += data.toString();
            });
            codexProcess.on('error', (err) => {
                finish(() => reject(err));
            });
            codexProcess.on('close', (code) => {
                finish(() => {
                    if (stdoutRemainder.trim()) {
                        try {
                            handleEvent(JSON.parse(stdoutRemainder.trim()));
                        }
                        catch (err) {
                            finalFailureMessage = `Failed to parse Codex response: ${err instanceof Error ? err.message : String(err)}`;
                        }
                    }
                    if (this.aborted) {
                        reject(new Error('Task cancelled by user.'));
                        return;
                    }
                    if (code !== 0) {
                        const stderrLine = firstNonEmptyLine(stderr);
                        reject(new Error(stderrLine || finalFailureMessage || `Codex exec failed with exit code ${code}`));
                        return;
                    }
                    if (finalFailureMessage) {
                        reject(new Error(finalFailureMessage));
                        return;
                    }
                    if (!finalMessageText.trim()) {
                        reject(new Error('Codex did not produce a structured response.'));
                        return;
                    }
                    let response;
                    try {
                        response = parseStructuredResponse(finalMessageText);
                    }
                    catch (err) {
                        reject(err instanceof Error ? err : new Error(String(err)));
                        return;
                    }
                    resolve({
                        response,
                        usage: {
                            inputTokens,
                            outputTokens,
                        },
                    });
                });
            });
        });
    }
    itemPrefix(kind) {
        return `${this.providerId.replace(/[^a-zA-Z0-9]+/g, '-')}-${kind}`;
    }
}
exports.CodexProvider = CodexProvider;
//# sourceMappingURL=CodexProvider.js.map