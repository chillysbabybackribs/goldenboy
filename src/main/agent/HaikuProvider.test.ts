import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentProviderRequest } from './AgentTypes';
import { agentToolExecutor } from './AgentToolExecutor';

const { streamMock } = vi.hoisted(() => ({
  streamMock: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
  },
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
        stop_reason: 'end_turn',
      };
    },
  };
}

function createTextOnlyStreamWithStopReason(
  text: string,
  stopReason: string,
  usage = { input_tokens: 10, output_tokens: 4 },
) {
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
        stop_reason: stopReason,
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

function createToolUseStream(
  content: Array<{ id: string; name: string; input: Record<string, unknown> }>,
  usage = { input_tokens: 10, output_tokens: 4 },
) {
  const handlers = new Map<string, Array<(value: unknown, snapshot?: unknown) => void>>();
  const stream = {
    on(event: string, callback: (value: unknown, snapshot?: unknown) => void) {
      handlers.set(event, [...(handlers.get(event) || []), callback]);
      return stream;
    },
    abort: vi.fn(),
    async finalMessage() {
      const toolUseBlocks = content.map((item) => ({
        type: 'tool_use',
        id: item.id,
        name: item.name,
        input: item.input,
      }));
      for (const callback of handlers.get('streamEvent') || []) {
        callback({ type: 'content_block_stop' }, { content: toolUseBlocks });
      }
      return {
        usage,
        content: toolUseBlocks,
      };
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

  it('accepts an explicit model override', () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const provider = new HaikuProvider({ modelId: 'claude-opus-4-7-20260401' });
    expect(provider.modelId).toBe('claude-opus-4-7-20260401');
  });

  it('accepts an explicit max token override', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    streamMock.mockReturnValue(createTextOnlyStream('Hello from Haiku.'));

    const provider = new HaikuProvider({ maxTokens: 8192 });
    await provider.invoke(buildRequest());

    expect(streamMock.mock.calls[0]?.[0]?.max_tokens).toBe(8192);
  });

  it('passes maxTokensOverride from the provider request with a safe cap', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    streamMock.mockReturnValue(createTextOnlyStream('Hello from Haiku.'));

    const provider = new HaikuProvider({ maxTokens: 4096 });
    await provider.invoke(buildRequest({ maxTokensOverride: 6000 }));

    expect(streamMock.mock.calls[0]?.[0]?.max_tokens).toBe(6000);
  });

  it('clamps per-run maxTokensOverride to the Haiku safety ceiling', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    streamMock.mockReturnValue(createTextOnlyStream('Hello from Haiku.'));

    const provider = new HaikuProvider({ maxTokens: 4096 });
    await provider.invoke(buildRequest({ maxTokensOverride: 50000 }));

    expect(streamMock.mock.calls[0]?.[0]?.max_tokens).toBe(8192);
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
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
        durationMs: expect.any(Number),
      },
    });
  });

  it('prepends priorTurns as real role-tagged messages before the current user turn', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

    streamMock.mockReturnValue(createTextOnlyStream('Continuation ack.'));

    const provider = new HaikuProvider();
    await provider.invoke(buildRequest({
      task: 'What was my earlier question?',
      priorTurns: [
        { role: 'user', content: 'Explain the memory system.' },
        { role: 'assistant', content: 'It caches chat turns on disk.' },
      ],
    }));

    const messages = streamMock.mock.calls[0]?.[0]?.messages;
    expect(messages).toEqual([
      { role: 'user', content: 'Explain the memory system.' },
      { role: 'assistant', content: 'It caches chat turns on disk.' },
      { role: 'user', content: 'What was my earlier question?' },
    ]);
  });

  it('drops a leading assistant prior-turn to satisfy Anthropic role-order invariants', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

    streamMock.mockReturnValue(createTextOnlyStream('Continuation ack.'));

    const provider = new HaikuProvider();
    await provider.invoke(buildRequest({
      task: 'Follow up.',
      priorTurns: [
        // Leading assistant turn with no user anchor must be dropped — a
        // bare assistant-first history violates Anthropic's message-order
        // rules and crashes the API call.
        { role: 'assistant', content: 'Orphan assistant content.' },
        { role: 'user', content: 'Earlier prompt.' },
        { role: 'assistant', content: 'Earlier reply.' },
      ],
    }));

    const messages = streamMock.mock.calls[0]?.[0]?.messages;
    expect(messages).toEqual([
      { role: 'user', content: 'Earlier prompt.' },
      { role: 'assistant', content: 'Earlier reply.' },
      { role: 'user', content: 'Follow up.' },
    ]);
  });

  it('coalesces adjacent same-role prior turns so alternation is preserved', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

    streamMock.mockReturnValue(createTextOnlyStream('Ack.'));

    const provider = new HaikuProvider();
    await provider.invoke(buildRequest({
      task: 'And now?',
      priorTurns: [
        { role: 'user', content: 'Part one of the question.' },
        { role: 'user', content: 'Part two of the same question.' },
        { role: 'assistant', content: 'Combined answer.' },
      ],
    }));

    const messages = streamMock.mock.calls[0]?.[0]?.messages;
    expect(messages).toEqual([
      {
        role: 'user',
        content: 'Part one of the question.\n\nPart two of the same question.',
      },
      { role: 'assistant', content: 'Combined answer.' },
      { role: 'user', content: 'And now?' },
    ]);
  });

  it('behaves exactly like today when priorTurns is omitted (no regression)', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

    streamMock.mockReturnValue(createTextOnlyStream('Ok.'));

    const provider = new HaikuProvider();
    await provider.invoke(buildRequest({ task: 'First turn.' }));

    const messages = streamMock.mock.calls[0]?.[0]?.messages;
    expect(messages).toEqual([{ role: 'user', content: 'First turn.' }]);
  });

  it('surfaces Anthropic prompt-cache read and creation token counts in the provider usage payload', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

    streamMock.mockReturnValue(
      createTextOnlyStream('cached-ok', {
        input_tokens: 100,
        output_tokens: 10,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 15,
      } as unknown as { input_tokens: number; output_tokens: number }),
    );

    const provider = new HaikuProvider();
    const result = await provider.invoke(buildRequest());

    expect(result.usage?.inputTokens).toBe(100);
    expect(result.usage?.outputTokens).toBe(10);
    expect(result.usage?.cachedInputTokens).toBe(80);
    expect(result.usage?.cacheCreationInputTokens).toBe(15);
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

  it('marks text responses as incomplete when Anthropic stops on max_tokens', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    streamMock.mockReturnValue(createTextOnlyStreamWithStopReason('Long answer', 'max_tokens'));

    const provider = new HaikuProvider({ maxTokens: 4096 });
    const result = await provider.invoke(buildRequest());

    expect(result.output).toContain('Long answer');
    expect(result.completion).toEqual({
      completed: false,
      reason: 'budget_exhausted',
      canContinue: true,
    });
  });

  it('auto-continues text responses that stop on max_tokens within the bounded budget', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    streamMock
      .mockReturnValueOnce(createTextOnlyStreamWithStopReason('Long answer part 1 ', 'max_tokens', {
        input_tokens: 10,
        output_tokens: 4096,
      }))
      .mockReturnValueOnce(createTextOnlyStreamWithStopReason('part 2', 'end_turn', {
        input_tokens: 5,
        output_tokens: 100,
      }));

    const statuses: string[] = [];
    const tokens: string[] = [];
    const provider = new HaikuProvider({ maxTokens: 4096 });
    const result = await provider.invoke(buildRequest({
      onStatus: (status) => {
        statuses.push(status);
      },
      onToken: (text) => {
        tokens.push(text);
      },
    }));

    expect(streamMock).toHaveBeenCalledTimes(2);
    expect(streamMock.mock.calls[1]?.[0]?.messages.slice(0, 3)).toEqual([
      { role: 'user', content: 'Summarize the result.' },
      { role: 'assistant', content: [{ type: 'text', text: 'Long answer part 1 ' }] },
      { role: 'user', content: 'Continue exactly where you left off. Do not repeat prior text. Do not restart the answer. Finish the response directly.' },
    ]);
    expect(statuses).toContain('response-continue:1 requesting more output (4096 max_tokens chunk)');
    expect(result.output).toBe('Long answer part 1 part 2');
    expect(tokens).toEqual(['Long answer part 1 ', 'part 2']);
    expect(result.completion).toBeUndefined();
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
