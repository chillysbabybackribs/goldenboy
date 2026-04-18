"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const model_1 = require("../../shared/types/model");
const { executeMock, recordToolMessageMock } = vitest_1.vi.hoisted(() => ({
    executeMock: vitest_1.vi.fn(),
    recordToolMessageMock: vitest_1.vi.fn(),
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
const providerToolRuntime_1 = require("./providerToolRuntime");
const toolBindingScope_1 = require("./toolBindingScope");
(0, vitest_1.describe)('providerToolRuntime', () => {
    (0, vitest_1.beforeEach)(() => {
        executeMock.mockReset();
        recordToolMessageMock.mockReset();
    });
    (0, vitest_1.it)('normalizes provider max tool turns to runtime bounds', () => {
        (0, vitest_1.expect)((0, providerToolRuntime_1.normalizeProviderMaxToolTurns)()).toBe(20);
        (0, vitest_1.expect)((0, providerToolRuntime_1.normalizeProviderMaxToolTurns)(0)).toBe(1);
        (0, vitest_1.expect)((0, providerToolRuntime_1.normalizeProviderMaxToolTurns)(999)).toBe(40);
    });
    (0, vitest_1.it)('formats successful tool results and records tool memory', async () => {
        executeMock.mockResolvedValue({
            summary: 'Listed 3 files',
            data: { entries: ['a.ts', 'b.ts', 'c.ts'] },
            validation: {
                status: 'VALID',
                constraints: [
                    {
                        name: 'example_constraint',
                        status: 'PASS',
                        observed: 'ok',
                    },
                ],
                summary: 'all constraints passed',
            },
        });
        const result = await (0, providerToolRuntime_1.executeProviderToolCall)({
            providerId: model_1.PRIMARY_PROVIDER_ID,
            request: {
                runId: 'run-1',
                agentId: model_1.PRIMARY_PROVIDER_ID,
                mode: 'unrestricted-dev',
                taskId: 'task-1',
                promptTools: [],
                toolCatalog: [],
                toolBindings: [],
            },
            toolName: 'filesystem.list',
            toolInput: { path: '.' },
        });
        (0, vitest_1.expect)(result.ok).toBe(true);
        if (!result.ok)
            throw new Error('expected successful tool execution');
        (0, vitest_1.expect)(result.resultDescription).toBe('Listed 3 files');
        (0, vitest_1.expect)(result.toolContent).toContain('Listed 3 files');
        (0, vitest_1.expect)(result.toolContent).toContain('RUNTIME VALIDATION');
        (0, vitest_1.expect)(recordToolMessageMock).toHaveBeenCalledWith('task-1', vitest_1.expect.stringContaining('"tool": "filesystem.list"'), model_1.PRIMARY_PROVIDER_ID, 'run-1');
    });
    (0, vitest_1.it)('queues searched tools through the shared binding store helper', () => {
        const toolBindingStore = (0, toolBindingScope_1.createToolBindingStore)([
            { name: 'runtime.search_tools', description: 'Search tools', inputSchema: {} },
        ], [
            { name: 'runtime.search_tools', description: 'Search tools', inputSchema: {} },
            { name: 'browser.close_tab', description: 'Close a browser tab', inputSchema: {} },
        ]);
        const expansion = (0, providerToolRuntime_1.applyRuntimeToolExpansion)({
            request: {
                toolCatalog: [
                    { name: 'runtime.search_tools', description: 'Search tools', inputSchema: {} },
                    { name: 'browser.close_tab', description: 'Close a browser tab', inputSchema: {} },
                ],
            },
            toolBindingStore,
            toolName: 'runtime.search_tools',
            result: {
                summary: 'Found tools',
                data: {
                    tools: ['browser.close_tab'],
                },
            },
        });
        (0, vitest_1.expect)(expansion).toMatchObject({
            pack: 'tool-search',
            tools: ['browser.close_tab'],
        });
        (0, vitest_1.expect)(toolBindingStore.getCallableTools().map((tool) => tool.name)).toEqual(['runtime.search_tools']);
        (0, vitest_1.expect)(toolBindingStore.beginTurn().map((tool) => tool.name)).toEqual([
            'runtime.search_tools',
            'browser.close_tab',
        ]);
    });
    (0, vitest_1.it)('queues auto-expanded packs through the shared binding store helper', () => {
        const toolBindingStore = (0, toolBindingScope_1.createToolBindingStore)([
            { name: 'runtime.request_tool_pack', description: 'Load a tool pack', inputSchema: {} },
        ], [
            { name: 'runtime.request_tool_pack', description: 'Load a tool pack', inputSchema: {} },
            { name: 'browser.get_tabs', description: 'Get browser tabs', inputSchema: {} },
        ]);
        const expansion = (0, providerToolRuntime_1.applyAutoExpandedToolPack)({
            message: [
                'The current tool scope is missing browser interaction capability.',
                'I cannot continue without browser tab tools.',
            ].join('\n'),
            toolCatalog: [
                { name: 'runtime.request_tool_pack', description: 'Load a tool pack', inputSchema: {} },
                { name: 'browser.get_tabs', description: 'Get browser tabs', inputSchema: {} },
            ],
            toolBindingStore,
        });
        (0, vitest_1.expect)(expansion).toMatchObject({
            pack: 'browser-automation',
            tools: ['browser.get_tabs'],
        });
        (0, vitest_1.expect)(toolBindingStore.getCallableTools().map((tool) => tool.name)).toEqual(['runtime.request_tool_pack']);
        (0, vitest_1.expect)(toolBindingStore.beginTurn().map((tool) => tool.name)).toEqual([
            'runtime.request_tool_pack',
            'browser.get_tabs',
        ]);
    });
    (0, vitest_1.it)('formats queued expansion notes consistently for provider transcripts', () => {
        (0, vitest_1.expect)((0, providerToolRuntime_1.formatQueuedExpansionLines)({
            pack: 'tool-search',
            description: 'Loaded 1 searched tools',
            scope: 'named',
            tools: ['browser.close_tab'],
            relatedPackIds: [],
        }, { style: 'codex' })).toEqual([
            'Result: queued searched tools for the next turn',
            'Description: Loaded 1 searched tools',
            'Expanded tools: browser.close_tab',
            'Callable now: none newly added in this turn',
            'Callable next turn: browser.close_tab',
        ]);
        (0, vitest_1.expect)((0, providerToolRuntime_1.formatQueuedExpansionLines)({
            pack: 'research',
            description: 'Research tools',
            scope: 'named',
            tools: ['browser.research_search'],
            relatedPackIds: [],
        }, { style: 'haiku' })[0]).toBe('Queued tool pack "research" for the next turn.');
    });
    (0, vitest_1.it)('formats auto-expanded pack notes consistently for provider prompts', () => {
        (0, vitest_1.expect)((0, providerToolRuntime_1.formatAutoExpandedToolPackLines)({
            pack: 'browser-automation',
            reason: 'message referenced missing browser interaction capability',
            description: 'Browser automation tools',
            scope: 'named',
            tools: ['browser.get_tabs'],
            relatedPackIds: [],
        }, { includeCallableStatus: true, continueInstruction: true })).toEqual([
            'Host auto-expanded tool pack "browser-automation".',
            'Reason: message referenced missing browser interaction capability',
            'Description: Browser automation tools',
            'Expanded tools: browser.get_tabs',
            'Callable now: none newly added in this turn',
            'Callable next turn: browser.get_tabs',
            'Continue with the expanded tool scope instead of stopping if more work is still needed.',
        ]);
    });
    (0, vitest_1.it)('enriches filesystem list summaries with entry previews', async () => {
        executeMock.mockResolvedValue({
            summary: 'Listed 3 entries',
            data: {
                entries: [
                    { name: 'README.md' },
                    { name: 'docs' },
                    { name: 'src' },
                ],
            },
        });
        const result = await (0, providerToolRuntime_1.executeProviderToolCall)({
            providerId: model_1.PRIMARY_PROVIDER_ID,
            request: {
                runId: 'run-fs',
                agentId: model_1.PRIMARY_PROVIDER_ID,
                mode: 'unrestricted-dev',
                taskId: 'task-fs',
                promptTools: [],
                toolCatalog: [],
                toolBindings: [],
            },
            toolName: 'filesystem.list',
            toolInput: { path: '.' },
        });
        (0, vitest_1.expect)(result.ok).toBe(true);
        if (!result.ok)
            throw new Error('expected successful tool execution');
        (0, vitest_1.expect)(result.resultDescription).toContain('README.md');
        (0, vitest_1.expect)(result.resultDescription).toContain('docs');
    });
    (0, vitest_1.it)('enriches terminal summaries with the first output line', async () => {
        executeMock.mockResolvedValue({
            summary: 'Executed command: npm test (exit 0)',
            data: {
                exitCode: 0,
                output: '\n142 tests passed\nall green\n',
            },
        });
        const result = await (0, providerToolRuntime_1.executeProviderToolCall)({
            providerId: model_1.PRIMARY_PROVIDER_ID,
            request: {
                runId: 'run-term',
                agentId: model_1.PRIMARY_PROVIDER_ID,
                mode: 'unrestricted-dev',
                taskId: 'task-term',
                promptTools: [],
                toolCatalog: [],
                toolBindings: [],
            },
            toolName: 'terminal.exec',
            toolInput: { command: 'npm test' },
        });
        (0, vitest_1.expect)(result.ok).toBe(true);
        if (!result.ok)
            throw new Error('expected successful tool execution');
        (0, vitest_1.expect)(result.resultDescription).toBe('exit 0: 142 tests passed');
    });
    (0, vitest_1.it)('enriches browser research summaries with opened-page previews', async () => {
        executeMock.mockResolvedValue({
            summary: 'Searched "claude code reddit", found 8 results, opened 2 page(s)',
            data: {
                searchResults: [
                    { title: 'Claude Code on Reddit', url: 'https://reddit.com/r/ClaudeAI/1' },
                    { title: 'Best Claude Code workflows', url: 'https://reddit.com/r/LocalLLaMA/2' },
                ],
                openedPages: [
                    { title: 'Claude Code on Reddit', url: 'https://reddit.com/r/ClaudeAI/1' },
                    { title: 'Best Claude Code workflows', url: 'https://reddit.com/r/LocalLLaMA/2' },
                ],
            },
        });
        const result = await (0, providerToolRuntime_1.executeProviderToolCall)({
            providerId: model_1.PRIMARY_PROVIDER_ID,
            request: {
                runId: 'run-browser',
                agentId: model_1.PRIMARY_PROVIDER_ID,
                mode: 'unrestricted-dev',
                taskId: 'task-browser',
                promptTools: [],
                toolCatalog: [],
                toolBindings: [],
            },
            toolName: 'browser.research_search',
            toolInput: { query: 'claude code reddit' },
        });
        (0, vitest_1.expect)(result.ok).toBe(true);
        if (!result.ok)
            throw new Error('expected successful tool execution');
        (0, vitest_1.expect)(result.resultDescription).toContain('Claude Code on Reddit');
        (0, vitest_1.expect)(result.resultDescription).toContain('Best Claude Code workflows');
    });
    (0, vitest_1.it)('emits status and item lifecycle events around tool execution', async () => {
        executeMock.mockResolvedValue({
            summary: 'Listed 3 files',
            data: { entries: ['a.ts', 'b.ts', 'c.ts'] },
        });
        const statusUpdates = [];
        const itemEvents = [];
        const result = await (0, providerToolRuntime_1.executeProviderToolCallWithEvents)({
            providerId: model_1.HAIKU_PROVIDER_ID,
            request: {
                runId: 'run-3',
                agentId: model_1.HAIKU_PROVIDER_ID,
                mode: 'unrestricted-dev',
                taskId: 'task-3',
                systemPrompt: 'system',
                task: 'task',
                promptTools: [],
                toolCatalog: [],
                toolBindings: [],
                onStatus: (status) => {
                    statusUpdates.push(status);
                },
                onItem: ({ item, eventType }) => {
                    itemEvents.push({ eventType, status: item.status });
                },
            },
            itemId: 'tool-1',
            toolName: 'filesystem.list',
            toolInput: { path: '.' },
        });
        (0, vitest_1.expect)(result.ok).toBe(true);
        (0, vitest_1.expect)(statusUpdates).toEqual([
            'tool-start:Files: list .',
            'tool-done:Files: list . -> Listed 3 files',
        ]);
        (0, vitest_1.expect)(itemEvents).toEqual([
            { eventType: 'item.started', status: 'in_progress' },
            { eventType: 'item.completed', status: 'completed' },
        ]);
    });
    (0, vitest_1.it)('passes a progress callback into tool execution context', async () => {
        const statusUpdates = [];
        executeMock.mockImplementation(async (_toolName, _toolInput, context) => {
            context.onProgress?.('tool-progress:Browser: research "x" -> opening result 1');
            return {
                summary: 'done',
                data: {},
            };
        });
        await (0, providerToolRuntime_1.executeProviderToolCallWithEvents)({
            providerId: model_1.PRIMARY_PROVIDER_ID,
            request: {
                runId: 'run-progress',
                agentId: model_1.PRIMARY_PROVIDER_ID,
                mode: 'unrestricted-dev',
                taskId: 'task-progress',
                systemPrompt: 'system',
                task: 'task',
                promptTools: [],
                toolCatalog: [],
                toolBindings: [],
                onStatus: (status) => statusUpdates.push(status),
            },
            itemId: 'tool-progress-1',
            toolName: 'browser.research_search',
            toolInput: { query: 'x' },
        });
        (0, vitest_1.expect)(statusUpdates).toEqual([
            'tool-start:Browser: research "x"',
            'tool-progress:Browser: research "x" -> opening result 1',
            'tool-done:Browser: research "x" -> done',
        ]);
    });
    (0, vitest_1.it)('records tool errors for non-chat tools', async () => {
        executeMock.mockRejectedValue(new Error('tool exploded'));
        const result = await (0, providerToolRuntime_1.executeProviderToolCall)({
            providerId: model_1.HAIKU_PROVIDER_ID,
            request: {
                runId: 'run-2',
                agentId: model_1.HAIKU_PROVIDER_ID,
                mode: 'unrestricted-dev',
                taskId: 'task-2',
                promptTools: [],
                toolCatalog: [],
                toolBindings: [],
            },
            toolName: 'terminal.exec',
            toolInput: { command: 'npm test' },
        });
        (0, vitest_1.expect)(result).toEqual({
            ok: false,
            errorMessage: 'tool exploded',
        });
        (0, vitest_1.expect)(recordToolMessageMock).toHaveBeenCalledWith('task-2', vitest_1.expect.stringContaining('"error": "tool exploded"'), model_1.HAIKU_PROVIDER_ID, 'run-2');
    });
    (0, vitest_1.it)('publishes normalized final output without duplicating tokens when disabled', () => {
        const tokens = [];
        const itemEvents = [];
        const item = (0, providerToolRuntime_1.publishProviderFinalOutput)({
            request: {
                onToken: (text) => {
                    tokens.push(text);
                },
                onItem: ({ eventType }) => {
                    itemEvents.push(eventType);
                },
            },
            itemId: 'final-1',
            text: '',
            emitToken: false,
        });
        (0, vitest_1.expect)(item.text).toContain('The run ended without a text response.');
        (0, vitest_1.expect)(tokens).toEqual([]);
        (0, vitest_1.expect)(itemEvents).toEqual(['item.completed']);
    });
});
//# sourceMappingURL=providerToolRuntime.test.js.map