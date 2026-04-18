import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HAIKU_PROVIDER_ID, PRIMARY_PROVIDER_ID } from '../../shared/types/model';

const { executeMock, recordToolMessageMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  recordToolMessageMock: vi.fn(),
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

import {
  applyAutoExpandedToolPack,
  applyRuntimeToolExpansion,
  executeProviderToolCall,
  executeProviderToolCallWithEvents,
  formatAutoExpandedToolPackLines,
  formatQueuedExpansionLines,
  normalizeProviderMaxToolTurns,
  publishProviderFinalOutput,
} from './providerToolRuntime';
import { createToolBindingStore } from './toolBindingScope';

describe('providerToolRuntime', () => {
  beforeEach(() => {
    executeMock.mockReset();
    recordToolMessageMock.mockReset();
  });

  it('normalizes provider max tool turns to runtime bounds', () => {
    expect(normalizeProviderMaxToolTurns()).toBe(20);
    expect(normalizeProviderMaxToolTurns(0)).toBe(1);
    expect(normalizeProviderMaxToolTurns(999)).toBe(40);
  });

  it('formats successful tool results and records tool memory', async () => {
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

    const result = await executeProviderToolCall({
      providerId: PRIMARY_PROVIDER_ID,
      request: {
        runId: 'run-1',
        agentId: PRIMARY_PROVIDER_ID,
        mode: 'unrestricted-dev',
        taskId: 'task-1',
        promptTools: [],
        toolCatalog: [],
        toolBindings: [],
      },
      toolName: 'filesystem.list',
      toolInput: { path: '.' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected successful tool execution');
    expect(result.resultDescription).toBe('Listed 3 files');
    expect(result.toolContent).toContain('Listed 3 files');
    expect(result.toolContent).toContain('RUNTIME VALIDATION');
    expect(recordToolMessageMock).toHaveBeenCalledWith(
      'task-1',
      expect.stringContaining('"tool": "filesystem.list"'),
      PRIMARY_PROVIDER_ID,
      'run-1',
    );
  });

  it('queues searched tools through the shared binding store helper', () => {
    const toolBindingStore = createToolBindingStore([
      { name: 'runtime.search_tools', description: 'Search tools', inputSchema: {} },
    ], [
      { name: 'runtime.search_tools', description: 'Search tools', inputSchema: {} },
      { name: 'browser.close_tab', description: 'Close a browser tab', inputSchema: {} },
    ]);

    const expansion = applyRuntimeToolExpansion({
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

    expect(expansion).toMatchObject({
      pack: 'tool-search',
      tools: ['browser.close_tab'],
    });
    expect(toolBindingStore.getCallableTools().map((tool) => tool.name)).toEqual(['runtime.search_tools']);
    expect(toolBindingStore.beginTurn().map((tool) => tool.name)).toEqual([
      'runtime.search_tools',
      'browser.close_tab',
    ]);
  });

  it('queues auto-expanded packs through the shared binding store helper', () => {
    const toolBindingStore = createToolBindingStore([
      { name: 'runtime.request_tool_pack', description: 'Load a tool pack', inputSchema: {} },
    ], [
      { name: 'runtime.request_tool_pack', description: 'Load a tool pack', inputSchema: {} },
      { name: 'browser.get_tabs', description: 'Get browser tabs', inputSchema: {} },
    ]);

    const expansion = applyAutoExpandedToolPack({
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

    expect(expansion).toMatchObject({
      pack: 'browser-automation',
      tools: ['browser.get_tabs'],
    });
    expect(toolBindingStore.getCallableTools().map((tool) => tool.name)).toEqual(['runtime.request_tool_pack']);
    expect(toolBindingStore.beginTurn().map((tool) => tool.name)).toEqual([
      'runtime.request_tool_pack',
      'browser.get_tabs',
    ]);
  });

  it('formats queued expansion notes consistently for provider transcripts', () => {
    expect(formatQueuedExpansionLines({
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

    expect(formatQueuedExpansionLines({
      pack: 'research',
      description: 'Research tools',
      scope: 'named',
      tools: ['browser.research_search'],
      relatedPackIds: [],
    }, { style: 'haiku' })[0]).toBe('Queued tool pack "research" for the next turn.');
  });

  it('formats auto-expanded pack notes consistently for provider prompts', () => {
    expect(formatAutoExpandedToolPackLines({
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

  it('enriches filesystem list summaries with entry previews', async () => {
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

    const result = await executeProviderToolCall({
      providerId: PRIMARY_PROVIDER_ID,
      request: {
        runId: 'run-fs',
        agentId: PRIMARY_PROVIDER_ID,
        mode: 'unrestricted-dev',
        taskId: 'task-fs',
        promptTools: [],
        toolCatalog: [],
        toolBindings: [],
      },
      toolName: 'filesystem.list',
      toolInput: { path: '.' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected successful tool execution');
    expect(result.resultDescription).toContain('README.md');
    expect(result.resultDescription).toContain('docs');
  });

  it('enriches terminal summaries with the first output line', async () => {
    executeMock.mockResolvedValue({
      summary: 'Executed command: npm test (exit 0)',
      data: {
        exitCode: 0,
        output: '\n142 tests passed\nall green\n',
      },
    });

    const result = await executeProviderToolCall({
      providerId: PRIMARY_PROVIDER_ID,
      request: {
        runId: 'run-term',
        agentId: PRIMARY_PROVIDER_ID,
        mode: 'unrestricted-dev',
        taskId: 'task-term',
        promptTools: [],
        toolCatalog: [],
        toolBindings: [],
      },
      toolName: 'terminal.exec',
      toolInput: { command: 'npm test' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected successful tool execution');
    expect(result.resultDescription).toBe('exit 0: 142 tests passed');
  });

  it('enriches browser research summaries with opened-page previews', async () => {
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

    const result = await executeProviderToolCall({
      providerId: PRIMARY_PROVIDER_ID,
      request: {
        runId: 'run-browser',
        agentId: PRIMARY_PROVIDER_ID,
        mode: 'unrestricted-dev',
        taskId: 'task-browser',
        promptTools: [],
        toolCatalog: [],
        toolBindings: [],
      },
      toolName: 'browser.research_search',
      toolInput: { query: 'claude code reddit' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected successful tool execution');
    expect(result.resultDescription).toContain('Claude Code on Reddit');
    expect(result.resultDescription).toContain('Best Claude Code workflows');
  });

  it('emits status and item lifecycle events around tool execution', async () => {
    executeMock.mockResolvedValue({
      summary: 'Listed 3 files',
      data: { entries: ['a.ts', 'b.ts', 'c.ts'] },
    });

    const statusUpdates: string[] = [];
    const itemEvents: Array<{ eventType: string; status: string }> = [];

    const result = await executeProviderToolCallWithEvents({
      providerId: HAIKU_PROVIDER_ID,
      request: {
        runId: 'run-3',
        agentId: HAIKU_PROVIDER_ID,
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

    expect(result.ok).toBe(true);
    expect(statusUpdates).toEqual([
      'tool-start:Files: list .',
      'tool-done:Files: list . -> Listed 3 files',
    ]);
    expect(itemEvents).toEqual([
      { eventType: 'item.started', status: 'in_progress' },
      { eventType: 'item.completed', status: 'completed' },
    ]);
  });

  it('passes a progress callback into tool execution context', async () => {
    const statusUpdates: string[] = [];
    executeMock.mockImplementation(async (_toolName, _toolInput, context) => {
      context.onProgress?.('tool-progress:Browser: research "x" -> opening result 1');
      return {
        summary: 'done',
        data: {},
      };
    });

    await executeProviderToolCallWithEvents({
      providerId: PRIMARY_PROVIDER_ID,
      request: {
        runId: 'run-progress',
        agentId: PRIMARY_PROVIDER_ID,
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

    expect(statusUpdates).toEqual([
      'tool-start:Browser: research "x"',
      'tool-progress:Browser: research "x" -> opening result 1',
      'tool-done:Browser: research "x" -> done',
    ]);
  });

  it('records tool errors for non-chat tools', async () => {
    executeMock.mockRejectedValue(new Error('tool exploded'));

    const result = await executeProviderToolCall({
      providerId: HAIKU_PROVIDER_ID,
      request: {
        runId: 'run-2',
        agentId: HAIKU_PROVIDER_ID,
        mode: 'unrestricted-dev',
        taskId: 'task-2',
        promptTools: [],
        toolCatalog: [],
        toolBindings: [],
      },
      toolName: 'terminal.exec',
      toolInput: { command: 'npm test' },
    });

    expect(result).toEqual({
      ok: false,
      errorMessage: 'tool exploded',
    });
    expect(recordToolMessageMock).toHaveBeenCalledWith(
      'task-2',
      expect.stringContaining('"error": "tool exploded"'),
      HAIKU_PROVIDER_ID,
      'run-2',
    );
  });

  it('publishes normalized final output without duplicating tokens when disabled', () => {
    const tokens: string[] = [];
    const itemEvents: string[] = [];

    const item = publishProviderFinalOutput({
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

    expect(item.text).toContain('The run ended without a text response.');
    expect(tokens).toEqual([]);
    expect(itemEvents).toEqual(['item.completed']);
  });
});
