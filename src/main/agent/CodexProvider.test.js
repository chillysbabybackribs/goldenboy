"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const stream_1 = require("stream");
const events_1 = require("events");
const vitest_1 = require("vitest");
const model_1 = require("../../shared/types/model");
const { spawnMock, spawnSyncMock, executeMock, recordToolMessageMock } = vitest_1.vi.hoisted(() => ({
    spawnMock: vitest_1.vi.fn(),
    spawnSyncMock: vitest_1.vi.fn(() => ({ status: 0, stdout: 'codex-cli 0.120.0', stderr: '' })),
    executeMock: vitest_1.vi.fn(),
    recordToolMessageMock: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('child_process', () => ({
    spawn: spawnMock,
    spawnSync: spawnSyncMock,
}));
vitest_1.vi.mock('./AgentToolExecutor', () => ({
    agentToolExecutor: {
        execute: executeMock,
    },
}));
vitest_1.vi.mock('../chatKnowledge/ChatKnowledgeStore', () => ({
    chatKnowledgeStore: {
        recordToolMessage: recordToolMessageMock,
    },
}));
const CodexProvider_1 = require("./CodexProvider");
function createMockChildProcess() {
    const child = new events_1.EventEmitter();
    child.stdin = new stream_1.PassThrough();
    const stdinChunks = [];
    child.stdin.on('data', (chunk) => {
        stdinChunks.push(Buffer.from(chunk));
    });
    child.stdout = new stream_1.PassThrough();
    child.stderr = new stream_1.PassThrough();
    child.kill = vitest_1.vi.fn(() => {
        child.emit('close', null);
        return true;
    });
    child.readStdinText = () => Buffer.concat(stdinChunks).toString('utf8');
    return child;
}
async function completeTurn(child, message, usage = { input: 12, output: 3 }) {
    await new Promise((resolve) => {
        setTimeout(() => {
            child.stdout.write(`{"type":"item.completed","item":{"id":"item-${Math.random()}","type":"agent_message","text":${JSON.stringify(message)}}}\n`);
            child.stdout.write(`{"type":"turn.completed","usage":{"input_tokens":${usage.input},"cached_input_tokens":0,"output_tokens":${usage.output}}}\n`);
            child.stdout.end();
            child.emit('close', 0);
            resolve();
        }, 0);
    });
}
function buildRequest(overrides = {}) {
    const request = {
        runId: 'run-1',
        agentId: model_1.PRIMARY_PROVIDER_ID,
        mode: 'unrestricted-dev',
        taskId: 'task-1',
        systemPrompt: 'You are a helpful assistant.',
        task: 'What is 2 + 2?',
        contextPrompt: '',
        promptTools: [],
        toolCatalog: [],
        toolBindings: [],
        maxToolTurns: 2,
        ...overrides,
    };
    request.toolCatalog = overrides.toolCatalog ?? request.promptTools;
    request.toolBindings = overrides.toolBindings
        ?? request.promptTools.map((tool) => ({ ...tool, state: 'callable' }));
    return request;
}
(0, vitest_1.describe)('CodexProvider', () => {
    (0, vitest_1.beforeEach)(() => {
        spawnMock.mockReset();
        spawnSyncMock.mockClear();
        executeMock.mockReset();
        recordToolMessageMock.mockReset();
    });
    (0, vitest_1.it)('reports Codex CLI availability', () => {
        (0, vitest_1.expect)(CodexProvider_1.CodexProvider.isAvailable()).toEqual({ available: true });
        (0, vitest_1.expect)(spawnSyncMock).toHaveBeenCalledWith('codex', ['--version'], vitest_1.expect.objectContaining({
            cwd: process.cwd(),
            encoding: 'utf8',
        }));
    });
    (0, vitest_1.it)('routes tool requests through the V2 tool executor', async () => {
        const toolTurn = createMockChildProcess();
        const finalTurn = createMockChildProcess();
        spawnMock
            .mockReturnValueOnce(toolTurn)
            .mockReturnValueOnce(finalTurn);
        executeMock.mockResolvedValue({
            summary: 'Listed 3 files',
            data: { entries: ['a.ts', 'b.ts', 'c.ts'] },
        });
        const itemEvents = [];
        const tokens = [];
        const provider = new CodexProvider_1.CodexProvider({ providerId: model_1.PRIMARY_PROVIDER_ID, modelId: model_1.PRIMARY_PROVIDER_ID });
        const resultPromise = provider.invoke(buildRequest({
            task: 'Inspect the workspace and answer.',
            promptTools: [
                {
                    name: 'filesystem.list',
                    description: 'List a directory',
                    inputSchema: {
                        type: 'object',
                        additionalProperties: false,
                        properties: { path: { type: 'string' } },
                        required: ['path'],
                    },
                },
            ],
            onItem: ({ item, eventType }) => {
                itemEvents.push({
                    eventType,
                    type: item.type,
                    tool: item.type === 'mcp_tool_call' ? item.tool : undefined,
                });
            },
            onToken: (text) => {
                tokens.push(text);
            },
        }));
        await completeTurn(toolTurn, JSON.stringify({
            kind: 'tool_calls',
            tool_calls: [
                {
                    name: 'filesystem.list',
                    arguments_json: '{"path":"."}',
                },
            ],
            message: 'Checking the workspace root.',
        }));
        await completeTurn(finalTurn, JSON.stringify({
            kind: 'final',
            tool_calls: [],
            message: 'Found the files.',
        }));
        const result = await resultPromise;
        (0, vitest_1.expect)(spawnMock).toHaveBeenNthCalledWith(1, 'codex', vitest_1.expect.arrayContaining([
            'exec',
            '--json',
            '--model',
            model_1.PRIMARY_PROVIDER_ID,
            '-c',
            'web_search="disabled"',
            '--dangerously-bypass-approvals-and-sandbox',
            '--output-schema',
        ]), vitest_1.expect.objectContaining({
            cwd: process.cwd(),
            stdio: ['pipe', 'pipe', 'pipe'],
        }));
        (0, vitest_1.expect)(executeMock).toHaveBeenCalledWith('filesystem.list', { path: '.' }, vitest_1.expect.objectContaining({
            runId: 'run-1',
            agentId: model_1.PRIMARY_PROVIDER_ID,
            mode: 'unrestricted-dev',
            taskId: 'task-1',
        }));
        (0, vitest_1.expect)(recordToolMessageMock).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(tokens).toEqual(['Found the files.']);
        (0, vitest_1.expect)(itemEvents).toEqual([
            { eventType: 'item.started', type: 'mcp_tool_call', tool: 'filesystem.list' },
            { eventType: 'item.completed', type: 'mcp_tool_call', tool: 'filesystem.list' },
            { eventType: 'item.completed', type: 'agent_message', tool: undefined },
        ]);
        (0, vitest_1.expect)(result).toEqual({
            output: 'Found the files.',
            codexItems: [
                vitest_1.expect.objectContaining({
                    type: 'mcp_tool_call',
                    tool: 'filesystem.list',
                    status: 'completed',
                }),
                {
                    id: vitest_1.expect.any(String),
                    type: 'agent_message',
                    text: 'Found the files.',
                },
            ],
            usage: {
                inputTokens: 24,
                outputTokens: 6,
                durationMs: vitest_1.expect.any(Number),
            },
        });
    });
    (0, vitest_1.it)('returns a final response directly when no tools are available', async () => {
        const child = createMockChildProcess();
        spawnMock.mockReturnValue(child);
        const provider = new CodexProvider_1.CodexProvider();
        const resultPromise = provider.invoke(buildRequest());
        await completeTurn(child, JSON.stringify({
            kind: 'final',
            tool_calls: [],
            message: '4',
        }));
        await (0, vitest_1.expect)(resultPromise).resolves.toEqual({
            output: '4',
            codexItems: [
                {
                    id: vitest_1.expect.any(String),
                    type: 'agent_message',
                    text: '4',
                },
            ],
            usage: {
                inputTokens: 12,
                outputTokens: 3,
                durationMs: vitest_1.expect.any(Number),
            },
        });
        (0, vitest_1.expect)(executeMock).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('disables native web_search in exec mode', async () => {
        const child = createMockChildProcess();
        spawnMock.mockReturnValue(child);
        const provider = new CodexProvider_1.CodexProvider();
        const resultPromise = provider.invoke(buildRequest());
        await completeTurn(child, JSON.stringify({
            kind: 'final',
            tool_calls: [],
            message: '4',
        }));
        await resultPromise;
        (0, vitest_1.expect)(spawnMock).toHaveBeenCalledWith('codex', vitest_1.expect.arrayContaining([
            'exec',
            '-c',
            'web_search="disabled"',
        ]), vitest_1.expect.any(Object));
    });
    (0, vitest_1.it)('compacts tool schemas in the planning prompt', async () => {
        const child = createMockChildProcess();
        spawnMock.mockReturnValue(child);
        const provider = new CodexProvider_1.CodexProvider();
        const resultPromise = provider.invoke(buildRequest({
            task: 'Inspect the workspace and answer.',
            promptTools: [
                {
                    name: 'filesystem.list',
                    description: 'List a directory with a deliberately long description that should be compacted before being sent through the per-turn planning prompt.',
                    inputSchema: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            path: { type: 'string' },
                            includeHidden: { type: 'boolean' },
                            recursive: { type: 'boolean' },
                        },
                        required: ['path'],
                    },
                },
            ],
        }));
        await completeTurn(child, JSON.stringify({
            kind: 'final',
            tool_calls: [],
            message: 'Done.',
        }));
        await resultPromise;
        const promptText = child.readStdinText();
        (0, vitest_1.expect)(promptText).toContain('Input schema: {"type":"object"');
        (0, vitest_1.expect)(promptText).not.toContain('Input schema: {\n');
        (0, vitest_1.expect)(promptText).toContain('# Prior Turn History');
        (0, vitest_1.expect)(promptText).toContain('keep message empty unless you need a short blocker, clarification request, or material state-change note');
    });
    (0, vitest_1.it)('expands the active tool scope after requesting a tool pack', async () => {
        const expandTurn = createMockChildProcess();
        const workTurn = createMockChildProcess();
        const finalTurn = createMockChildProcess();
        spawnMock
            .mockReturnValueOnce(expandTurn)
            .mockReturnValueOnce(workTurn)
            .mockReturnValueOnce(finalTurn);
        executeMock
            .mockResolvedValueOnce({
            summary: 'Requested tool pack: implementation',
            data: {
                pack: 'implementation',
                description: 'Local code reading, editing, and build execution.',
                tools: ['filesystem.list'],
                scope: 'named',
                relatedPackIds: ['file-edit'],
            },
        })
            .mockResolvedValueOnce({
            summary: 'Listed 2 files',
            data: { entries: ['a.ts', 'b.ts'] },
        });
        const provider = new CodexProvider_1.CodexProvider({ providerId: model_1.PRIMARY_PROVIDER_ID, modelId: model_1.PRIMARY_PROVIDER_ID });
        const resultPromise = provider.invoke(buildRequest({
            task: 'Load the needed tools, inspect the workspace, and answer.',
            promptTools: [
                {
                    name: 'runtime.request_tool_pack',
                    description: 'Request a tool pack.',
                    inputSchema: {
                        type: 'object',
                        additionalProperties: false,
                        properties: { pack: { type: 'string' } },
                        required: ['pack'],
                    },
                },
            ],
            toolCatalog: [
                {
                    name: 'runtime.request_tool_pack',
                    description: 'Request a tool pack.',
                    inputSchema: {
                        type: 'object',
                        additionalProperties: false,
                        properties: { pack: { type: 'string' } },
                        required: ['pack'],
                    },
                },
                {
                    name: 'filesystem.list',
                    description: 'List a directory',
                    inputSchema: {
                        type: 'object',
                        additionalProperties: false,
                        properties: { path: { type: 'string' } },
                        required: ['path'],
                    },
                },
            ],
        }));
        await completeTurn(expandTurn, JSON.stringify({
            kind: 'tool_calls',
            tool_calls: [
                {
                    name: 'runtime.request_tool_pack',
                    arguments_json: '{"pack":"implementation"}',
                },
            ],
            message: 'Need the implementation pack.',
        }));
        await completeTurn(workTurn, JSON.stringify({
            kind: 'tool_calls',
            tool_calls: [
                {
                    name: 'filesystem.list',
                    arguments_json: '{"path":"."}',
                },
            ],
            message: 'Now listing the workspace.',
        }));
        await completeTurn(finalTurn, JSON.stringify({
            kind: 'final',
            tool_calls: [],
            message: 'Expansion worked.',
        }));
        const result = await resultPromise;
        (0, vitest_1.expect)(executeMock).toHaveBeenNthCalledWith(1, 'runtime.request_tool_pack', { pack: 'implementation' }, vitest_1.expect.any(Object));
        (0, vitest_1.expect)(executeMock).toHaveBeenNthCalledWith(2, 'filesystem.list', { path: '.' }, vitest_1.expect.any(Object));
        (0, vitest_1.expect)(result.output).toBe('Expansion worked.');
    });
    (0, vitest_1.it)('hydrates exact tools returned from runtime.search_tools without loading a whole pack', async () => {
        const searchTurn = createMockChildProcess();
        const workTurn = createMockChildProcess();
        const finalTurn = createMockChildProcess();
        spawnMock
            .mockReturnValueOnce(searchTurn)
            .mockReturnValueOnce(workTurn)
            .mockReturnValueOnce(finalTurn);
        executeMock
            .mockResolvedValueOnce({
            summary: 'Found 2 tool matches for "close browser tabs"',
            data: {
                query: 'close browser tabs',
                matches: [
                    {
                        name: 'browser.close_tab',
                        description: 'Close one browser tab',
                        category: 'browser',
                        relatedPackIds: ['browser-automation'],
                        alreadyLoaded: false,
                        reason: 'tool name contains the query',
                    },
                    {
                        name: 'browser.get_tabs',
                        description: 'List the currently open browser tabs',
                        category: 'browser',
                        relatedPackIds: ['browser-automation'],
                        alreadyLoaded: false,
                        reason: 'description matches "tabs"',
                    },
                ],
                tools: ['browser.close_tab', 'browser.get_tabs'],
                suggestedPackIds: ['browser-automation'],
            },
        })
            .mockResolvedValueOnce({
            summary: 'Closed one tab',
            data: { closedTabId: 'tab-2' },
        });
        const provider = new CodexProvider_1.CodexProvider({ providerId: model_1.PRIMARY_PROVIDER_ID, modelId: model_1.PRIMARY_PROVIDER_ID });
        const resultPromise = provider.invoke(buildRequest({
            task: 'Close the extra browser tabs and answer.',
            maxToolTurns: 3,
            promptTools: [
                {
                    name: 'runtime.search_tools',
                    description: 'Search the tool catalog.',
                    inputSchema: {
                        type: 'object',
                        additionalProperties: false,
                        properties: { query: { type: 'string' } },
                        required: ['query'],
                    },
                },
            ],
            toolCatalog: [
                {
                    name: 'runtime.search_tools',
                    description: 'Search the tool catalog.',
                    inputSchema: {
                        type: 'object',
                        additionalProperties: false,
                        properties: { query: { type: 'string' } },
                        required: ['query'],
                    },
                },
                {
                    name: 'browser.get_tabs',
                    description: 'List the currently open browser tabs',
                    inputSchema: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {},
                    },
                },
                {
                    name: 'browser.close_tab',
                    description: 'Close one browser tab',
                    inputSchema: {
                        type: 'object',
                        additionalProperties: false,
                        properties: { tabId: { type: 'string' } },
                        required: ['tabId'],
                    },
                },
            ],
        }));
        await completeTurn(searchTurn, JSON.stringify({
            kind: 'tool_calls',
            tool_calls: [
                {
                    name: 'runtime.search_tools',
                    arguments_json: '{"query":"close browser tabs"}',
                },
            ],
            message: 'Searching for the exact browser tab tools first.',
        }));
        await completeTurn(workTurn, JSON.stringify({
            kind: 'tool_calls',
            tool_calls: [
                {
                    name: 'browser.close_tab',
                    arguments_json: '{"tabId":"tab-2"}',
                },
            ],
            message: 'Closing the extra tab now.',
        }));
        await completeTurn(finalTurn, JSON.stringify({
            kind: 'final',
            tool_calls: [],
            message: 'Only one browser tab remains open.',
        }));
        const result = await resultPromise;
        (0, vitest_1.expect)(executeMock).toHaveBeenNthCalledWith(1, 'runtime.search_tools', { query: 'close browser tabs' }, vitest_1.expect.any(Object));
        (0, vitest_1.expect)(executeMock).toHaveBeenNthCalledWith(2, 'browser.close_tab', { tabId: 'tab-2' }, vitest_1.expect.any(Object));
        (0, vitest_1.expect)(result.output).toBe('Only one browser tab remains open.');
    });
    (0, vitest_1.it)('does not allow newly hydrated tools to execute until the next turn', async () => {
        const searchTurn = createMockChildProcess();
        const followupTurn = createMockChildProcess();
        const finalTurn = createMockChildProcess();
        spawnMock
            .mockReturnValueOnce(searchTurn)
            .mockReturnValueOnce(followupTurn)
            .mockReturnValueOnce(finalTurn);
        executeMock
            .mockResolvedValueOnce({
            summary: 'Found 1 tool match for "close browser tab"',
            data: {
                query: 'close browser tab',
                matches: [
                    {
                        name: 'browser.close_tab',
                        description: 'Close one browser tab',
                        category: 'browser',
                        relatedPackIds: ['browser-automation'],
                        bindingState: 'discoverable',
                        callableNow: false,
                        availableNextTurn: true,
                        reason: 'tool name contains the query',
                    },
                ],
                tools: ['browser.close_tab'],
                suggestedPackIds: ['browser-automation'],
                hydration: {
                    callableNow: [],
                    availableNextTurn: ['browser.close_tab'],
                    failed: [],
                },
            },
        })
            .mockResolvedValueOnce({
            summary: 'Closed one tab',
            data: { closedTabId: 'tab-2' },
        });
        const provider = new CodexProvider_1.CodexProvider({ providerId: model_1.PRIMARY_PROVIDER_ID, modelId: model_1.PRIMARY_PROVIDER_ID });
        const resultPromise = provider.invoke(buildRequest({
            task: 'Search for the close tab tool, then close the extra browser tab.',
            maxToolTurns: 3,
            promptTools: [
                {
                    name: 'runtime.search_tools',
                    description: 'Search the tool catalog.',
                    inputSchema: {
                        type: 'object',
                        additionalProperties: false,
                        properties: { query: { type: 'string' } },
                        required: ['query'],
                    },
                },
            ],
            toolCatalog: [
                {
                    name: 'runtime.search_tools',
                    description: 'Search the tool catalog.',
                    inputSchema: {
                        type: 'object',
                        additionalProperties: false,
                        properties: { query: { type: 'string' } },
                        required: ['query'],
                    },
                },
                {
                    name: 'browser.close_tab',
                    description: 'Close one browser tab',
                    inputSchema: {
                        type: 'object',
                        additionalProperties: false,
                        properties: { tabId: { type: 'string' } },
                        required: ['tabId'],
                    },
                },
            ],
        }));
        await completeTurn(searchTurn, JSON.stringify({
            kind: 'tool_calls',
            tool_calls: [
                {
                    name: 'runtime.search_tools',
                    arguments_json: '{"query":"close browser tab"}',
                },
                {
                    name: 'browser.close_tab',
                    arguments_json: '{"tabId":"tab-2"}',
                },
            ],
            message: 'Searching for the exact tab tool and then closing it.',
        }));
        await completeTurn(followupTurn, JSON.stringify({
            kind: 'tool_calls',
            tool_calls: [
                {
                    name: 'browser.close_tab',
                    arguments_json: '{"tabId":"tab-2"}',
                },
            ],
            message: 'Now the close-tab tool is available.',
        }));
        await completeTurn(finalTurn, JSON.stringify({
            kind: 'final',
            tool_calls: [],
            message: 'The extra tab was closed on the follow-up turn.',
        }));
        const result = await resultPromise;
        (0, vitest_1.expect)(executeMock).toHaveBeenCalledTimes(2);
        (0, vitest_1.expect)(executeMock).toHaveBeenNthCalledWith(1, 'runtime.search_tools', { query: 'close browser tab' }, vitest_1.expect.any(Object));
        (0, vitest_1.expect)(executeMock).toHaveBeenNthCalledWith(2, 'browser.close_tab', { tabId: 'tab-2' }, vitest_1.expect.any(Object));
        (0, vitest_1.expect)(result.output).toBe('The extra tab was closed on the follow-up turn.');
    });
    (0, vitest_1.it)('auto-expands a related tool pack when the model says the current scope is missing browser tools', async () => {
        const blockedTurn = createMockChildProcess();
        const workTurn = createMockChildProcess();
        const finalTurn = createMockChildProcess();
        spawnMock
            .mockReturnValueOnce(blockedTurn)
            .mockReturnValueOnce(workTurn)
            .mockReturnValueOnce(finalTurn);
        executeMock.mockResolvedValueOnce({
            summary: 'Read browser tabs',
            data: { tabs: [{ id: 'tab-1' }, { id: 'tab-2' }] },
        });
        const provider = new CodexProvider_1.CodexProvider({ providerId: model_1.PRIMARY_PROVIDER_ID, modelId: model_1.PRIMARY_PROVIDER_ID });
        const resultPromise = provider.invoke(buildRequest({
            task: 'Close the extra browser tabs and tell me what remains open.',
            maxToolTurns: 3,
            promptTools: [
                {
                    name: 'runtime.request_tool_pack',
                    description: 'Request a tool pack.',
                    inputSchema: {
                        type: 'object',
                        additionalProperties: false,
                        properties: { pack: { type: 'string' } },
                        required: ['pack'],
                    },
                },
                {
                    name: 'runtime.list_tool_packs',
                    description: 'List tool packs.',
                    inputSchema: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {},
                    },
                },
            ],
            toolCatalog: [
                {
                    name: 'runtime.request_tool_pack',
                    description: 'Request a tool pack.',
                    inputSchema: {
                        type: 'object',
                        additionalProperties: false,
                        properties: { pack: { type: 'string' } },
                        required: ['pack'],
                    },
                },
                {
                    name: 'runtime.list_tool_packs',
                    description: 'List tool packs.',
                    inputSchema: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {},
                    },
                },
                {
                    name: 'browser.get_tabs',
                    description: 'Return open browser tabs.',
                    inputSchema: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {},
                    },
                },
            ],
        }));
        await completeTurn(blockedTurn, JSON.stringify({
            kind: 'final',
            tool_calls: [],
            message: 'I cannot continue because the current scope does not have browser tab tools.',
        }));
        await completeTurn(workTurn, JSON.stringify({
            kind: 'tool_calls',
            tool_calls: [
                {
                    name: 'browser.get_tabs',
                    arguments_json: '{}',
                },
            ],
            message: 'Now checking the current browser tabs.',
        }));
        await completeTurn(finalTurn, JSON.stringify({
            kind: 'final',
            tool_calls: [],
            message: 'Two tabs remain open.',
        }));
        const result = await resultPromise;
        (0, vitest_1.expect)(executeMock).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(executeMock).toHaveBeenCalledWith('browser.get_tabs', {}, vitest_1.expect.any(Object));
        (0, vitest_1.expect)(result.output).toBe('Two tabs remain open.');
    });
    (0, vitest_1.it)('aborts an active Codex process', () => {
        const child = createMockChildProcess();
        spawnMock.mockReturnValue(child);
        const provider = new CodexProvider_1.CodexProvider();
        const promise = provider.invoke(buildRequest()).catch((error) => error);
        provider.abort();
        (0, vitest_1.expect)(child.kill).toHaveBeenCalledTimes(1);
        return (0, vitest_1.expect)(promise).resolves.toBeInstanceOf(Error);
    });
});
//# sourceMappingURL=CodexProvider.test.js.map