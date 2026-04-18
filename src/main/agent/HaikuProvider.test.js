"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const { streamMock, executeMock, recordToolMessageMock } = vitest_1.vi.hoisted(() => ({
    streamMock: vitest_1.vi.fn(),
    executeMock: vitest_1.vi.fn(),
    recordToolMessageMock: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('@anthropic-ai/sdk', () => ({
    default: class MockAnthropic {
        messages = {
            stream: streamMock,
        };
    },
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
const HaikuProvider_1 = require("./HaikuProvider");
function buildRequest(overrides = {}) {
    const request = {
        runId: 'run-1',
        agentId: 'haiku',
        mode: 'unrestricted-dev',
        taskId: 'task-1',
        systemPrompt: 'You are a helpful assistant.',
        task: 'Summarize the result.',
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
function createTextOnlyStream(textOrChunks, usage = { input_tokens: 10, output_tokens: 4 }) {
    const chunks = Array.isArray(textOrChunks) ? textOrChunks : [textOrChunks];
    return createContentStream(chunks, [{ type: 'text', text: chunks.join('') }], usage);
}
function createContentStream(chunks, content, usage = { input_tokens: 10, output_tokens: 4 }) {
    const handlers = new Map();
    return {
        on(event, callback) {
            handlers.set(event, [...(handlers.get(event) || []), callback]);
        },
        abort: vitest_1.vi.fn(),
        async finalMessage() {
            for (const callback of handlers.get('text') || []) {
                for (const chunk of chunks) {
                    callback(chunk);
                }
            }
            return {
                usage,
                content,
            };
        },
    };
}
(0, vitest_1.describe)('HaikuProvider', () => {
    (0, vitest_1.beforeEach)(() => {
        streamMock.mockReset();
        executeMock.mockReset();
        recordToolMessageMock.mockReset();
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.ANTHROPIC_MODEL;
    });
    (0, vitest_1.it)('requires an Anthropic API key', () => {
        (0, vitest_1.expect)(() => new HaikuProvider_1.HaikuProvider('')).toThrow('ANTHROPIC_API_KEY is not configured.');
    });
    (0, vitest_1.it)('returns a final response when the model answers without tool calls', async () => {
        process.env.ANTHROPIC_API_KEY = 'test-key';
        process.env.ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
        streamMock.mockReturnValue(createTextOnlyStream(['Hello ', 'from ', 'Haiku.']));
        const tokens = [];
        const itemEvents = [];
        const provider = new HaikuProvider_1.HaikuProvider();
        const result = await provider.invoke(buildRequest({
            onToken: (text) => {
                tokens.push(text);
            },
            onItem: ({ eventType }) => {
                itemEvents.push(eventType);
            },
        }));
        (0, vitest_1.expect)(streamMock).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(tokens).toEqual(['Hello ', 'from ', 'Haiku.']);
        (0, vitest_1.expect)(itemEvents).toEqual(['item.completed']);
        (0, vitest_1.expect)(result).toEqual({
            output: 'Hello from Haiku.',
            codexItems: [
                {
                    id: vitest_1.expect.any(String),
                    type: 'agent_message',
                    text: 'Hello from Haiku.',
                },
            ],
            usage: {
                inputTokens: 10,
                outputTokens: 4,
                durationMs: vitest_1.expect.any(Number),
            },
        });
    });
    (0, vitest_1.it)('suppresses pre-tool text until a final answer is ready', async () => {
        process.env.ANTHROPIC_API_KEY = 'test-key';
        process.env.ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
        streamMock
            .mockReturnValueOnce(createContentStream(['Checking ', 'the workspace root.'], [
            { type: 'text', text: 'Checking the workspace root.' },
            {
                type: 'tool_use',
                id: 'toolu_1',
                name: 'filesystem__list',
                input: { path: '.' },
            },
        ]))
            .mockReturnValueOnce(createTextOnlyStream(['Done.']));
        executeMock.mockResolvedValue({
            summary: 'Listed 1 file',
            data: { entries: ['a.ts'] },
        });
        const tokens = [];
        const provider = new HaikuProvider_1.HaikuProvider();
        const result = await provider.invoke(buildRequest({
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
            onToken: (text) => {
                tokens.push(text);
            },
        }));
        (0, vitest_1.expect)(executeMock).toHaveBeenCalledWith('filesystem.list', { path: '.' }, vitest_1.expect.any(Object));
        (0, vitest_1.expect)(tokens).toEqual(['Done.']);
        (0, vitest_1.expect)(result.output).toBe('Done.');
    });
});
//# sourceMappingURL=HaikuProvider.test.js.map