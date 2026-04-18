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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HaikuProvider = void 0;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const model_1 = require("../../shared/types/model");
const providerToolRuntime_1 = require("./providerToolRuntime");
const toolBindingScope_1 = require("./toolBindingScope");
function loadEnvValue(key) {
    if (process.env[key])
        return process.env[key] || null;
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath))
        return null;
    const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('='))
            continue;
        const eq = trimmed.indexOf('=');
        const name = trimmed.slice(0, eq).trim();
        if (name !== key)
            continue;
        let value = trimmed.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (value) {
            process.env[key] = value;
            return value;
        }
    }
    return null;
}
function textFromContent(content) {
    return content
        .filter((block) => block.type === 'text')
        .map(block => block.text)
        .join('');
}
function toAnthropicToolName(name) {
    return name.replace(/\./g, '__');
}
function fromAnthropicToolName(name) {
    return name.replace(/__/g, '.');
}
const MODEL_STREAM_TIMEOUT_MS = 180_000;
const FINAL_SYNTHESIS_TIMEOUT_MS = 120_000;
async function finalMessageWithTimeout(stream, timeoutMs, message) {
    let timeout = null;
    try {
        return await Promise.race([
            stream.finalMessage(),
            new Promise((_, reject) => {
                timeout = setTimeout(() => {
                    stream.abort();
                    reject(new Error(message));
                }, timeoutMs);
            }),
        ]);
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
    }
}
function buildInitialUserContent(request) {
    const textParts = [];
    if (request.contextPrompt?.trim()) {
        textParts.push(request.contextPrompt.trim(), '', '## Current User Request');
    }
    textParts.push(request.task);
    const text = textParts.join('\n').trim();
    const attachments = request.attachments;
    if (!attachments?.length)
        return text;
    const content = [];
    for (const att of attachments) {
        if (att.type === 'image') {
            content.push({
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: att.mediaType,
                    data: att.data,
                },
            });
        }
    }
    if (text) {
        content.push({ type: 'text', text });
    }
    return content;
}
class HaikuProvider {
    modelId;
    supportsAppToolExecutor = true;
    client;
    aborted = false;
    activeStream = null;
    constructor(apiKey = loadEnvValue('ANTHROPIC_API_KEY')) {
        if (!apiKey) {
            throw new Error('ANTHROPIC_API_KEY is not configured.');
        }
        this.modelId = loadEnvValue('ANTHROPIC_MODEL') || model_1.DEFAULT_HAIKU_CONFIG.modelId;
        this.client = new sdk_1.default({ apiKey });
    }
    abort() {
        this.aborted = true;
        if (this.activeStream) {
            this.activeStream.abort();
            this.activeStream = null;
        }
    }
    async invoke(request) {
        this.aborted = false;
        this.activeStream = null;
        const startedAt = Date.now();
        let inputTokens = 0;
        let outputTokens = 0;
        const completedItems = new Map();
        const messages = [
            {
                role: 'user',
                content: buildInitialUserContent(request),
            },
        ];
        const toolCatalog = request.toolCatalog;
        const toolBindingStore = (0, toolBindingScope_1.createRequestToolBindingStore)(request);
        const maxToolTurns = (0, providerToolRuntime_1.normalizeProviderMaxToolTurns)(request.maxToolTurns ?? providerToolRuntime_1.DEFAULT_PROVIDER_MAX_TOOL_TURNS);
        let finalOutput = '';
        let reachedToolTurnLimit = false;
        for (let turn = 0; turn < maxToolTurns; turn++) {
            if (this.aborted) {
                throw new Error('Task cancelled by user.');
            }
            const callableTools = toolBindingStore.beginTurn();
            let turnTextBuffer = '';
            const turnTextChunks = [];
            const tools = callableTools.map(tool => ({
                name: toAnthropicToolName(tool.name),
                description: `${tool.description}\n\nV2 tool name: ${tool.name}`,
                input_schema: tool.inputSchema,
            }));
            const allowedToolNames = new Set(callableTools.map(tool => tool.name));
            const stream = this.client.messages.stream({
                model: this.modelId,
                max_tokens: model_1.DEFAULT_HAIKU_CONFIG.maxTokens,
                system: [
                    {
                        type: 'text',
                        text: request.systemPrompt,
                        cache_control: { type: 'ephemeral' },
                    },
                ],
                messages,
                tools,
                tool_choice: { type: 'auto' },
            });
            this.activeStream = stream;
            stream.on('text', (text) => {
                turnTextBuffer += text;
                turnTextChunks.push(text);
            });
            let response;
            try {
                response = await finalMessageWithTimeout(stream, MODEL_STREAM_TIMEOUT_MS, `Model stream timed out after ${MODEL_STREAM_TIMEOUT_MS / 1000}s`);
            }
            catch (err) {
                this.activeStream = null;
                if (this.aborted)
                    throw new Error('Task cancelled by user.');
                throw err;
            }
            this.activeStream = null;
            inputTokens += response.usage.input_tokens;
            outputTokens += response.usage.output_tokens;
            finalOutput = textFromContent(response.content);
            const toolUses = response.content.filter((block) => block.type === 'tool_use');
            if (toolUses.length > 0 && turnTextBuffer.trim()) {
                request.onStatus?.('thought-migrate');
            }
            if (toolUses.length === 0) {
                const autoExpansion = (0, providerToolRuntime_1.applyAutoExpandedToolPack)({
                    message: finalOutput,
                    toolCatalog,
                    toolBindingStore,
                });
                if (autoExpansion) {
                    messages.push({
                        role: 'assistant',
                        content: response.content,
                    });
                    messages.push({
                        role: 'user',
                        content: (0, providerToolRuntime_1.formatAutoExpandedToolPackLines)(autoExpansion, { continueInstruction: true }).join('\n'),
                    });
                    request.onStatus?.(`tool-auto-expand:${autoExpansion.pack}`);
                    continue;
                }
                for (const chunk of turnTextChunks) {
                    request.onToken?.(chunk);
                }
                break;
            }
            messages.push({
                role: 'assistant',
                content: response.content,
            });
            const toolResults = [];
            for (let index = 0; index < toolUses.length; index++) {
                const toolUse = toolUses[index];
                const v2ToolName = fromAnthropicToolName(toolUse.name);
                if (!allowedToolNames.has(v2ToolName)) {
                    const message = `Tool is not available in this runtime scope: ${v2ToolName}`;
                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: toolUse.id,
                        is_error: true,
                        content: message,
                    });
                    request.onStatus?.(`tool-done:${v2ToolName} ... error: ${message.slice(0, 80)}`);
                    continue;
                }
                const execution = await (0, providerToolRuntime_1.executeProviderToolCallWithEvents)({
                    providerId: 'haiku',
                    request,
                    toolName: v2ToolName,
                    toolInput: toolUse.input,
                    itemId: `haiku-tool-${turn + 1}-${index + 1}-${Date.now()}`,
                    currentTools: callableTools,
                });
                completedItems.set(execution.completedItem.id, execution.completedItem);
                if (execution.ok) {
                    const expansion = (0, providerToolRuntime_1.applyRuntimeToolExpansion)({
                        request,
                        toolBindingStore,
                        toolName: v2ToolName,
                        result: execution.result,
                    });
                    if (expansion) {
                        toolResults.push({
                            type: 'tool_result',
                            tool_use_id: toolUse.id,
                            content: (0, providerToolRuntime_1.formatQueuedExpansionLines)(expansion, { style: 'haiku' }).join('\n'),
                        });
                        continue;
                    }
                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: toolUse.id,
                        content: execution.toolContent,
                    });
                    continue;
                }
                toolResults.push({
                    type: 'tool_result',
                    tool_use_id: toolUse.id,
                    is_error: true,
                    content: execution.errorMessage,
                });
            }
            messages.push({
                role: 'user',
                content: toolResults,
            });
            reachedToolTurnLimit = turn === maxToolTurns - 1;
        }
        if (reachedToolTurnLimit) {
            const tools = toolBindingStore.beginTurn().map(tool => ({
                name: toAnthropicToolName(tool.name),
                description: `${tool.description}\n\nV2 tool name: ${tool.name}`,
                input_schema: tool.inputSchema,
            }));
            const synthesisStream = this.client.messages.stream({
                model: this.modelId,
                max_tokens: model_1.DEFAULT_HAIKU_CONFIG.maxTokens,
                system: [
                    {
                        type: 'text',
                        text: request.systemPrompt,
                        cache_control: { type: 'ephemeral' },
                    },
                ],
                messages: [
                    ...messages,
                    {
                        role: 'user',
                        content: [
                            'The tool-call turn limit has been reached. Stop using tools and provide the best final answer from the evidence already gathered.',
                            'If the evidence is insufficient, say exactly what could not be verified and which constraints prevented a concrete answer.',
                        ].join('\n'),
                    },
                ],
                tools,
                tool_choice: { type: 'none' },
            });
            this.activeStream = synthesisStream;
            synthesisStream.on('text', (text) => {
                request.onToken?.(text);
            });
            const synthesisResponse = await finalMessageWithTimeout(synthesisStream, FINAL_SYNTHESIS_TIMEOUT_MS, `Final synthesis timed out after ${FINAL_SYNTHESIS_TIMEOUT_MS / 1000}s`);
            this.activeStream = null;
            inputTokens += synthesisResponse.usage.input_tokens;
            outputTokens += synthesisResponse.usage.output_tokens;
            finalOutput = textFromContent(synthesisResponse.content);
        }
        const finalItem = (0, providerToolRuntime_1.publishProviderFinalOutput)({
            request,
            itemId: `haiku-final-${Date.now()}`,
            text: finalOutput.trim()
                ? finalOutput
                : 'The run ended without a text response. Please retry the task; no final answer was produced.',
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
}
exports.HaikuProvider = HaikuProvider;
//# sourceMappingURL=HaikuProvider.js.map