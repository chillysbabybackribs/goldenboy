import { describe, it, expect, vi } from 'vitest';
import { pruneExpiredEntries } from './AppServerProvider';
import { AppServerProvider } from './AppServerProvider';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function createMockWs() {
  const listeners = new Map<string, Set<(event: any) => void>>();
  return {
    sent: [] as any[],
    send(data: string) {
      this.sent.push(JSON.parse(data));
    },
    addEventListener(event: string, handler: (event: any) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)?.add(handler);
    },
    removeEventListener(event: string, handler: (event: any) => void) {
      listeners.get(event)?.delete(handler);
    },
    emit(event: string, payload: any) {
      for (const handler of listeners.get(event) ?? []) {
        handler(payload);
      }
    },
    close() {
      this.emit('close', {});
    },
  } as unknown as WebSocket & { sent: any[]; emit: (event: string, payload: any) => void };
}

describe('thread registry persistence helpers', () => {
  describe('pruneExpiredEntries', () => {
    it('removes entries older than 7 days', () => {
      const now = Date.now();
      const entries = {
        'task-old': { threadId: 'thread-old', savedAt: now - SEVEN_DAYS_MS - 1 },
        'task-new': { threadId: 'thread-new', savedAt: now - 1000 },
      };
      const pruned = pruneExpiredEntries(entries, now);
      expect(pruned['task-old']).toBeUndefined();
      expect(pruned['task-new']).toBeDefined();
    });

    it('keeps entries exactly at 7 days boundary', () => {
      const now = Date.now();
      const entries = {
        'task-boundary': { threadId: 'thread-b', savedAt: now - SEVEN_DAYS_MS },
      };
      const pruned = pruneExpiredEntries(entries, now);
      expect(pruned['task-boundary']).toBeDefined();
    });
  });
});

describe('MCP name translation', () => {
  it('dots become __ (round-trip)', () => {
    expect('filesystem.list'.replace(/\./g, '__')).toBe('filesystem__list');
    expect('filesystem__list'.replace(/__/g, '.')).toBe('filesystem.list');
  });
});

describe('web_search config enforcement', () => {
  it('includes web_search disabled in thread/start params', async () => {
    const sentMessages: unknown[] = [];
    const mockWs = {
      send: (data: string) => {
        const msg = JSON.parse(data) as { id: number; method?: string };
        sentMessages.push(msg);
        if (msg.method === 'thread/start') {
          setTimeout(() => {
            const handler = (mockWs as any)._messageHandlers?.[0];
            handler?.({ data: JSON.stringify({ id: msg.id, result: { thread: { id: 'thread-1' } } }) });
          }, 0);
        }
      },
      addEventListener: (event: string, handler: unknown) => {
        if (event === 'message') {
          (mockWs as any)._messageHandlers = (mockWs as any)._messageHandlers ?? [];
          (mockWs as any)._messageHandlers.push(handler);
        }
      },
      removeEventListener: (_event: string, handler: unknown) => {
        const idx = (mockWs as any)._messageHandlers?.indexOf(handler) ?? -1;
        if (idx !== -1) (mockWs as any)._messageHandlers.splice(idx, 1);
      },
    } as unknown as WebSocket;

    const provider = new AppServerProvider({
      providerId: 'gpt-5.4' as any,
      modelId: 'gpt-5.4',
      process: {} as any,
    });
    await (provider as any).startThread(mockWs, 'task-1', 'system instructions');

    const threadStart = sentMessages.find((m: any) => m.method === 'thread/start') as any;
    expect(threadStart).toBeDefined();
    expect(threadStart.params.config).toEqual({ web_search: 'disabled' });
    expect(threadStart.params.developerInstructions).toBe('system instructions');
    expect(threadStart.params.instructions).toBeUndefined();
  });

  it('includes web_search disabled in thread/resume params', async () => {
    const sentMessages: unknown[] = [];
    const mockWs = {
      send: (data: string) => {
        const msg = JSON.parse(data) as { id: number; method?: string };
        sentMessages.push(msg);
        if (msg.method === 'thread/resume') {
          setTimeout(() => {
            const handler = (mockWs as any)._messageHandlers?.[0];
            handler?.({ data: JSON.stringify({ id: msg.id, result: {} }) });
          }, 0);
        }
      },
      addEventListener: (event: string, handler: unknown) => {
        if (event === 'message') {
          (mockWs as any)._messageHandlers = (mockWs as any)._messageHandlers ?? [];
          (mockWs as any)._messageHandlers.push(handler);
        }
      },
      removeEventListener: (_event: string, handler: unknown) => {
        const idx = (mockWs as any)._messageHandlers?.indexOf(handler) ?? -1;
        if (idx !== -1) (mockWs as any)._messageHandlers.splice(idx, 1);
      },
    } as unknown as WebSocket;

    const provider = new AppServerProvider({
      providerId: 'gpt-5.4' as any,
      modelId: 'gpt-5.4',
      process: {} as any,
    });
    await (provider as any).resumeThread(mockWs, 'task-1', 'thread-1', 'system instructions');

    const threadResume = sentMessages.find((m: any) => m.method === 'thread/resume') as any;
    expect(threadResume).toBeDefined();
    expect(threadResume.params.config).toEqual({ web_search: 'disabled' });
    expect(threadResume.params.developerInstructions).toBe('system instructions');
    expect(threadResume.params.instructions).toBeUndefined();
  });

  it('includes web_search disabled in thread/fork params', async () => {
    const sentMessages: unknown[] = [];
    const mockWs = {
      send: (data: string) => {
        const msg = JSON.parse(data) as { id: number; method?: string };
        sentMessages.push(msg);
        if (msg.method === 'thread/fork') {
          setTimeout(() => {
            const handler = (mockWs as any)._messageHandlers?.[0];
            handler?.({ data: JSON.stringify({ id: msg.id, result: { thread: { id: 'thread-forked' } } }) });
          }, 0);
        }
      },
      addEventListener: (event: string, handler: unknown) => {
        if (event === 'message') {
          (mockWs as any)._messageHandlers = (mockWs as any)._messageHandlers ?? [];
          (mockWs as any)._messageHandlers.push(handler);
        }
      },
      removeEventListener: (_event: string, handler: unknown) => {
        const idx = (mockWs as any)._messageHandlers?.indexOf(handler) ?? -1;
        if (idx !== -1) (mockWs as any)._messageHandlers.splice(idx, 1);
      },
    } as unknown as WebSocket;

    const provider = new AppServerProvider({
      providerId: 'gpt-5.4' as any,
      modelId: 'gpt-5.4',
      process: {} as any,
    });
    await (provider as any).forkThread(mockWs, 'task-1', 'thread-1', 'system instructions');

    const threadFork = sentMessages.find((m: any) => m.method === 'thread/fork') as any;
    expect(threadFork).toBeDefined();
    expect(threadFork.params.config).toEqual({ web_search: 'disabled' });
    expect(threadFork.params.developerInstructions).toBe('system instructions');
  });
});

describe('turn text emission', () => {
  it('buffers pre-tool assistant deltas instead of streaming them into chat before the first tool call', async () => {
    const tokens: string[] = [];
    const mockWs = {
      send: (data: string) => {
        const msg = JSON.parse(data) as { id: number; method?: string };
        if (msg.method === 'turn/start') {
          setTimeout(() => {
            const handlers = (mockWs as any)._messageHandlers ?? [];
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
      addEventListener: (event: string, handler: unknown) => {
        if (event === 'message') {
          (mockWs as any)._messageHandlers = (mockWs as any)._messageHandlers ?? [];
          (mockWs as any)._messageHandlers.push(handler);
        }
      },
      removeEventListener: (_event: string, handler: unknown) => {
        const idx = (mockWs as any)._messageHandlers?.indexOf(handler) ?? -1;
        if (idx !== -1) (mockWs as any)._messageHandlers.splice(idx, 1);
      },
    } as unknown as WebSocket;

    const provider = new AppServerProvider({
      providerId: 'gpt-5.4' as any,
      modelId: 'gpt-5.4',
      process: {} as any,
    });

    const result = await (provider as any).runOneTurn(mockWs, {
      threadId: 'thread-1',
      task: 'Click submit',
      request: {
        runId: 'run-1',
        agentId: 'gpt-5.4',
        mode: 'unrestricted-dev',
        taskId: 'task-1',
        systemPrompt: 'system',
        task: 'Click submit',
        tools: [],
        loadableTools: [],
        onToken: (text: string) => tokens.push(text),
      },
      currentTools: [],
      loadableTools: [],
    });

    expect(result.kind).toBe('tool_calls');
    expect(result.message).toContain('Checking the page');
    expect(tokens).toEqual([]);
  });
});

describe('turn input attachments', () => {
  it('includes local image attachments in turn/start input', async () => {
    let turnStartMessage: any = null;
    const mockWs = {
      send: (data: string) => {
        const msg = JSON.parse(data) as { id: number; method?: string };
        if (msg.method === 'turn/start') {
          turnStartMessage = msg;
          setTimeout(() => {
            const handlers = (mockWs as any)._messageHandlers ?? [];
            for (const handler of handlers) {
              handler({ data: JSON.stringify({ method: 'turn/completed', params: {} }) });
            }
          }, 0);
        }
      },
      addEventListener: (event: string, handler: unknown) => {
        if (event === 'message') {
          (mockWs as any)._messageHandlers = (mockWs as any)._messageHandlers ?? [];
          (mockWs as any)._messageHandlers.push(handler);
        }
      },
      removeEventListener: (_event: string, handler: unknown) => {
        const idx = (mockWs as any)._messageHandlers?.indexOf(handler) ?? -1;
        if (idx !== -1) (mockWs as any)._messageHandlers.splice(idx, 1);
      },
    } as unknown as WebSocket;

    const provider = new AppServerProvider({
      providerId: 'gpt-5.4' as any,
      modelId: 'gpt-5.4',
      process: {} as any,
    });

    await (provider as any).runOneTurn(mockWs, {
      threadId: 'thread-1',
      task: '',
      request: {
        runId: 'run-1',
        agentId: 'gpt-5.4',
        mode: 'unrestricted-dev',
        taskId: 'task-1',
        systemPrompt: 'system',
        task: '',
        tools: [],
        loadableTools: [],
        attachments: [{
          type: 'image',
          mediaType: 'image/png',
          data: 'ZmFrZQ==',
          name: 'diagram.png',
          path: '/tmp/diagram.png',
        }],
      },
      currentTools: [],
      loadableTools: [],
    });

    expect(turnStartMessage).toBeTruthy();
    expect(turnStartMessage.params.input).toEqual([
      { type: 'localImage', path: '/tmp/diagram.png' },
    ]);
  });

  it('sends multiple image attachments as separate input items in order, with text first', async () => {
    let turnStartMessage: any = null;
    const mockWs = {
      send: (data: string) => {
        const msg = JSON.parse(data) as { id: number; method?: string };
        if (msg.method === 'turn/start') {
          turnStartMessage = msg;
          setTimeout(() => {
            const handlers = (mockWs as any)._messageHandlers ?? [];
            for (const handler of handlers) {
              handler({ data: JSON.stringify({ method: 'turn/completed', params: {} }) });
            }
          }, 0);
        }
      },
      addEventListener: (event: string, handler: unknown) => {
        if (event === 'message') {
          (mockWs as any)._messageHandlers = (mockWs as any)._messageHandlers ?? [];
          (mockWs as any)._messageHandlers.push(handler);
        }
      },
      removeEventListener: (_event: string, handler: unknown) => {
        const idx = (mockWs as any)._messageHandlers?.indexOf(handler) ?? -1;
        if (idx !== -1) (mockWs as any)._messageHandlers.splice(idx, 1);
      },
    } as unknown as WebSocket;

    const provider = new AppServerProvider({
      providerId: 'gpt-5.4' as any,
      modelId: 'gpt-5.4',
      process: {} as any,
    });

    await (provider as any).runOneTurn(mockWs, {
      threadId: 'thread-1',
      task: 'Compare these screenshots',
      request: {
        runId: 'run-1',
        agentId: 'gpt-5.4',
        mode: 'unrestricted-dev',
        taskId: 'task-1',
        systemPrompt: 'system',
        task: 'Compare these screenshots',
        tools: [],
        loadableTools: [],
        attachments: [
          {
            type: 'image',
            mediaType: 'image/png',
            data: 'Zmlyc3Q=',
            name: 'first.png',
            path: '/tmp/first.png',
          },
          {
            type: 'image',
            mediaType: 'image/jpeg',
            data: 'c2Vjb25k',
            name: 'pasted-1.jpg',
          },
          {
            type: 'image',
            mediaType: 'image/webp',
            data: 'dGhpcmQ=',
            name: 'pasted-2.webp',
          },
        ],
      },
      currentTools: [],
      loadableTools: [],
    });

    expect(turnStartMessage).toBeTruthy();
    expect(turnStartMessage.params.input).toEqual([
      { type: 'text', text: 'Compare these screenshots' },
      { type: 'localImage', path: '/tmp/first.png' },
      { type: 'image', url: 'data:image/jpeg;base64,c2Vjb25k' },
      { type: 'image', url: 'data:image/webp;base64,dGhpcmQ=' },
    ]);
  });

  it('sends images without an accompanying prompt as image-only input', async () => {
    let turnStartMessage: any = null;
    const mockWs = {
      send: (data: string) => {
        const msg = JSON.parse(data) as { id: number; method?: string };
        if (msg.method === 'turn/start') {
          turnStartMessage = msg;
          setTimeout(() => {
            const handlers = (mockWs as any)._messageHandlers ?? [];
            for (const handler of handlers) {
              handler({ data: JSON.stringify({ method: 'turn/completed', params: {} }) });
            }
          }, 0);
        }
      },
      addEventListener: (event: string, handler: unknown) => {
        if (event === 'message') {
          (mockWs as any)._messageHandlers = (mockWs as any)._messageHandlers ?? [];
          (mockWs as any)._messageHandlers.push(handler);
        }
      },
      removeEventListener: (_event: string, handler: unknown) => {
        const idx = (mockWs as any)._messageHandlers?.indexOf(handler) ?? -1;
        if (idx !== -1) (mockWs as any)._messageHandlers.splice(idx, 1);
      },
    } as unknown as WebSocket;

    const provider = new AppServerProvider({
      providerId: 'gpt-5.4' as any,
      modelId: 'gpt-5.4',
      process: {} as any,
    });

    await (provider as any).runOneTurn(mockWs, {
      threadId: 'thread-1',
      task: '',
      request: {
        runId: 'run-1',
        agentId: 'gpt-5.4',
        mode: 'unrestricted-dev',
        taskId: 'task-1',
        systemPrompt: 'system',
        task: '',
        tools: [],
        loadableTools: [],
        attachments: [
          {
            type: 'image',
            mediaType: 'image/png',
            data: 'b25l',
            name: 'pasted-1.png',
          },
          {
            type: 'image',
            mediaType: 'image/png',
            data: 'dHdv',
            name: 'pasted-2.png',
          },
        ],
      },
      currentTools: [],
      loadableTools: [],
    });

    expect(turnStartMessage).toBeTruthy();
    expect(turnStartMessage.params.input).toEqual([
      { type: 'image', url: 'data:image/png;base64,b25l' },
      { type: 'image', url: 'data:image/png;base64,dHdv' },
    ]);
  });
});

describe('turn recovery', () => {
  it('reconnects and resumes an interrupted text-only turn', async () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();

    let connectedWs: WebSocket | null = ws1;
    let connectCalls = 0;
    let resumeCalls = 0;

    ws1.send = function send(data: string) {
      this.sent.push(JSON.parse(data));
      const msg = this.sent[this.sent.length - 1];
      if (msg.method === 'turn/start') {
        setTimeout(() => {
          ws1.emit('message', { data: JSON.stringify({ method: 'item/agentMessage/delta', params: { delta: 'Partial answer' } }) });
          ws1.emit('close', {});
        }, 0);
      }
    };

    ws2.send = function send(data: string) {
      this.sent.push(JSON.parse(data));
      const msg = this.sent[this.sent.length - 1];
      if (msg.method === 'turn/start') {
        setTimeout(() => {
          ws2.emit('message', { data: JSON.stringify({ method: 'item/agentMessage/delta', params: { delta: ' continued.' } }) });
          ws2.emit('message', { data: JSON.stringify({ method: 'turn/completed', params: {} }) });
        }, 0);
      }
    };

    const provider = new AppServerProvider({
      providerId: 'gpt-5.4' as any,
      modelId: 'gpt-5.4',
      process: {
        waitUntilReady: async () => ({ wsPort: 4321 }),
      } as any,
    });

    (provider as any).ws = ws1;
    (provider as any).wsPort = 4321;
    (provider as any).acquireThread = async () => 'thread-1';
    (provider as any).writeContextFile = () => {};
    (provider as any).connect = async () => {
      connectCalls += 1;
      connectedWs = ws2;
      (provider as any).ws = ws2;
    };
    (provider as any).resumeThread = async (_ws: WebSocket, _taskId: string, threadId: string) => {
      expect(threadId).toBe('thread-1');
      resumeCalls += 1;
      return threadId;
    };

    const statuses: string[] = [];
    const result = await provider.invoke({
      runId: 'run-1',
      agentId: 'gpt-5.4',
      mode: 'unrestricted-dev',
      taskId: 'task-1',
      systemPrompt: 'system',
      task: 'Write the answer.',
      tools: [],
      onStatus: (status: string) => statuses.push(status),
    });

    expect(connectCalls).toBe(1);
    expect(resumeCalls).toBe(1);
    expect(statuses).toContain('stream-recover:1 reconnecting interrupted Codex turn');
    expect(result.output).toBe('Partial answer continued.');
    expect(ws2.sent.some((msg) => msg.method === 'turn/start')).toBe(true);
    const resumedTurn = ws2.sent.find((msg) => msg.method === 'turn/start');
    expect(JSON.stringify(resumedTurn.params.input)).toContain('Your previous response was interrupted before it completed.');
    expect(JSON.stringify(resumedTurn.params.input)).toContain('Partial answer');
    expect(connectedWs).toBe(ws2);
  });
});

describe('agent message paragraph separation', () => {
  it('emits a thought-boundary status after each completed agentMessage item while streaming tokens cleanly', async () => {
    const tokens: string[] = [];
    const statuses: string[] = [];
    const mockWs = {
      send: (data: string) => {
        const msg = JSON.parse(data) as { id: number; method?: string };
        if (msg.method === 'turn/start') {
          setTimeout(() => {
            const handlers = (mockWs as any)._messageHandlers ?? [];
            const handler = handlers[0];
            if (handler) {
              // First thought streams in, then the item closes.
              handler({ data: JSON.stringify({
                method: 'item/agentMessage/delta',
                params: { delta: 'First thought.' },
              }) });
              handler({ data: JSON.stringify({
                method: 'item/completed',
                params: {
                  item: {
                    id: 'msg-1',
                    type: 'agentMessage',
                    text: 'First thought.',
                  },
                },
              }) });
              // Second thought begins — UI should see a paragraph break
              // before the new deltas.
              handler({ data: JSON.stringify({
                method: 'item/agentMessage/delta',
                params: { delta: 'Second thought.' },
              }) });
              handler({ data: JSON.stringify({
                method: 'item/completed',
                params: {
                  item: {
                    id: 'msg-2',
                    type: 'agentMessage',
                    text: 'Second thought.',
                  },
                },
              }) });
              handler({ data: JSON.stringify({ method: 'turn/completed', params: {} }) });
            }
          }, 0);
        }
      },
      addEventListener: (event: string, handler: unknown) => {
        if (event === 'message') {
          (mockWs as any)._messageHandlers = (mockWs as any)._messageHandlers ?? [];
          (mockWs as any)._messageHandlers.push(handler);
        }
      },
      removeEventListener: (_event: string, handler: unknown) => {
        const idx = (mockWs as any)._messageHandlers?.indexOf(handler) ?? -1;
        if (idx !== -1) (mockWs as any)._messageHandlers.splice(idx, 1);
      },
    } as unknown as WebSocket;

    const provider = new AppServerProvider({
      providerId: 'gpt-5.4' as any,
      modelId: 'gpt-5.4',
      process: {} as any,
    });

    const result = await (provider as any).runOneTurn(mockWs, {
      threadId: 'thread-1',
      task: 'Answer in two thoughts.',
      request: {
        runId: 'run-1',
        agentId: 'gpt-5.4',
        mode: 'unrestricted-dev',
        taskId: 'task-1',
        systemPrompt: 'system',
        task: 'Answer in two thoughts.',
        tools: [],
        loadableTools: [],
        onToken: (text: string) => tokens.push(text),
        onStatus: (status: string) => statuses.push(status),
      },
      currentTools: [],
      loadableTools: [],
    });

    expect(result.kind).toBe('final');
    // Tokens stream the raw text deltas only. Paragraph breaks are NOT
    // emitted as sentinel tokens anymore — the renderer commits each
    // thought into a separate slot using the `thought-boundary` status
    // below. This keeps the live typewriter buffer free of out-of-band
    // separators that used to cause pacing glitches.
    expect(tokens).toEqual(['First thought.', 'Second thought.']);
    // Exactly one thought-boundary per completed agentMessage item.
    expect(statuses.filter(s => s === 'thought-boundary')).toHaveLength(2);
    // The final published message still separates the two thoughts with a
    // blank line (the accumulated buffer keeps the \n\n for downstream
    // consumers and for the canonical `result.output`). Trailing whitespace
    // is trimmed before publish.
    expect(result.message).toBe('First thought.\n\nSecond thought.');
  });

  it('uses the last completed agentMessage when the completed items are cumulative snapshots', async () => {
    const mockWs = {
      send: (data: string) => {
        const msg = JSON.parse(data) as { id: number; method?: string };
        if (msg.method === 'turn/start') {
          setTimeout(() => {
            const handlers = (mockWs as any)._messageHandlers ?? [];
            const handler = handlers[0];
            if (handler) {
              handler({ data: JSON.stringify({
                method: 'item/agentMessage/delta',
                params: { delta: 'I found multiple relevant Reddit threads on Gemini models.' },
              }) });
              handler({ data: JSON.stringify({
                method: 'item/completed',
                params: {
                  item: {
                    id: 'msg-1',
                    type: 'agentMessage',
                    text: 'I found multiple relevant Reddit threads on Gemini models.',
                  },
                },
              }) });
              handler({ data: JSON.stringify({
                method: 'item/agentMessage/delta',
                params: { delta: ' I found relevant Reddit discussions already:\n- r/GeminiAI: practical advice on model choice.' },
              }) });
              handler({ data: JSON.stringify({
                method: 'item/completed',
                params: {
                  item: {
                    id: 'msg-2',
                    type: 'agentMessage',
                    text: 'I found multiple relevant Reddit threads on Gemini models.\n\nI found relevant Reddit discussions already:\n- r/GeminiAI: practical advice on model choice.',
                  },
                },
              }) });
              handler({ data: JSON.stringify({ method: 'turn/completed', params: {} }) });
            }
          }, 0);
        }
      },
      addEventListener: (event: string, handler: unknown) => {
        if (event === 'message') {
          (mockWs as any)._messageHandlers = (mockWs as any)._messageHandlers ?? [];
          (mockWs as any)._messageHandlers.push(handler);
        }
      },
      removeEventListener: (_event: string, handler: unknown) => {
        const idx = (mockWs as any)._messageHandlers?.indexOf(handler) ?? -1;
        if (idx !== -1) (mockWs as any)._messageHandlers.splice(idx, 1);
      },
    } as unknown as WebSocket;

    const provider = new AppServerProvider({
      providerId: 'gpt-5.4' as any,
      modelId: 'gpt-5.4',
      process: {} as any,
    });

    const result = await (provider as any).runOneTurn(mockWs, {
      threadId: 'thread-1',
      task: 'Answer directly.',
      request: {
        runId: 'run-1',
        agentId: 'gpt-5.4',
        mode: 'unrestricted-dev',
        taskId: 'task-1',
        systemPrompt: 'system',
        task: 'Answer directly.',
        tools: [],
        loadableTools: [],
      },
      currentTools: [],
      loadableTools: [],
    });

    expect(result.kind).toBe('final');
    expect(result.message).toBe(
      'I found multiple relevant Reddit threads on Gemini models.\n\nI found relevant Reddit discussions already:\n- r/GeminiAI: practical advice on model choice.',
    );
  });
});

describe('turn boundary signalling', () => {
  it('emits a turn-boundary onStatus between tool-calling turns so the UI clears the prior descriptive line', async () => {
    const ws = createMockWs();
    let turnStartCount = 0;

    ws.send = function send(data: string) {
      this.sent.push(JSON.parse(data));
      const msg = this.sent[this.sent.length - 1];
      if (msg.method === 'turn/start') {
        turnStartCount += 1;
        const isFirstTurn = turnStartCount === 1;
        setTimeout(() => {
          if (isFirstTurn) {
            ws.emit('message', { data: JSON.stringify({
              method: 'item/agentMessage/delta',
              params: { delta: 'First, I will check the page.' },
            }) });
            ws.emit('message', { data: JSON.stringify({
              method: 'item/started',
              params: {
                item: {
                  id: 'mcp-1',
                  type: 'mcpToolCall',
                  server: 'v2-tools',
                  tool: 'browser__snapshot',
                  arguments: {},
                },
              },
            }) });
            ws.emit('message', { data: JSON.stringify({
              method: 'item/completed',
              params: {
                item: {
                  id: 'mcp-1',
                  type: 'mcpToolCall',
                  server: 'v2-tools',
                  tool: 'browser__snapshot',
                  arguments: {},
                  result: { ok: true },
                  error: null,
                },
              },
            }) });
            ws.emit('message', { data: JSON.stringify({ method: 'turn/completed', params: {} }) });
          } else {
            ws.emit('message', { data: JSON.stringify({
              method: 'item/agentMessage/delta',
              params: { delta: 'Now here is my final answer.' },
            }) });
            ws.emit('message', { data: JSON.stringify({ method: 'turn/completed', params: {} }) });
          }
        }, 0);
      }
    };

    const provider = new AppServerProvider({
      providerId: 'gpt-5.4' as any,
      modelId: 'gpt-5.4',
      process: {} as any,
    });
    (provider as any).ws = ws;
    (provider as any).acquireThread = async () => 'thread-1';
    (provider as any).writeContextFile = () => {};

    const statuses: string[] = [];
    const tokens: string[] = [];
    const result = await provider.invoke({
      runId: 'run-1',
      agentId: 'gpt-5.4',
      mode: 'unrestricted-dev',
      taskId: 'task-1',
      systemPrompt: 'system',
      task: 'Take a snapshot and answer.',
      tools: [],
      onStatus: (status: string) => statuses.push(status),
      onToken: (text: string) => tokens.push(text),
    } as any);

    expect(turnStartCount).toBe(2);
    expect(result.output).toBe('Now here is my final answer.');
    const turnStarts = ws.sent.filter((msg) => msg.method === 'turn/start');
    expect(turnStarts).toHaveLength(2);
    // Post-tool turn sends a minimal single-word nudge. The previous
    // multi-sentence prompt was injected as a user turn on every tool
    // boundary and measurably biased the model toward re-issuing tools
    // (duplicate browser.open_tab observed in smoke tests). Keep the
    // payload to a neutral, non-directive continuation token.
    expect(turnStarts[1].params.input).toEqual([
      { type: 'text', text: 'continue' },
    ]);
    // The exact ordering matters: the tool lifecycle for turn 1 comes first,
    // THEN the turn-boundary, THEN the next turn's deltas. The UI relies on
    // this order to clear the prior descriptive text before new deltas arrive.
    const turnBoundaryIdx = statuses.indexOf('turn-boundary');
    const toolDoneIdx = statuses.findIndex(s => s.startsWith('tool-done:'));
    expect(turnBoundaryIdx).toBeGreaterThan(-1);
    expect(toolDoneIdx).toBeGreaterThan(-1);
    expect(turnBoundaryIdx).toBeGreaterThan(toolDoneIdx);
    // Tokens for both turns still flow through the same onToken channel;
    // the UI uses the turn-boundary signal (not token gaps) to reset.
    expect(tokens.join('')).toBe('Now here is my final answer.');
  });

  it('does not emit a turn-boundary after a final turn', async () => {
    const ws = createMockWs();

    ws.send = function send(data: string) {
      this.sent.push(JSON.parse(data));
      const msg = this.sent[this.sent.length - 1];
      if (msg.method === 'turn/start') {
        setTimeout(() => {
          ws.emit('message', { data: JSON.stringify({
            method: 'item/agentMessage/delta',
            params: { delta: 'The answer.' },
          }) });
          ws.emit('message', { data: JSON.stringify({ method: 'turn/completed', params: {} }) });
        }, 0);
      }
    };

    const provider = new AppServerProvider({
      providerId: 'gpt-5.4' as any,
      modelId: 'gpt-5.4',
      process: {} as any,
    });
    (provider as any).ws = ws;
    (provider as any).acquireThread = async () => 'thread-1';
    (provider as any).writeContextFile = () => {};

    const statuses: string[] = [];
    await provider.invoke({
      runId: 'run-1',
      agentId: 'gpt-5.4',
      mode: 'unrestricted-dev',
      taskId: 'task-1',
      systemPrompt: 'system',
      task: 'Answer directly.',
      tools: [],
      onStatus: (status: string) => statuses.push(status),
    } as any);

    expect(statuses).not.toContain('turn-boundary');
  });
});

describe('answer.submit terminal-turn detection', () => {
  // When the model's last turn contains both `agentMessage` items and a
  // successful `answer.submit` tool call, the provider used to classify the
  // turn as `tool_calls` (because tools fired) and loop for one more turn.
  // The model usually had nothing more to say, so the next turn either hung
  // (Codex keeps the socket warm with tokenUsage updates, resetting our
  // per-message timer indefinitely) or returned an empty final that
  // clobbered the already-rendered text. Either way the live-run card was
  // stuck on "Exploring ideas". Treat a successful answer.submit as the
  // terminal signal regardless of whether other tools fired.
  it('resolves the turn as final when a successful answer.submit is among its tool calls', async () => {
    const ws = createMockWs();
    let turnStartCount = 0;

    ws.send = function send(data: string) {
      this.sent.push(JSON.parse(data));
      const msg = this.sent[this.sent.length - 1];
      if (msg.method === 'turn/start') {
        turnStartCount += 1;
        setTimeout(() => {
          ws.emit('message', { data: JSON.stringify({
            method: 'item/agentMessage/delta',
            params: { delta: 'Here is the final answer grounded in the run.' },
          }) });
          ws.emit('message', { data: JSON.stringify({
            method: 'item/started',
            params: {
              item: {
                id: 'mcp-submit',
                type: 'mcpToolCall',
                server: 'v2-tools',
                tool: 'answer__submit',
                arguments: { claims: [], unresolved: [] },
              },
            },
          }) });
          ws.emit('message', { data: JSON.stringify({
            method: 'item/completed',
            params: {
              item: {
                id: 'mcp-submit',
                type: 'mcpToolCall',
                server: 'v2-tools',
                tool: 'answer__submit',
                arguments: { claims: [], unresolved: [] },
                result: { summary: 'answer accepted' },
                error: null,
              },
            },
          }) });
          ws.emit('message', { data: JSON.stringify({ method: 'turn/completed', params: {} }) });
        }, 0);
      }
    };

    const provider = new AppServerProvider({
      providerId: 'gpt-5.4' as any,
      modelId: 'gpt-5.4',
      process: {} as any,
    });
    (provider as any).ws = ws;
    (provider as any).acquireThread = async () => 'thread-1';
    (provider as any).writeContextFile = () => {};

    const statuses: string[] = [];
    const result = await provider.invoke({
      runId: 'run-1',
      agentId: 'gpt-5.4',
      mode: 'unrestricted-dev',
      taskId: 'task-1',
      systemPrompt: 'system',
      task: 'Answer with evidence.',
      tools: [],
      onStatus: (status: string) => statuses.push(status),
    } as any);

    // Exactly one turn: answer.submit is terminal.
    expect(turnStartCount).toBe(1);
    expect(result.output).toBe('Here is the final answer grounded in the run.');
    // No turn-boundary — the UI must flip straight to the done state
    // instead of showing "Exploring ideas" while we wait for a turn
    // that would never come.
    expect(statuses).not.toContain('turn-boundary');
  });

  it('treats a failed answer.submit as a regular tool call, not a terminal signal', async () => {
    const ws = createMockWs();
    let turnStartCount = 0;

    ws.send = function send(data: string) {
      this.sent.push(JSON.parse(data));
      const msg = this.sent[this.sent.length - 1];
      if (msg.method === 'turn/start') {
        turnStartCount += 1;
        const isFirstTurn = turnStartCount === 1;
        setTimeout(() => {
          if (isFirstTurn) {
            ws.emit('message', { data: JSON.stringify({
              method: 'item/started',
              params: {
                item: {
                  id: 'mcp-submit-fail',
                  type: 'mcpToolCall',
                  server: 'v2-tools',
                  tool: 'answer__submit',
                  arguments: { claims: [], unresolved: [] },
                },
              },
            }) });
            ws.emit('message', { data: JSON.stringify({
              method: 'item/completed',
              params: {
                item: {
                  id: 'mcp-submit-fail',
                  type: 'mcpToolCall',
                  server: 'v2-tools',
                  tool: 'answer__submit',
                  arguments: { claims: [], unresolved: [] },
                  result: null,
                  error: { message: 'GROUNDING FAIL' },
                },
              },
            }) });
            ws.emit('message', { data: JSON.stringify({ method: 'turn/completed', params: {} }) });
          } else {
            ws.emit('message', { data: JSON.stringify({
              method: 'item/agentMessage/delta',
              params: { delta: 'Revised answer.' },
            }) });
            ws.emit('message', { data: JSON.stringify({ method: 'turn/completed', params: {} }) });
          }
        }, 0);
      }
    };

    const provider = new AppServerProvider({
      providerId: 'gpt-5.4' as any,
      modelId: 'gpt-5.4',
      process: {} as any,
    });
    (provider as any).ws = ws;
    (provider as any).acquireThread = async () => 'thread-1';
    (provider as any).writeContextFile = () => {};

    const result = await provider.invoke({
      runId: 'run-1',
      agentId: 'gpt-5.4',
      mode: 'unrestricted-dev',
      taskId: 'task-1',
      systemPrompt: 'system',
      task: 'Answer with evidence.',
      tools: [],
    } as any);

    // Failed answer.submit should loop once more so the model can revise.
    expect(turnStartCount).toBe(2);
    expect(result.output).toBe('Revised answer.');
  });
});

describe('turn idle timer', () => {
  // The previous implementation reset the 3-minute turn deadline on every
  // incoming message, so Codex's tokenUsage keepalives (sent while the
  // model is thinking) could indefinitely defer the timeout. If the
  // app-server failed to emit `turn/completed` at all, the UI would sit
  // forever. A separate idle timer fires on message-silence regardless of
  // the longer wall-clock budget.
  it('times out a turn when no messages arrive within the idle window, even if the wall-clock budget has not expired', async () => {
    vi.useFakeTimers();
    try {
      const ws = createMockWs();
      ws.send = function send(data: string) {
        this.sent.push(JSON.parse(data));
        // Do not emit any response — simulate a stalled Codex turn.
      };

      const provider = new AppServerProvider({
        providerId: 'gpt-5.4' as any,
        modelId: 'gpt-5.4',
        process: {} as any,
      });

      const promise = (provider as any).runOneTurn(ws, {
        threadId: 'thread-1',
        task: 'Do something.',
        request: {
          runId: 'run-1',
          agentId: 'gpt-5.4',
          mode: 'unrestricted-dev',
          taskId: 'task-1',
          systemPrompt: 'system',
          task: 'Do something.',
          tools: [],
        },
        currentTools: [],
      });

      // Attach a catch handler synchronously so the eventual rejection
      // does not surface as an unhandled rejection while we advance
      // timers.
      const settled: { error?: Error } = {};
      promise.catch((err: Error) => { settled.error = err; });

      // 45 seconds of silence — well past the 30s idle deadline, well
      // below the 3-minute wall-clock budget. The old implementation
      // would have waited the full 3 minutes.
      await vi.advanceTimersByTimeAsync(45_000);

      expect(settled.error).toBeDefined();
      expect(settled.error?.message).toMatch(/idle/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not fire the idle timer while messages keep arriving', async () => {
    vi.useFakeTimers();
    try {
      const ws = createMockWs();
      let heartbeats = 0;
      ws.send = function send(data: string) {
        this.sent.push(JSON.parse(data));
        const msg = this.sent[this.sent.length - 1];
        if (msg.method === 'turn/start') {
          // Emit a tokenUsage notification every 10s for 60s — longer
          // than the 30s idle window but shorter than the 3-minute
          // wall-clock. Then finally resolve the turn.
          const scheduleHeartbeat = () => {
            setTimeout(() => {
              heartbeats += 1;
              ws.emit('message', { data: JSON.stringify({
                method: 'thread/tokenUsage/updated',
                params: { tokenUsage: { last: { inputTokens: 1, outputTokens: 1 } } },
              }) });
              if (heartbeats < 6) scheduleHeartbeat();
              else {
                setTimeout(() => {
                  ws.emit('message', { data: JSON.stringify({
                    method: 'item/agentMessage/delta',
                    params: { delta: 'done' },
                  }) });
                  ws.emit('message', { data: JSON.stringify({ method: 'turn/completed', params: {} }) });
                }, 5_000);
              }
            }, 10_000);
          };
          scheduleHeartbeat();
        }
      };

      const provider = new AppServerProvider({
        providerId: 'gpt-5.4' as any,
        modelId: 'gpt-5.4',
        process: {} as any,
      });

      const promise = (provider as any).runOneTurn(ws, {
        threadId: 'thread-1',
        task: 'Do something.',
        request: {
          runId: 'run-1',
          agentId: 'gpt-5.4',
          mode: 'unrestricted-dev',
          taskId: 'task-1',
          systemPrompt: 'system',
          task: 'Do something.',
          tools: [],
        },
        currentTools: [],
      });

      // Drive the fake clock in small steps so the scheduled heartbeat
      // setTimeouts fire in order.
      await vi.advanceTimersByTimeAsync(70_000);

      const result = await promise;
      expect(result.kind).toBe('final');
      expect(heartbeats).toBe(6);
    } finally {
      vi.useRealTimers();
    }
  });
});
