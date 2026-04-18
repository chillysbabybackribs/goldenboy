import { describe, it, expect, vi } from 'vitest';
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
  it('streams assistant deltas immediately for tool-calling turns', async () => {
    const tokens: string[] = [];
    const statuses: string[] = [];
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
        promptTools: [],
        toolCatalog: [],
        toolBindings: [],
        onToken: (text: string) => tokens.push(text),
        onStatus: (status: string) => statuses.push(status),
      },
      currentTools: [],
      toolCatalog: [],
    });

    expect(result.kind).toBe('tool_calls');
    expect(result.message).toContain('Checking the page');
    expect(tokens).toEqual(['Checking the page before I click.']);
    expect(statuses).toContain('thought-migrate');
  });

  it('suppresses generic post-tool procedural thoughts from status updates', async () => {
    const statuses: string[] = [];
    const mockWs = {
      send: (data: string) => {
        const msg = JSON.parse(data) as { method?: string };
        if (msg.method === 'turn/start') {
          setTimeout(() => {
            const handlers = (mockWs as any)._messageHandlers ?? [];
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
        onStatus: (status: string) => statuses.push(status),
      },
      currentTools: [],
      toolCatalog: [],
    });

    expect(statuses.some((status) => status.startsWith('thought:'))).toBe(false);
  });

  it('keeps blocker-style post-tool questions in status updates', async () => {
    const statuses: string[] = [];
    const mockWs = {
      send: (data: string) => {
        const msg = JSON.parse(data) as { method?: string };
        if (msg.method === 'turn/start') {
          setTimeout(() => {
            const handlers = (mockWs as any)._messageHandlers ?? [];
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
        onStatus: (status: string) => statuses.push(status),
      },
      currentTools: [],
      toolCatalog: [],
    });

    expect(statuses).toContain('thought:Which environment should I use?');
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

    expect(turnStartMessage).toBeTruthy();
    expect(turnStartMessage.params.input).toEqual([
      { type: 'local_image', path: '/tmp/diagram.png' },
    ]);
  });
});

describe('tool scope promotion', () => {
  it('writes only callable tools to the app-server context file for each turn', async () => {
    const provider = new AppServerProvider({
      providerId: 'gpt-5.4' as any,
      modelId: 'gpt-5.4',
      process: {} as any,
    });

    const writtenToolNames: string[][] = [];
    (provider as any).ws = {} as WebSocket;
    (provider as any).acquireThread = vi.fn(async () => 'thread-1');
    (provider as any).writeContextFile = vi.fn((_request: unknown, tools?: Array<{ name: string }>) => {
      writtenToolNames.push((tools ?? []).map((tool) => tool.name));
    });

    let turnCount = 0;
    (provider as any).runOneTurn = vi.fn(async (_ws: WebSocket, params: { currentTools: Array<{ name: string }> }) => {
      turnCount += 1;
      if (turnCount === 1) {
        expect(params.currentTools.map((tool) => tool.name)).toEqual(['runtime.search_tools']);
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

      expect(params.currentTools.map((tool) => tool.name)).toEqual([
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
      onToken: vi.fn(),
    });

    expect(result.output).toBe('Done');
    expect(writtenToolNames).toEqual([
      ['runtime.search_tools'],
      ['runtime.search_tools', 'browser.close_tab'],
    ]);
    expect((provider as any).runOneTurn).toHaveBeenCalledTimes(2);
  });
});
