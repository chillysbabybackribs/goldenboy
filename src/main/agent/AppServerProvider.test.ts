import { describe, it, expect } from 'vitest';
import { pruneExpiredEntries } from './AppServerProvider';
import { AppServerProvider } from './AppServerProvider';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

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
});

describe('turn text emission', () => {
  it('does not stream interim assistant text for tool-calling turns', async () => {
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
        onToken: (text: string) => tokens.push(text),
      },
      currentTools: [],
      toolCatalog: [],
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

    expect(turnStartMessage).toBeTruthy();
    expect(turnStartMessage.params.input).toEqual([
      { type: 'local_image', path: '/tmp/diagram.png' },
    ]);
  });
});
