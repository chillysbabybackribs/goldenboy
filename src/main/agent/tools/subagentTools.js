"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSubAgentToolDefinitions = createSubAgentToolDefinitions;
const SubAgentManager_1 = require("../subagents/SubAgentManager");
const model_1 = require("../../../shared/types/model");
const appStateStore_1 = require("../../state/appStateStore");
const actions_1 = require("../../state/actions");
const ids_1 = require("../../../shared/utils/ids");
const runtimeLedgerStore_1 = require("../../models/runtimeLedgerStore");
let sharedManager = null;
function getManager(providerFactory) {
    if (!sharedManager)
        sharedManager = new SubAgentManager_1.SubAgentManager(providerFactory);
    return sharedManager;
}
function objectInput(input) {
    return typeof input === 'object' && input !== null ? input : {};
}
function requireString(input, key) {
    const value = input[key];
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`Expected non-empty string input: ${key}`);
    }
    return value;
}
function parseAllowedTools(value) {
    if (value === 'all')
        return 'all';
    if (!Array.isArray(value))
        return 'all';
    return value.filter((item) => typeof item === 'string');
}
function parseProviderId(value) {
    if (value === 'auto')
        return 'auto';
    if (value === model_1.PRIMARY_PROVIDER_ID || value === model_1.HAIKU_PROVIDER_ID)
        return value;
    if (value === 'codex')
        return model_1.PRIMARY_PROVIDER_ID;
    if (value === 'haiku')
        return model_1.HAIKU_PROVIDER_ID;
    return undefined;
}
function logSubAgent(level, message) {
    appStateStore_1.appStateStore.dispatch({
        type: actions_1.ActionType.ADD_LOG,
        log: {
            id: (0, ids_1.generateId)('log'),
            timestamp: Date.now(),
            level,
            source: 'system',
            message,
        },
    });
}
function createSubAgentToolDefinitions(providerFactory) {
    const manager = getManager(providerFactory);
    return [
        {
            name: 'subagent.spawn',
            description: 'Spawn a runtime-managed child agent. Use for independent delegated browser, filesystem, debugging, or research subtasks. Scope children with allowedTools and canSpawnSubagents when possible.',
            inputSchema: {
                type: 'object',
                required: ['task'],
                properties: {
                    task: { type: 'string' },
                    role: { type: 'string' },
                    mode: { type: 'string', enum: ['unrestricted-dev', 'guarded', 'production'] },
                    inheritedContext: { type: 'string', enum: ['full', 'summary', 'none'] },
                    providerId: {
                        type: 'string',
                        enum: ['auto', model_1.PRIMARY_PROVIDER_ID, model_1.HAIKU_PROVIDER_ID, 'codex', 'haiku'],
                    },
                    allowedTools: { oneOf: [{ type: 'string', enum: ['all'] }, { type: 'array', items: { type: 'string' } }] },
                    canSpawnSubagents: { type: 'boolean' },
                },
            },
            async execute(input, context) {
                const obj = objectInput(input);
                const spawnInput = {
                    task: requireString(obj, 'task'),
                    taskId: context.taskId,
                    role: typeof obj.role === 'string' ? obj.role : 'subagent',
                    mode: obj.mode === 'guarded' || obj.mode === 'production' ? obj.mode : 'unrestricted-dev',
                    inheritedContext: obj.inheritedContext === 'full' || obj.inheritedContext === 'none' ? obj.inheritedContext : 'summary',
                    providerId: parseProviderId(obj.providerId),
                    allowedTools: parseAllowedTools(obj.allowedTools),
                    canSpawnSubagents: typeof obj.canSpawnSubagents === 'boolean' ? obj.canSpawnSubagents : true,
                };
                const record = manager.spawnBackground(context.runId, spawnInput);
                logSubAgent('info', `Spawned sub-agent ${record.id}: ${record.role}`);
                runtimeLedgerStore_1.runtimeLedgerStore.recordSubagentEvent({
                    taskId: context.taskId || null,
                    providerId: spawnInput.providerId && spawnInput.providerId !== 'auto' ? spawnInput.providerId : undefined,
                    runId: record.runId ?? undefined,
                    summary: `Spawned sub-agent ${record.role}: ${record.task}`,
                    metadata: {
                        subagentId: record.id,
                        role: record.role,
                        status: record.status,
                    },
                });
                return {
                    summary: `Spawned sub-agent ${record.id}`,
                    data: { subagent: record },
                };
            },
        },
        {
            name: 'subagent.wait',
            description: 'Wait for a child agent to complete and return its summary.',
            inputSchema: {
                type: 'object',
                required: ['id'],
                properties: {
                    id: { type: 'string' },
                    timeoutMs: { type: 'number' },
                },
            },
            async execute(input) {
                const obj = objectInput(input);
                const waitInput = {
                    id: requireString(obj, 'id'),
                    timeoutMs: typeof obj.timeoutMs === 'number' ? obj.timeoutMs : 120_000,
                };
                const record = manager.get(waitInput.id);
                const result = await manager.wait(waitInput.id, waitInput.timeoutMs);
                logSubAgent(result.status === 'completed' ? 'info' : 'warn', `Sub-agent ${result.id} ${result.status}`);
                runtimeLedgerStore_1.runtimeLedgerStore.recordSubagentEvent({
                    taskId: record?.taskId ?? null,
                    runId: record?.runId ?? undefined,
                    summary: `Sub-agent ${result.id} ${result.status}: ${result.summary}`,
                    metadata: {
                        subagentId: result.id,
                        role: record?.role,
                        status: result.status,
                        blockers: result.blockers,
                    },
                });
                return {
                    summary: `Sub-agent ${result.id} ${result.status}`,
                    data: { result },
                };
            },
        },
        {
            name: 'subagent.cancel',
            description: 'Cancel a child agent record. In-flight model calls may finish, but future waits report cancellation.',
            inputSchema: {
                type: 'object',
                required: ['id'],
                properties: { id: { type: 'string' } },
            },
            async execute(input) {
                const record = manager.cancel(requireString(objectInput(input), 'id'));
                logSubAgent('warn', `Cancelled sub-agent ${record.id}`);
                runtimeLedgerStore_1.runtimeLedgerStore.recordSubagentEvent({
                    taskId: record.taskId,
                    runId: record.runId ?? undefined,
                    summary: `Cancelled sub-agent ${record.role}: ${record.task}`,
                    metadata: {
                        subagentId: record.id,
                        role: record.role,
                        status: record.status,
                    },
                });
                return {
                    summary: `Cancelled sub-agent ${record.id}`,
                    data: { subagent: record },
                };
            },
        },
        {
            name: 'subagent.list',
            description: 'List runtime-managed child agents.',
            inputSchema: { type: 'object', properties: { parentRunId: { type: 'string' } } },
            async execute(input) {
                const parentRunId = typeof input === 'object' && input && 'parentRunId' in input
                    ? String(input.parentRunId || '')
                    : '';
                return {
                    summary: 'Listed sub-agents',
                    data: { subagents: manager.list(parentRunId || undefined) },
                };
            },
        },
    ];
}
//# sourceMappingURL=subagentTools.js.map