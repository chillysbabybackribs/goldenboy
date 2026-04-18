"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const AgentRunStore_1 = require("../AgentRunStore");
const AgentToolExecutor_1 = require("../AgentToolExecutor");
const SubAgentManager_1 = require("./SubAgentManager");
const model_1 = require("../../../shared/types/model");
function createStubProvider(output = 'sub-agent completed') {
    return {
        invoke: vitest_1.vi.fn(async (_request) => ({
            output,
            usage: { inputTokens: 0, outputTokens: 0, durationMs: 1 },
        })),
    };
}
(0, vitest_1.describe)('SubAgentManager', () => {
    (0, vitest_1.it)('selects the child provider using the spawn input', async () => {
        AgentToolExecutor_1.agentToolExecutor.register({
            name: 'browser.research_search',
            description: 'Search the web',
            inputSchema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    query: { type: 'string' },
                },
            },
            execute: async () => ({
                summary: 'searched',
                data: {},
            }),
        });
        const providerFactory = vitest_1.vi.fn((input) => {
            return createStubProvider(`handled:${input.providerId ?? 'auto'}:${input.task}`);
        });
        const manager = new SubAgentManager_1.SubAgentManager(providerFactory);
        const result = await manager.run('parent-run', {
            task: 'Search online for the latest Electron release notes',
            role: 'research',
            providerId: model_1.PRIMARY_PROVIDER_ID,
        });
        (0, vitest_1.expect)(providerFactory).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(providerFactory).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            task: 'Search online for the latest Electron release notes',
            role: 'research',
            providerId: model_1.PRIMARY_PROVIDER_ID,
        }));
        (0, vitest_1.expect)(result.status).toBe('completed');
        (0, vitest_1.expect)(result.summary).toContain(`handled:${model_1.PRIMARY_PROVIDER_ID}:Search online for the latest Electron release notes`);
    });
    (0, vitest_1.it)('returns structured execution details for completed sub-agents', async () => {
        const providerFactory = vitest_1.vi.fn(() => ({
            invoke: vitest_1.vi.fn(async (request) => {
                const patchCall = AgentRunStore_1.agentRunStore.startToolCall({
                    runId: request.runId,
                    agentId: request.agentId,
                    toolName: 'filesystem.patch',
                    toolInput: { path: 'src/example.ts' },
                });
                AgentRunStore_1.agentRunStore.finishToolCall(patchCall.id, 'completed', {
                    summary: 'Patched /home/dp/Desktop/v2workspace/src/example.ts',
                    data: { path: '/home/dp/Desktop/v2workspace/src/example.ts', changed: true },
                    validation: { status: 'VALID', constraints: [], summary: 'File patch verified' },
                });
                const terminalCall = AgentRunStore_1.agentRunStore.startToolCall({
                    runId: request.runId,
                    agentId: request.agentId,
                    toolName: 'terminal.exec',
                    toolInput: { command: 'npm test' },
                });
                AgentRunStore_1.agentRunStore.finishToolCall(terminalCall.id, 'completed', {
                    summary: 'Executed command: npm test (exit 1)',
                    data: { command: 'npm test', exitCode: 1 },
                    validation: { status: 'INVALID', constraints: [], summary: 'Command exited with code 1' },
                });
                return {
                    output: '- Fixed provider routing\n- Reproduced the failing command',
                    codexItems: [
                        {
                            id: 'file-1',
                            type: 'file_change',
                            changes: [{ path: 'src/main/agent/CodexProvider.ts', kind: 'update' }],
                            status: 'completed',
                        },
                    ],
                    usage: { inputTokens: 0, outputTokens: 0, durationMs: 1 },
                };
            }),
        }));
        const manager = new SubAgentManager_1.SubAgentManager(providerFactory);
        const result = await manager.run('parent-run', {
            task: 'Patch the provider and verify the command failure',
            role: 'code',
            providerId: model_1.HAIKU_PROVIDER_ID,
        });
        (0, vitest_1.expect)(result.status).toBe('completed');
        (0, vitest_1.expect)(result.findings).toEqual(['Fixed provider routing', 'Reproduced the failing command']);
        (0, vitest_1.expect)(result.changedFiles).toEqual([
            'src/main/agent/CodexProvider.ts',
            'src/example.ts',
        ]);
        (0, vitest_1.expect)(result.commands).toEqual(['npm test (exit 1)']);
        (0, vitest_1.expect)(result.validation).toEqual({
            total: 2,
            valid: 1,
            invalid: 1,
            incomplete: 0,
        });
        (0, vitest_1.expect)(result.blockers).toEqual(['terminal.exec: Command exited with code 1']);
        (0, vitest_1.expect)(result.toolCalls).toEqual([
            {
                toolName: 'filesystem.patch',
                status: 'completed',
                summary: 'Patched /home/dp/Desktop/v2workspace/src/example.ts',
                validationStatus: 'VALID',
            },
            {
                toolName: 'terminal.exec',
                status: 'completed',
                summary: 'Executed command: npm test (exit 1)',
                validationStatus: 'INVALID',
            },
        ]);
    });
    (0, vitest_1.it)('keeps task ownership on sub-agent records for later waits and handoffs', () => {
        const manager = new SubAgentManager_1.SubAgentManager(() => createStubProvider());
        const record = manager.spawn('parent-run', {
            task: 'Check the deployment tab and summarize blockers',
            taskId: 'task-123',
            role: 'research',
        });
        (0, vitest_1.expect)(record.taskId).toBe('task-123');
        (0, vitest_1.expect)(manager.get(record.id)?.taskId).toBe('task-123');
        (0, vitest_1.expect)(manager.list('parent-run')).toEqual([
            vitest_1.expect.objectContaining({
                id: record.id,
                taskId: 'task-123',
            }),
        ]);
    });
});
//# sourceMappingURL=SubAgentManager.test.js.map