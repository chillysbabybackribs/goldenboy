"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const AppServerProvider_1 = require("./AppServerProvider");
const AppServerProvider_2 = require("./AppServerProvider");
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
(0, vitest_1.describe)('thread registry persistence helpers', () => {
    (0, vitest_1.describe)('pruneExpiredEntries', () => {
        (0, vitest_1.it)('removes entries older than 7 days', () => {
            const now = Date.now();
            const entries = {
                'task-old': { threadId: 'thread-old', savedAt: now - SEVEN_DAYS_MS - 1 },
                'task-new': { threadId: 'thread-new', savedAt: now - 1000 },
            };
            const pruned = (0, AppServerProvider_1.pruneExpiredEntries)(entries, now);
            (0, vitest_1.expect)(pruned['task-old']).toBeUndefined();
            (0, vitest_1.expect)(pruned['task-new']).toBeDefined();
        });
        (0, vitest_1.it)('keeps entries exactly at 7 days boundary', () => {
            const now = Date.now();
            const entries = {
                'task-boundary': { threadId: 'thread-b', savedAt: now - SEVEN_DAYS_MS },
            };
            const pruned = (0, AppServerProvider_1.pruneExpiredEntries)(entries, now);
            (0, vitest_1.expect)(pruned['task-boundary']).toBeDefined();
        });
    });
});
(0, vitest_1.describe)('MCP name translation', () => {
    (0, vitest_1.it)('dots become __ (round-trip)', () => {
        (0, vitest_1.expect)('filesystem.list'.replace(/\./g, '__')).toBe('filesystem__list');
        (0, vitest_1.expect)('filesystem__list'.replace(/__/g, '.')).toBe('filesystem.list');
    });
});
(0, vitest_1.describe)('web_search config enforcement', () => {
    (0, vitest_1.it)('includes web_search disabled in thread/start params', async () => {
        const sentMessages = [];
        const mockWs = {
            send: (data) => {
                const msg = JSON.parse(data);
                sentMessages.push(msg);
                if (msg.method === 'thread/start') {
                    setTimeout(() => {
                        const handler = mockWs._messageHandlers?.[0];
                        handler?.({ data: JSON.stringify({ id: msg.id, result: { thread: { id: 'thread-1' } } }) });
                    }, 0);
                }
            },
            addEventListener: (event, handler) => {
                if (event === 'message') {
                    mockWs._messageHandlers = mockWs._messageHandlers ?? [];
                    mockWs._messageHandlers.push(handler);
                }
            },
            removeEventListener: (_event, handler) => {
                const idx = mockWs._messageHandlers?.indexOf(handler) ?? -1;
                if (idx !== -1)
                    mockWs._messageHandlers.splice(idx, 1);
            },
        };
        const provider = new AppServerProvider_2.AppServerProvider({
            providerId: 'gpt-5.4',
            modelId: 'gpt-5.4',
            process: {},
        });
        await provider.startThread(mockWs, 'task-1', 'system instructions');
        const threadStart = sentMessages.find((m) => m.method === 'thread/start');
        (0, vitest_1.expect)(threadStart).toBeDefined();
        (0, vitest_1.expect)(threadStart.params.config).toEqual({ web_search: 'disabled' });
        (0, vitest_1.expect)(threadStart.params.developerInstructions).toBe('system instructions');
        (0, vitest_1.expect)(threadStart.params.instructions).toBeUndefined();
    });
    (0, vitest_1.it)('includes web_search disabled in thread/resume params', async () => {
        const sentMessages = [];
        const mockWs = {
            send: (data) => {
                const msg = JSON.parse(data);
                sentMessages.push(msg);
                if (msg.method === 'thread/resume') {
                    setTimeout(() => {
                        const handler = mockWs._messageHandlers?.[0];
                        handler?.({ data: JSON.stringify({ id: msg.id, result: {} }) });
                    }, 0);
                }
            },
            addEventListener: (event, handler) => {
                if (event === 'message') {
                    mockWs._messageHandlers = mockWs._messageHandlers ?? [];
                    mockWs._messageHandlers.push(handler);
                }
            },
            removeEventListener: (_event, handler) => {
                const idx = mockWs._messageHandlers?.indexOf(handler) ?? -1;
                if (idx !== -1)
                    mockWs._messageHandlers.splice(idx, 1);
            },
        };
        const provider = new AppServerProvider_2.AppServerProvider({
            providerId: 'gpt-5.4',
            modelId: 'gpt-5.4',
            process: {},
        });
        await provider.resumeThread(mockWs, 'task-1', 'thread-1', 'system instructions');
        const threadResume = sentMessages.find((m) => m.method === 'thread/resume');
        (0, vitest_1.expect)(threadResume).toBeDefined();
        (0, vitest_1.expect)(threadResume.params.config).toEqual({ web_search: 'disabled' });
        (0, vitest_1.expect)(threadResume.params.developerInstructions).toBe('system instructions');
        (0, vitest_1.expect)(threadResume.params.instructions).toBeUndefined();
    });
});
(0, vitest_1.describe)('turn text emission', () => {
    (0, vitest_1.it)('streams assistant deltas immediately for tool-calling turns', async () => {
        const tokens = [];
        const statuses = [];
        const mockWs = {
            send: (data) => {
                const msg = JSON.parse(data);
                if (msg.method === 'turn/start') {
                    setTimeout(() => {
                        const handlers = mockWs._messageHandlers ?? [];
                        for (const handler of handlers) {
                            handler({ data: JSON.stringify({ method: 'item/agentMessage/delta', params: { delta: 'Checking the page before I click.' } }) });
                            handler({ data: JSON.stringify({
                                    method: 'item/started',
                                    params: {
                                        item: {
                                            id: 'tool-1',
                                            type: 'mcpToolCall',
                                            server: 'v2-tools',
                                            tool: 'browser__click',
                                            arguments: { selector: '#submit' },
                                        },
                                    },
                                }) });
                            handler({ data: JSON.stringify({ method: 'turn/completed', params: {} }) });
                        }
                    }, 0);
                }
            },
            addEventListener: (event, handler) => {
                if (event === 'message') {
                    mockWs._messageHandlers = mockWs._messageHandlers ?? [];
                    mockWs._messageHandlers.push(handler);
                }
            },
            removeEventListener: (_event, handler) => {
                const idx = mockWs._messageHandlers?.indexOf(handler) ?? -1;
                if (idx !== -1)
                    mockWs._messageHandlers.splice(idx, 1);
            },
        };
        const provider = new AppServerProvider_2.AppServerProvider({
            providerId: 'gpt-5.4',
            modelId: 'gpt-5.4',
            process: {},
        });
        const result = await provider.runOneTurn(mockWs, {
            threadId: 'thread-1',
            task: 'Click submit',
            request: {
                runId: 'run-1',
                agentId: 'gpt-5.4',
                mode: 'unrestricted-dev',
                taskId: 'task-1',
                systemPrompt: 'system',
                task: 'Click submit',
                promptTools: [],
                toolCatalog: [],
                toolBindings: [],
                onToken: (text) => tokens.push(text),
                onStatus: (status) => statuses.push(status),
            },
            currentTools: [],
            toolCatalog: [],
        });
        (0, vitest_1.expect)(result.kind).toBe('tool_calls');
        (0, vitest_1.expect)(result.message).toContain('Checking the page');
        (0, vitest_1.expect)(tokens).toEqual(['Checking the page before I click.']);
        (0, vitest_1.expect)(statuses).toContain('thought-migrate');
    });
    (0, vitest_1.it)('suppresses generic post-tool procedural thoughts from status updates', async () => {
        const statuses = [];
        const mockWs = {
            send: (data) => {
                const msg = JSON.parse(data);
                if (msg.method === 'turn/start') {
                    setTimeout(() => {
                        const handlers = mockWs._messageHandlers ?? [];
                        for (const handler of handlers) {
                            handler({ data: JSON.stringify({
                                    method: 'item/started',
                                    params: {
                                        item: {
                                            id: 'tool-1',
                                            type: 'mcpToolCall',
                                            server: 'v2-tools',
                                            tool: 'browser__click',
                                            arguments: { selector: '#submit' },
                                        },
                                    },
                                }) });
                            handler({ data: JSON.stringify({ method: 'item/agentMessage/delta', params: { delta: 'I am checking the page before I click.' } }) });
                            handler({ data: JSON.stringify({ method: 'turn/completed', params: {} }) });
                        }
                    }, 0);
                }
            },
            addEventListener: (event, handler) => {
                if (event === 'message') {
                    mockWs._messageHandlers = mockWs._messageHandlers ?? [];
                    mockWs._messageHandlers.push(handler);
                }
            },
            removeEventListener: (_event, handler) => {
                const idx = mockWs._messageHandlers?.indexOf(handler) ?? -1;
                if (idx !== -1)
                    mockWs._messageHandlers.splice(idx, 1);
            },
        };
        const provider = new AppServerProvider_2.AppServerProvider({
            providerId: 'gpt-5.4',
            modelId: 'gpt-5.4',
            process: {},
        });
        await provider.runOneTurn(mockWs, {
            threadId: 'thread-1',
            task: 'Click submit',
            request: {
                runId: 'run-1',
                agentId: 'gpt-5.4',
                mode: 'unrestricted-dev',
                taskId: 'task-1',
                systemPrompt: 'system',
                task: 'Click submit',
                promptTools: [],
                toolCatalog: [],
                toolBindings: [],
                onStatus: (status) => statuses.push(status),
            },
            currentTools: [],
            toolCatalog: [],
        });
        (0, vitest_1.expect)(statuses.some((status) => status.startsWith('thought:'))).toBe(false);
    });
    (0, vitest_1.it)('keeps blocker-style post-tool questions in status updates', async () => {
        const statuses = [];
        const mockWs = {
            send: (data) => {
                const msg = JSON.parse(data);
                if (msg.method === 'turn/start') {
                    setTimeout(() => {
                        const handlers = mockWs._messageHandlers ?? [];
                        for (const handler of handlers) {
                            handler({ data: JSON.stringify({
                                    method: 'item/started',
                                    params: {
                                        item: {
                                            id: 'tool-1',
                                            type: 'mcpToolCall',
                                            server: 'v2-tools',
                                            tool: 'browser__click',
                                            arguments: { selector: '#submit' },
                                        },
                                    },
                                }) });
                            handler({ data: JSON.stringify({ method: 'item/agentMessage/delta', params: { delta: 'Which environment should I use?' } }) });
                            handler({ data: JSON.stringify({ method: 'turn/completed', params: {} }) });
                        }
                    }, 0);
                }
            },
            addEventListener: (event, handler) => {
                if (event === 'message') {
                    mockWs._messageHandlers = mockWs._messageHandlers ?? [];
                    mockWs._messageHandlers.push(handler);
                }
            },
            removeEventListener: (_event, handler) => {
                const idx = mockWs._messageHandlers?.indexOf(handler) ?? -1;
                if (idx !== -1)
                    mockWs._messageHandlers.splice(idx, 1);
            },
        };
        const provider = new AppServerProvider_2.AppServerProvider({
            providerId: 'gpt-5.4',
            modelId: 'gpt-5.4',
            process: {},
        });
        await provider.runOneTurn(mockWs, {
            threadId: 'thread-1',
            task: 'Click submit',
            request: {
                runId: 'run-1',
                agentId: 'gpt-5.4',
                mode: 'unrestricted-dev',
                taskId: 'task-1',
                systemPrompt: 'system',
                task: 'Click submit',
                promptTools: [],
                toolCatalog: [],
                toolBindings: [],
                onStatus: (status) => statuses.push(status),
            },
            currentTools: [],
            toolCatalog: [],
        });
        (0, vitest_1.expect)(statuses).toContain('thought:Which environment should I use?');
    });
});
(0, vitest_1.describe)('turn input attachments', () => {
    (0, vitest_1.it)('includes local image attachments in turn/start input', async () => {
        let turnStartMessage = null;
        const mockWs = {
            send: (data) => {
                const msg = JSON.parse(data);
                if (msg.method === 'turn/start') {
                    turnStartMessage = msg;
                    setTimeout(() => {
                        const handlers = mockWs._messageHandlers ?? [];
                        for (const handler of handlers) {
                            handler({ data: JSON.stringify({ method: 'turn/completed', params: {} }) });
                        }
                    }, 0);
                }
            },
            addEventListener: (event, handler) => {
                if (event === 'message') {
                    mockWs._messageHandlers = mockWs._messageHandlers ?? [];
                    mockWs._messageHandlers.push(handler);
                }
            },
            removeEventListener: (_event, handler) => {
                const idx = mockWs._messageHandlers?.indexOf(handler) ?? -1;
                if (idx !== -1)
                    mockWs._messageHandlers.splice(idx, 1);
            },
        };
        const provider = new AppServerProvider_2.AppServerProvider({
            providerId: 'gpt-5.4',
            modelId: 'gpt-5.4',
            process: {},
        });
        await provider.runOneTurn(mockWs, {
            threadId: 'thread-1',
            task: '',
            request: {
                runId: 'run-1',
                agentId: 'gpt-5.4',
                mode: 'unrestricted-dev',
                taskId: 'task-1',
                systemPrompt: 'system',
                task: '',
                promptTools: [],
                toolCatalog: [],
                toolBindings: [],
                attachments: [{
                        type: 'image',
                        mediaType: 'image/png',
                        data: 'ZmFrZQ==',
                        name: 'diagram.png',
                        path: '/tmp/diagram.png',
                    }],
            },
            currentTools: [],
            toolCatalog: [],
        });
        (0, vitest_1.expect)(turnStartMessage).toBeTruthy();
        (0, vitest_1.expect)(turnStartMessage.params.input).toEqual([
            { type: 'local_image', path: '/tmp/diagram.png' },
        ]);
    });
});
(0, vitest_1.describe)('tool scope promotion', () => {
    (0, vitest_1.it)('writes only callable tools to the app-server context file for each turn', async () => {
        const provider = new AppServerProvider_2.AppServerProvider({
            providerId: 'gpt-5.4',
            modelId: 'gpt-5.4',
            process: {},
        });
        const writtenToolNames = [];
        provider.ws = {};
        provider.acquireThread = vitest_1.vi.fn(async () => 'thread-1');
        provider.writeContextFile = vitest_1.vi.fn((_request, tools) => {
            writtenToolNames.push((tools ?? []).map((tool) => tool.name));
        });
        let turnCount = 0;
        provider.runOneTurn = vitest_1.vi.fn(async (_ws, params) => {
            turnCount += 1;
            if (turnCount === 1) {
                (0, vitest_1.expect)(params.currentTools.map((tool) => tool.name)).toEqual(['runtime.search_tools']);
                return {
                    kind: 'tool_calls',
                    message: 'Queued browser tools',
                    inputTokens: 0,
                    outputTokens: 0,
                    toolPackExpanded: true,
                    expansion: {
                        pack: 'browser-advanced',
                        description: 'Browser advanced tools',
                        tools: ['browser.close_tab'],
                        scope: 'named',
                        relatedPackIds: [],
                    },
                    codexItems: [],
                };
            }
            (0, vitest_1.expect)(params.currentTools.map((tool) => tool.name)).toEqual([
                'runtime.search_tools',
                'browser.close_tab',
            ]);
            return {
                kind: 'final',
                message: 'Done',
                inputTokens: 0,
                outputTokens: 0,
                toolPackExpanded: false,
                codexItems: [],
            };
        });
        const result = await provider.invoke({
            runId: 'run-1',
            agentId: 'gpt-5.4',
            mode: 'unrestricted-dev',
            taskId: 'task-1',
            systemPrompt: 'system',
            task: 'Find a browser tool and then finish.',
            promptTools: [
                { name: 'runtime.search_tools', description: 'Search tools', inputSchema: {} },
            ],
            toolBindings: [
                { name: 'runtime.search_tools', description: 'Search tools', inputSchema: {}, state: 'callable' },
            ],
            toolCatalog: [
                { name: 'runtime.search_tools', description: 'Search tools', inputSchema: {} },
                { name: 'browser.close_tab', description: 'Close tab', inputSchema: {} },
            ],
            onToken: vitest_1.vi.fn(),
        });
        (0, vitest_1.expect)(result.output).toBe('Done');
        (0, vitest_1.expect)(writtenToolNames).toEqual([
            ['runtime.search_tools'],
            ['runtime.search_tools', 'browser.close_tab'],
        ]);
        (0, vitest_1.expect)(provider.runOneTurn).toHaveBeenCalledTimes(2);
    });
});
//# sourceMappingURL=AppServerProvider.test.js.map