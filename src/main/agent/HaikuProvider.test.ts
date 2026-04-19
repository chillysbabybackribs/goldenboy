import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentProviderRequest } from './AgentTypes';

const { streamMock, executeMock, recordToolMessageMock } = vi.hoisted(() => ({
  streamMock: vi.fn(),
  executeMock: vi.fn(),
  recordToolMessageMock: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      stream: streamMock,
    };
  },
}));

vi.mock('./AgentToolExecutor', () => ({
  agentToolExecutor: {
    execute: executeMock,
  },
}));

vi.mock('../chatKnowledge/ChatKnowledgeStore', () => ({
  chatKnowledgeStore: {
    recordToolMessage: recordToolMessageMock,
  },
}));

import { HaikuProvider } from './HaikuProvider';

function buildRequest(overrides: Partial<AgentProviderRequest> = {}): AgentProviderRequest {
  const request: AgentProviderRequest = {
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
    ?? request.promptTools.map((tool) => ({ ...tool, state: 'callable' as const }));
  return request;
}

function createTextOnlyStream(
  textOrChunks: string | string[],
  usage = { input_tokens: 10, output_tokens: 4 },
) {
  const chunks = Array.isArray(textOrChunks) ? textOrChunks : [textOrChunks];
  return createContentStream(
    chunks,
    [{ type: 'text', text: chunks.join('') }],
    usage,
  );
}

function createContentStream(
  chunks: string[],
  content: Array<Record<string, unknown>>,
  usage = { input_tokens: 10, output_tokens: 4 },
) {
  const handlers = new Map<string, Array<(value: string) => void>>();
  return {
    on(event: string, callback: (value: string) => void) {
      handlers.set(event, [...(handlers.get(event) || []), callback]);
    },
    abort: vi.fn(),
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

describe('HaikuProvider', () => {
  beforeEach(() => {
    streamMock.mockReset();
    executeMock.mockReset();
    recordToolMessageMock.mockReset();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.ANTHROPIC_MAX_TOKENS;
    delete process.env.V2_HAIKU_MAX_TOKENS;
  });

  it('requires an Anthropic API key', () => {
    expect(() => new HaikuProvider('')).toThrow('ANTHROPIC_API_KEY is not configured.');
  });

  it('returns a final response when the model answers without tool calls', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

    streamMock.mockReturnValue(createTextOnlyStream(['Hello ', 'from ', 'Haiku.']));

    const tokens: string[] = [];
    const itemEvents: string[] = [];
    const provider = new HaikuProvider();
    const result = await provider.invoke(buildRequest({
      onToken: (text) => {
        tokens.push(text);
      },
      onItem: ({ eventType }) => {
        itemEvents.push(eventType);
      },
    }));

    expect(streamMock).toHaveBeenCalledTimes(1);
    expect(tokens).toEqual(['Hello ', 'from ', 'Haiku.']);
    expect(itemEvents).toEqual(['item.completed']);
    expect(result).toEqual({
      output: 'Hello from Haiku.',
      codexItems: [
        {
          id: expect.any(String),
          type: 'agent_message',
          text: 'Hello from Haiku.',
        },
      ],
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        durationMs: expect.any(Number),
      },
    });
  });

  it('suppresses pre-tool text until a final answer is ready', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

    streamMock
      .mockReturnValueOnce(createContentStream(
        ['Checking ', 'the workspace root.'],
        [
          { type: 'text', text: 'Checking the workspace root.' },
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'filesystem__list',
            input: { path: '.' },
          },
        ],
      ))
      .mockReturnValueOnce(createTextOnlyStream(['Done.']));
    executeMock.mockResolvedValue({
      summary: 'Listed 1 file',
      data: { entries: ['a.ts'] },
    });

    const tokens: string[] = [];
    const provider = new HaikuProvider();
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

    expect(executeMock).toHaveBeenCalledWith('filesystem.list', { path: '.' }, expect.any(Object));
    expect(tokens).toEqual(['Done.']);
    expect(result.output).toBe('Done.');
  });

  it('uses V2_HAIKU_MAX_TOKENS when set', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
    process.env.V2_HAIKU_MAX_TOKENS = '2222';
    process.env.ANTHROPIC_MAX_TOKENS = '6666';

    streamMock.mockReturnValue(createTextOnlyStream('Done.'));

    const provider = new HaikuProvider();
    await provider.invoke(buildRequest());

    expect(streamMock).toHaveBeenCalledTimes(1);
    const options = streamMock.mock.calls[0]?.[0];
    expect(options?.max_tokens).toBe(2222);
  });
});
