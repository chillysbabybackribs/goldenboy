import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentProviderRequest } from './AgentTypes';

const { streamMock } = vi.hoisted(() => ({
  streamMock: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      stream: streamMock,
    };
  },
}));

import { HaikuProvider } from './HaikuProvider';

function buildRequest(overrides: Partial<AgentProviderRequest> = {}): AgentProviderRequest {
  return {
    runId: 'run-1',
    agentId: 'haiku',
    mode: 'unrestricted-dev',
    taskId: 'task-1',
    systemPrompt: 'You are a helpful assistant.',
    task: 'Summarize the result.',
    contextPrompt: '',
    tools: [],
    maxToolTurns: 2,
    ...overrides,
  };
}

function createTextOnlyStream(text: string, usage = { input_tokens: 10, output_tokens: 4 }) {
  const handlers = new Map<string, Array<(value: string) => void>>();
  return {
    on(event: string, callback: (value: string) => void) {
      handlers.set(event, [...(handlers.get(event) || []), callback]);
      return this;
    },
    abort: vi.fn(),
    async finalMessage() {
      for (const callback of handlers.get('streamEvent') || []) {
        callback({ type: 'content_block_delta' }, { content: [{ type: 'text', text }] });
      }
      for (const callback of handlers.get('text') || []) {
        callback(text);
      }
      return {
        usage,
        content: [{ type: 'text', text }],
      };
    },
  };
}

function createRecoverableFailureStream(partialText: string, error: Error) {
  const handlers = new Map<string, Array<(value: unknown) => void>>();
  const stream = {
    currentMessage: { content: [{ type: 'text', text: partialText }] },
    on(event: string, callback: (value: unknown) => void) {
      handlers.set(event, [...(handlers.get(event) || []), callback]);
      return stream;
    },
    abort: vi.fn(),
    async finalMessage() {
      for (const callback of handlers.get('streamEvent') || []) {
        callback({ type: 'content_block_delta' });
      }
      for (const callback of handlers.get('text') || []) {
        callback(partialText);
      }
      for (const callback of handlers.get('error') || []) {
        callback(error);
      }
      throw error;
    },
  };
  return stream;
}

function createNonResumableFailureStream(error: Error) {
  const handlers = new Map<string, Array<(value: unknown) => void>>();
  const stream = {
    currentMessage: {
      content: [
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'filesystem__read',
          input: { path: 'x' },
        },
      ],
    },
    on(event: string, callback: (value: unknown) => void) {
      handlers.set(event, [...(handlers.get(event) || []), callback]);
      return stream;
    },
    abort: vi.fn(),
    async finalMessage() {
      for (const callback of handlers.get('streamEvent') || []) {
        callback({ type: 'content_block_delta' });
      }
      for (const callback of handlers.get('error') || []) {
        callback(error);
      }
      throw error;
    },
  };
  return stream;
}

describe('HaikuProvider', () => {
  beforeEach(() => {
    streamMock.mockReset();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_MODEL;
  });

  it('requires an Anthropic API key', () => {
    expect(() => new HaikuProvider('')).toThrow('ANTHROPIC_API_KEY is not configured.');
  });

  it('returns a final response when the model answers without tool calls', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

    streamMock.mockReturnValue(createTextOnlyStream('Hello from Haiku.'));

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
    expect(tokens).toEqual(['Hello from Haiku.']);
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

  it('recovers interrupted text-only Haiku streams by prefilling the partial assistant text', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

    const interruption = new Error('connection lost');
    interruption.name = 'APIConnectionError';

    streamMock
      .mockReturnValueOnce(createRecoverableFailureStream('Partial answer', interruption))
      .mockReturnValueOnce(createTextOnlyStream(' continued.'));

    const statuses: string[] = [];
    const provider = new HaikuProvider();
    const result = await provider.invoke(buildRequest({
      onStatus: (status) => {
        statuses.push(status);
      },
    }));

    expect(streamMock).toHaveBeenCalledTimes(2);
    expect(streamMock.mock.calls[1]?.[0]?.messages).toEqual([
      { role: 'user', content: 'Summarize the result.' },
      { role: 'assistant', content: 'Partial answer' },
    ]);
    expect(statuses).toContain('stream-recover:1 resumed after interruption (14 chars)');
    expect(result.output).toBe('Partial answer continued.');
  });

  it('does not retry non-text partial streams because tool/thinking blocks are not resumable', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

    const interruption = new Error('connection lost');
    interruption.name = 'APIConnectionError';

    streamMock.mockReturnValue(createNonResumableFailureStream(interruption));

    const provider = new HaikuProvider();
    await expect(provider.invoke(buildRequest())).rejects.toThrow('connection lost');
    expect(streamMock).toHaveBeenCalledTimes(1);
  });
});
