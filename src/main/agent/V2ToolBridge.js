"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.V2ToolBridge = void 0;
const http_1 = __importDefault(require("http"));
const fs_1 = __importDefault(require("fs"));
const AgentToolExecutor_1 = require("./AgentToolExecutor");
const ConstraintValidator_1 = require("./ConstraintValidator");
const ChatKnowledgeStore_1 = require("../chatKnowledge/ChatKnowledgeStore");
const MAX_TOOL_RESULT_CHARS = 8_000;
function toMcpName(agentName) {
    return agentName.replace(/\./g, '__');
}
function fromMcpName(mcpName) {
    return mcpName.replace(/__/g, '.');
}
function readContext(contextPath) {
    try {
        const raw = fs_1.default.readFileSync(contextPath, 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return { runId: 'unknown', agentId: 'unknown', mode: 'unrestricted-dev', toolCatalog: [] };
    }
}
function compactResult(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 0);
    if (!text)
        return '';
    return text.length > MAX_TOOL_RESULT_CHARS
        ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n...[tool result truncated]`
        : text;
}
function resolveAllowedToolNames(ctx) {
    return ctx.toolNames?.length ? new Set(ctx.toolNames) : null;
}
function assertToolAllowed(toolName, allowedToolNames) {
    if (!allowedToolNames || allowedToolNames.has(toolName))
        return;
    throw new Error(`Tool is not available in this runtime scope: ${toolName}`);
}
class V2ToolBridge {
    contextPath;
    server = null;
    port = 0;
    constructor(contextPath) {
        this.contextPath = contextPath;
    }
    getPort() {
        return this.port;
    }
    start() {
        return new Promise((resolve, reject) => {
            this.server = http_1.default.createServer((req, res) => {
                void this.handleRequest(req, res);
            });
            this.server.listen(0, '127.0.0.1', () => {
                const addr = this.server.address();
                this.port = typeof addr === 'object' && addr ? addr.port : 0;
                resolve();
            });
            this.server.on('error', reject);
        });
    }
    stop() {
        return new Promise((resolve, reject) => {
            if (!this.server) {
                resolve();
                return;
            }
            this.server.close(() => resolve());
            this.server.once('error', reject);
        });
    }
    async handleRequest(req, res) {
        const chunks = [];
        for await (const chunk of req) {
            chunks.push(chunk);
        }
        const body = Buffer.concat(chunks).toString('utf-8');
        const send = (data, status = 200) => {
            const payload = JSON.stringify(data);
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(payload);
        };
        try {
            if (req.url === '/tools/list') {
                const ctx = readContext(this.contextPath);
                const allowed = resolveAllowedToolNames(ctx);
                const tools = AgentToolExecutor_1.agentToolExecutor.list()
                    .filter((t) => !allowed || allowed.has(t.name))
                    .map((t) => ({
                    name: toMcpName(t.name),
                    description: t.description,
                    inputSchema: t.inputSchema,
                }));
                send({ tools });
                return;
            }
            if (req.url === '/tools/call') {
                const payload = JSON.parse(body);
                const toolName = fromMcpName(payload.name);
                const ctxPath = payload.contextPath || this.contextPath;
                const ctx = readContext(ctxPath);
                const allowed = resolveAllowedToolNames(ctx);
                assertToolAllowed(toolName, allowed);
                const result = await AgentToolExecutor_1.agentToolExecutor.execute(toolName, payload.arguments, ctx);
                if (ctx.taskId && !toolName.startsWith('chat.')) {
                    ChatKnowledgeStore_1.chatKnowledgeStore.recordToolMessage(ctx.taskId, JSON.stringify({ tool: toolName, input: payload.arguments, result }, null, 2).slice(0, 50_000), ctx.agentId, ctx.runId);
                }
                let text = compactResult(result);
                if (result.validation) {
                    text += (0, ConstraintValidator_1.formatValidationForModel)(result.validation);
                }
                send({ content: [{ type: 'text', text }] });
                return;
            }
            send({ error: 'Not found' }, 404);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            send({ content: [{ type: 'text', text: `Tool execution error: ${message}` }] });
        }
    }
}
exports.V2ToolBridge = V2ToolBridge;
//# sourceMappingURL=V2ToolBridge.js.map