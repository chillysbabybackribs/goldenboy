"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentToolExecutor = exports.AgentToolExecutor = void 0;
const AgentRunStore_1 = require("./AgentRunStore");
const AgentCache_1 = require("./AgentCache");
const ConstraintValidator_1 = require("./ConstraintValidator");
const browserOperationContext_1 = require("../browser/browserOperationContext");
const runtimeLedgerStore_1 = require("../models/runtimeLedgerStore");
const CACHEABLE_TOOLS = new Set([
    'browser.get_state',
    'browser.get_tabs',
    'browser.extract_page',
    'browser.inspect_page',
    'browser.find_element',
    'browser.summarize_page',
    'browser.answer_from_cache',
    'browser.search_page_cache',
    'browser.read_cached_chunk',
    'browser.list_cached_pages',
    'browser.list_cached_sections',
    'browser.cache_stats',
    'browser.get_actionable_elements',
    'browser.capture_snapshot',
    'filesystem.list',
    'filesystem.search',
    'filesystem.answer_from_cache',
    'filesystem.search_file_cache',
    'filesystem.read_file_chunk',
    'filesystem.list_cached_files',
    'filesystem.file_cache_stats',
    'filesystem.read',
    'subagent.list',
]);
const DEFAULT_TOOL_TIMEOUT_MS = 180_000;
function cacheTtlForTool(name) {
    if (name.startsWith('browser.'))
        return 10_000;
    if (name.startsWith('filesystem.'))
        return 60_000;
    return 5_000;
}
function timeoutForTool(name) {
    if (name === 'subagent.wait')
        return 180_000;
    if (name.startsWith('browser.'))
        return 180_000;
    return DEFAULT_TOOL_TIMEOUT_MS;
}
async function withTimeout(promise, timeoutMs, message) {
    let timeout = null;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
            }),
        ]);
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
    }
}
class AgentToolExecutor {
    tools = new Map();
    register(tool) {
        this.tools.set(tool.name, tool);
    }
    registerMany(tools) {
        for (const tool of tools)
            this.register(tool);
    }
    list() {
        return Array.from(this.tools.values());
    }
    async execute(name, input, context) {
        const tool = this.tools.get(name);
        if (!tool)
            throw new Error(`Agent tool not registered: ${name}`);
        const cacheKey = (0, AgentCache_1.makeToolCacheKey)(name, input);
        if (CACHEABLE_TOOLS.has(name)) {
            const cached = AgentCache_1.agentCache.getToolResult(cacheKey);
            if (cached) {
                return {
                    ...cached,
                    summary: `${cached.summary} (cached)`,
                };
            }
        }
        const record = AgentRunStore_1.agentRunStore.startToolCall({
            runId: context.runId,
            agentId: context.agentId,
            toolName: name,
            toolInput: input,
        });
        runtimeLedgerStore_1.runtimeLedgerStore.recordToolEvent({
            taskId: context.taskId ?? null,
            runId: context.runId,
            summary: `Started tool ${name}`,
            metadata: {
                toolCallId: record.id,
                toolName: name,
                status: 'running',
            },
        });
        try {
            const executeTool = () => withTimeout(tool.execute(input, context), timeoutForTool(name), `Timed out while running tool ${name}`);
            const result = name.startsWith('browser.')
                ? await (0, browserOperationContext_1.runWithBrowserOperationContext)({
                    source: 'agent',
                    taskId: context.taskId ?? null,
                    agentId: context.agentId,
                    runId: context.runId,
                    contextId: context.contextId ?? null,
                }, executeTool)
                : await executeTool();
            // Post-execution deterministic constraint validation
            const validation = (0, ConstraintValidator_1.validateToolResult)(name, result, input);
            if (validation) {
                result.validation = validation;
            }
            if (CACHEABLE_TOOLS.has(name)) {
                AgentCache_1.agentCache.setToolResult(cacheKey, result, cacheTtlForTool(name));
            }
            AgentRunStore_1.agentRunStore.finishToolCall(record.id, 'completed', result);
            runtimeLedgerStore_1.runtimeLedgerStore.recordToolEvent({
                taskId: context.taskId ?? null,
                runId: context.runId,
                summary: `Completed tool ${name}: ${result.summary}`,
                metadata: {
                    toolCallId: record.id,
                    toolName: name,
                    status: 'completed',
                    validationStatus: result.validation?.status,
                },
            });
            return result;
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            AgentRunStore_1.agentRunStore.finishToolCall(record.id, 'failed', null, message);
            runtimeLedgerStore_1.runtimeLedgerStore.recordToolEvent({
                taskId: context.taskId ?? null,
                runId: context.runId,
                summary: `Failed tool ${name}: ${message}`,
                metadata: {
                    toolCallId: record.id,
                    toolName: name,
                    status: 'failed',
                },
            });
            throw err;
        }
    }
}
exports.AgentToolExecutor = AgentToolExecutor;
exports.agentToolExecutor = new AgentToolExecutor();
//# sourceMappingURL=AgentToolExecutor.js.map