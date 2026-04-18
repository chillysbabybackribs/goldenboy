"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const model_1 = require("../../shared/types/model");
const { dispatchMock, recordToolMessageMock } = vitest_1.vi.hoisted(() => ({
    dispatchMock: vitest_1.vi.fn(),
    recordToolMessageMock: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../state/appStateStore', () => ({
    appStateStore: {
        dispatch: dispatchMock,
    },
}));
vitest_1.vi.mock('../chatKnowledge/ChatKnowledgeStore', () => ({
    chatKnowledgeStore: {
        recordToolMessage: recordToolMessageMock,
    },
}));
const AgentRuntime_1 = require("./AgentRuntime");
const AgentCache_1 = require("./AgentCache");
const AgentRunStore_1 = require("./AgentRunStore");
const AgentToolExecutor_1 = require("./AgentToolExecutor");
const providerToolRuntime_1 = require("./providerToolRuntime");
const runtimeTools_1 = require("./tools/runtimeTools");
class SuccessfulToolLoopProvider {
    requests = [];
    async invoke(request) {
        this.requests.push(request);
        const execution = await (0, providerToolRuntime_1.executeProviderToolCall)({
            providerId: model_1.PRIMARY_PROVIDER_ID,
            request,
            toolName: 'terminal.exec',
            toolInput: { command: 'echo ok' },
        });
        if (!execution.ok) {
            throw new Error(execution.errorMessage);
        }
        request.onStatus?.(`tool-done:${execution.resultDescription}`);
        return {
            output: execution.toolContent,
            usage: {
                inputTokens: 11,
                outputTokens: 7,
                durationMs: 5,
            },
        };
    }
}
class FailingToolLoopProvider {
    async invoke(request) {
        const execution = await (0, providerToolRuntime_1.executeProviderToolCall)({
            providerId: model_1.PRIMARY_PROVIDER_ID,
            request,
            toolName: 'terminal.exec',
            toolInput: { command: 'false' },
        });
        if (!execution.ok) {
            throw new Error(execution.errorMessage);
        }
        throw new Error('Expected terminal.exec to fail');
    }
}
class SearchCatalogProvider {
    requests = [];
    async invoke(request) {
        this.requests.push(request);
        const execution = await (0, providerToolRuntime_1.executeProviderToolCall)({
            providerId: model_1.PRIMARY_PROVIDER_ID,
            request,
            toolName: 'runtime.search_tools',
            toolInput: { query: 'close browser tab' },
        });
        if (!execution.ok) {
            throw new Error(execution.errorMessage);
        }
        return {
            output: execution.toolContent,
            usage: {
                inputTokens: 5,
                outputTokens: 5,
                durationMs: 5,
            },
        };
    }
}
(0, vitest_1.describe)('AgentRuntime', () => {
    (0, vitest_1.beforeEach)(() => {
        dispatchMock.mockReset();
        recordToolMessageMock.mockReset();
        AgentCache_1.agentCache.clear();
    });
    (0, vitest_1.it)('runs the provider through the shared tool executor path with validation', async () => {
        const tool = {
            name: 'terminal.exec',
            description: 'Run a terminal command',
            inputSchema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    command: { type: 'string' },
                },
                required: ['command'],
            },
            execute: async (input) => ({
                summary: `Ran ${input.command}`,
                data: {
                    output: 'ok',
                    exitCode: 0,
                },
            }),
        };
        const blockedTool = {
            name: 'subagent.list',
            description: 'List sub-agents',
            inputSchema: {
                type: 'object',
                additionalProperties: false,
                properties: {},
            },
            execute: async () => ({
                summary: 'listed',
                data: {},
            }),
        };
        AgentToolExecutor_1.agentToolExecutor.register(tool);
        AgentToolExecutor_1.agentToolExecutor.register(blockedTool);
        const provider = new SuccessfulToolLoopProvider();
        const runtime = new AgentRuntime_1.AgentRuntime(provider);
        const statusUpdates = [];
        const result = await runtime.run({
            mode: 'unrestricted-dev',
            agentId: model_1.PRIMARY_PROVIDER_ID,
            role: 'primary',
            task: 'Run the command and report the validated result.',
            taskId: 'task-runtime-success',
            allowedTools: ['terminal.exec'],
            canSpawnSubagents: false,
            maxToolTurns: 4,
            onStatus: (status) => {
                statusUpdates.push(status);
            },
        });
        (0, vitest_1.expect)(provider.requests).toHaveLength(1);
        (0, vitest_1.expect)(provider.requests[0].maxToolTurns).toBe(4);
        (0, vitest_1.expect)(provider.requests[0].promptTools.map(toolDef => toolDef.name)).toEqual(['terminal.exec']);
        (0, vitest_1.expect)(provider.requests[0].toolBindings).toEqual([
            vitest_1.expect.objectContaining({
                name: 'terminal.exec',
                state: 'callable',
            }),
        ]);
        (0, vitest_1.expect)(result.runId).toBeTruthy();
        (0, vitest_1.expect)(result.output).toContain('"summary":"Ran echo ok"');
        (0, vitest_1.expect)(result.output).toContain('STATUS: VALID');
        (0, vitest_1.expect)(statusUpdates).toEqual(['tool-done:exit 0: ok']);
        (0, vitest_1.expect)(recordToolMessageMock).toHaveBeenCalledWith('task-runtime-success', vitest_1.expect.stringContaining('"tool": "terminal.exec"'), model_1.PRIMARY_PROVIDER_ID, vitest_1.expect.any(String));
        const run = AgentRunStore_1.agentRunStore.getRun(result.runId);
        (0, vitest_1.expect)(run).toMatchObject({
            id: result.runId,
            status: 'completed',
        });
        const toolCalls = AgentRunStore_1.agentRunStore.listToolCalls(result.runId);
        (0, vitest_1.expect)(toolCalls).toHaveLength(1);
        (0, vitest_1.expect)(toolCalls[0]).toMatchObject({
            runId: result.runId,
            agentId: model_1.PRIMARY_PROVIDER_ID,
            toolName: 'terminal.exec',
            status: 'completed',
        });
        (0, vitest_1.expect)(toolCalls[0].output).toMatchObject({
            summary: 'Ran echo ok',
            validation: {
                status: 'VALID',
            },
        });
        (0, vitest_1.expect)(dispatchMock).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            type: 'ADD_LOG',
            log: vitest_1.expect.objectContaining({
                message: vitest_1.expect.stringContaining('toolPayloadTokens='),
            }),
        }));
    });
    (0, vitest_1.it)('marks the runtime run as failed when the provider surfaces a tool failure', async () => {
        const failingTool = {
            name: 'terminal.exec',
            description: 'Run a terminal command',
            inputSchema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    command: { type: 'string' },
                },
                required: ['command'],
            },
            execute: async () => {
                throw new Error('command exploded');
            },
        };
        AgentToolExecutor_1.agentToolExecutor.register(failingTool);
        const runtime = new AgentRuntime_1.AgentRuntime(new FailingToolLoopProvider());
        await (0, vitest_1.expect)(runtime.run({
            mode: 'unrestricted-dev',
            agentId: model_1.PRIMARY_PROVIDER_ID,
            role: 'primary',
            task: 'Run the command and handle the failure.',
            taskId: 'task-runtime-failure',
            allowedTools: ['terminal.exec'],
        })).rejects.toThrow('command exploded');
        (0, vitest_1.expect)(recordToolMessageMock).toHaveBeenCalledWith('task-runtime-failure', vitest_1.expect.stringContaining('"error": "command exploded"'), model_1.PRIMARY_PROVIDER_ID, vitest_1.expect.any(String));
        const failedRun = AgentRunStore_1.agentRunStore.listRuns().find(run => run.task === 'Run the command and handle the failure.');
        (0, vitest_1.expect)(failedRun).toBeTruthy();
        (0, vitest_1.expect)(failedRun).toMatchObject({
            status: 'failed',
            error: 'command exploded',
        });
        const toolCalls = AgentRunStore_1.agentRunStore.listToolCalls(failedRun.id);
        (0, vitest_1.expect)(toolCalls).toHaveLength(1);
        (0, vitest_1.expect)(toolCalls[0]).toMatchObject({
            runId: failedRun.id,
            toolName: 'terminal.exec',
            status: 'failed',
            error: 'command exploded',
        });
    });
    (0, vitest_1.it)('preflight-expands the tool scope before the first provider turn when the task clearly needs adjacent tools', async () => {
        const browserTabsTool = {
            name: 'browser.get_tabs',
            description: 'Return open browser tabs',
            inputSchema: {
                type: 'object',
                additionalProperties: false,
                properties: {},
            },
            execute: async () => ({
                summary: 'Read browser tabs',
                data: { tabs: [{ id: 'tab-1' }] },
            }),
        };
        AgentToolExecutor_1.agentToolExecutor.register(browserTabsTool);
        const provider = {
            requests: [],
            async invoke(request) {
                this.requests.push(request);
                return {
                    output: 'ok',
                    usage: {
                        inputTokens: 1,
                        outputTokens: 1,
                        durationMs: 1,
                    },
                };
            },
        };
        const runtime = new AgentRuntime_1.AgentRuntime(provider);
        await runtime.run({
            mode: 'unrestricted-dev',
            agentId: model_1.PRIMARY_PROVIDER_ID,
            role: 'primary',
            task: 'Close the extra browser tabs and report what remains open.',
            taskId: 'task-runtime-preflight-browser',
            allowedTools: ['runtime.request_tool_pack', 'runtime.list_tool_packs'],
            canSpawnSubagents: false,
            maxToolTurns: 4,
        });
        (0, vitest_1.expect)(provider.requests).toHaveLength(1);
        (0, vitest_1.expect)(provider.requests[0].promptTools.map(toolDef => toolDef.name)).toEqual(vitest_1.expect.arrayContaining([
            'browser.get_tabs',
        ]));
        (0, vitest_1.expect)(provider.requests[0].toolBindings).toEqual(vitest_1.expect.arrayContaining([
            vitest_1.expect.objectContaining({
                name: 'browser.get_tabs',
                state: 'callable',
            }),
        ]));
    });
    (0, vitest_1.it)('preflight-adds browser.create_tab for explicit multi-tab requests even when the baseline scope only has navigate', async () => {
        const browserTools = [
            {
                name: 'browser.get_state',
                description: 'Return current browser state',
                inputSchema: { type: 'object', additionalProperties: false, properties: {} },
                execute: async () => ({ summary: 'state', data: {} }),
            },
            {
                name: 'browser.get_tabs',
                description: 'Return open browser tabs',
                inputSchema: { type: 'object', additionalProperties: false, properties: {} },
                execute: async () => ({ summary: 'tabs', data: { tabs: [] } }),
            },
            {
                name: 'browser.navigate',
                description: 'Navigate the active tab',
                inputSchema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: { url: { type: 'string' } },
                    required: ['url'],
                },
                execute: async () => ({ summary: 'navigated', data: {} }),
            },
            {
                name: 'browser.close_tab',
                description: 'Close a tab',
                inputSchema: { type: 'object', additionalProperties: false, properties: {} },
                execute: async () => ({ summary: 'closed', data: {} }),
            },
            {
                name: 'browser.click',
                description: 'Click an element',
                inputSchema: { type: 'object', additionalProperties: false, properties: {} },
                execute: async () => ({ summary: 'clicked', data: {} }),
            },
            {
                name: 'browser.type',
                description: 'Type into an element',
                inputSchema: { type: 'object', additionalProperties: false, properties: {} },
                execute: async () => ({ summary: 'typed', data: {} }),
            },
            {
                name: 'browser.create_tab',
                description: 'Create a new browser tab',
                inputSchema: { type: 'object', additionalProperties: false, properties: {} },
                execute: async () => ({ summary: 'created', data: {} }),
            },
        ];
        for (const tool of browserTools) {
            AgentToolExecutor_1.agentToolExecutor.register(tool);
        }
        const provider = {
            requests: [],
            async invoke(request) {
                this.requests.push(request);
                return {
                    output: 'ok',
                    usage: {
                        inputTokens: 1,
                        outputTokens: 1,
                        durationMs: 1,
                    },
                };
            },
        };
        const runtime = new AgentRuntime_1.AgentRuntime(provider);
        await runtime.run({
            mode: 'unrestricted-dev',
            agentId: model_1.PRIMARY_PROVIDER_ID,
            role: 'primary',
            task: 'Open three new tabs one for yahoo one for reddit and one for gmail.',
            taskId: 'task-runtime-preflight-create-tab',
            allowedTools: [
                'browser.get_state',
                'browser.get_tabs',
                'browser.close_tab',
                'browser.navigate',
                'browser.click',
                'browser.type',
            ],
            canSpawnSubagents: false,
            maxToolTurns: 4,
        });
        (0, vitest_1.expect)(provider.requests).toHaveLength(1);
        (0, vitest_1.expect)(provider.requests[0].promptTools.map(toolDef => toolDef.name)).toEqual(vitest_1.expect.arrayContaining([
            'browser.create_tab',
        ]));
    });
    (0, vitest_1.it)('hard-fails browser tasks when the initial tool scope exposes no browser tools', () => {
        (0, vitest_1.expect)(() => (0, AgentRuntime_1.assertInitialBrowserScope)('Search the web for the latest browser tool issue and summarize it.', ['runtime.request_tool_pack', 'runtime.list_tool_packs', 'filesystem.read'])).toThrow('Browser task blocked: initial MCP tool scope for research did not expose any browser.* tools.');
    });
    (0, vitest_1.it)('keeps a broader hydratable catalog than the current callable scope when configured', async () => {
        AgentToolExecutor_1.agentToolExecutor.registerMany((0, runtimeTools_1.createRuntimeToolDefinitions)());
        AgentToolExecutor_1.agentToolExecutor.register({
            name: 'browser.close_tab',
            description: 'Close one browser tab',
            inputSchema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    tabId: { type: 'string' },
                },
                required: ['tabId'],
            },
            execute: async () => ({
                summary: 'Closed one tab',
                data: { closedTabId: 'tab-2' },
            }),
        });
        const provider = new SearchCatalogProvider();
        const runtime = new AgentRuntime_1.AgentRuntime(provider);
        const result = await runtime.run({
            mode: 'unrestricted-dev',
            agentId: model_1.PRIMARY_PROVIDER_ID,
            role: 'primary',
            task: 'Inspect the runtime registry for an exact missing tool name.',
            taskId: 'task-runtime-hydratable-catalog',
            allowedTools: ['runtime.search_tools'],
            hydratableTools: ['runtime.search_tools', 'browser.close_tab'],
            restrictToolCatalogToAllowedTools: true,
            canSpawnSubagents: false,
            maxToolTurns: 4,
        });
        (0, vitest_1.expect)(provider.requests).toHaveLength(1);
        (0, vitest_1.expect)(provider.requests[0].promptTools.map(toolDef => toolDef.name)).toEqual(['runtime.search_tools']);
        (0, vitest_1.expect)(provider.requests[0].toolCatalog.map(toolDef => toolDef.name)).toEqual(vitest_1.expect.arrayContaining([
            'runtime.search_tools',
            'browser.close_tab',
        ]));
        (0, vitest_1.expect)(provider.requests[0].toolCatalog).toHaveLength(2);
        (0, vitest_1.expect)(result.output).toContain('browser.close_tab');
    });
});
//# sourceMappingURL=AgentRuntime.test.js.map