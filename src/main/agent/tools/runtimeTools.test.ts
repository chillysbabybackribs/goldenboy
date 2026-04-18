import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeToolDefinitions } from './runtimeTools';
import type { AgentToolContext } from '../AgentTypes';

const { executeMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
}));

vi.mock('../AgentToolExecutor', () => ({
  agentToolExecutor: {
    execute: executeMock,
  },
}));

function getTool(name: string) {
  const tool = createRuntimeToolDefinitions().find((entry) => entry.name === name);
  if (!tool) {
    throw new Error(`Missing tool definition for ${name}`);
  }
  return tool;
}

describe('runtime tools', () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  it('reports callable-vs-next-turn metadata for search results', async () => {
    const tool = getTool('runtime.search_tools');
    const context: AgentToolContext = {
      runId: 'run-1',
      agentId: 'codex',
      mode: 'unrestricted-dev',
      toolNames: ['runtime.search_tools', 'browser.get_tabs'],
      toolCatalog: [
        { name: 'runtime.search_tools', description: 'Search the tool catalog.', inputSchema: {} },
        { name: 'browser.get_tabs', description: 'List open browser tabs.', inputSchema: {} },
        { name: 'browser.close_tab', description: 'Close one browser tab.', inputSchema: {} },
      ],
    };

    const result = await tool.execute({ query: 'close browser tabs', limit: 2 }, context);
    expect(result.data.matches).toEqual([
      expect.objectContaining({
        name: 'browser.close_tab',
        bindingState: 'discoverable',
        callableNow: false,
        invokableNow: true,
        invocationMethod: 'runtime.invoke_tool',
        availableNextTurn: true,
      }),
      expect.objectContaining({
        name: 'browser.get_tabs',
        bindingState: 'callable',
        callableNow: true,
        invokableNow: true,
        invocationMethod: 'direct',
        availableNextTurn: false,
      }),
    ]);
    expect(result.data.hydration).toEqual({
      callableNow: ['browser.get_tabs'],
      invokableNow: ['browser.close_tab', 'browser.get_tabs'],
      availableNextTurn: ['browser.close_tab'],
      failed: [],
    });
  });

  it('grants exact tools for immediate runtime invocation', async () => {
    const tool = getTool('runtime.require_tools');
    const result = await tool.execute({
      tools: ['browser.close_tab', 'browser.get_tabs'],
      mode: 'exact',
      availability: 'now',
    }, {
      runId: 'run-1',
      agentId: 'codex',
      mode: 'unrestricted-dev',
      toolNames: ['runtime.require_tools', 'browser.get_tabs'],
      toolCatalog: [
        { name: 'runtime.require_tools', description: 'Require exact tools.', inputSchema: {} },
        { name: 'browser.get_tabs', description: 'List open browser tabs.', inputSchema: {} },
        { name: 'browser.close_tab', description: 'Close one browser tab.', inputSchema: {} },
      ],
    });

    expect(result.data).toEqual({
      mode: 'exact',
      availability: 'now',
      requestedTools: ['browser.close_tab', 'browser.get_tabs'],
      grantedNow: ['browser.close_tab', 'browser.get_tabs'],
      alreadyCallable: ['browser.get_tabs'],
      denied: [],
      invocationTool: 'runtime.invoke_tool',
    });
  });

  it('invokes exact tools through the runtime gateway', async () => {
    executeMock.mockResolvedValue({
      summary: 'Closed 1 tab',
      data: { closed: 1 },
    });

    const tool = getTool('runtime.invoke_tool');
    const context: AgentToolContext = {
      runId: 'run-1',
      agentId: 'codex',
      mode: 'unrestricted-dev',
      toolNames: ['runtime.invoke_tool'],
      toolCatalog: [
        { name: 'runtime.invoke_tool', description: 'Invoke exact tools.', inputSchema: {} },
        { name: 'browser.close_tab', description: 'Close one browser tab.', inputSchema: {} },
      ],
    };

    const result = await tool.execute({
      tool: 'browser.close_tab',
      input: { tabId: 'tab-1' },
    }, context);

    expect(executeMock).toHaveBeenCalledWith('browser.close_tab', { tabId: 'tab-1' }, context);
    expect(result.summary).toBe('Invoked browser.close_tab: Closed 1 tab');
    expect(result.data).toEqual({
      tool: 'browser.close_tab',
      invokedVia: 'runtime.invoke_tool',
      result: {
        summary: 'Closed 1 tab',
        data: { closed: 1 },
      },
    });
  });

  it('rejects malformed nested tool input before dispatching to the target tool', async () => {
    const tool = getTool('runtime.invoke_tool');
    const context: AgentToolContext = {
      runId: 'run-1',
      agentId: 'codex',
      mode: 'unrestricted-dev',
      toolNames: ['runtime.invoke_tool'],
      toolCatalog: [
        { name: 'runtime.invoke_tool', description: 'Invoke exact tools.', inputSchema: {} },
        {
          name: 'browser.research_search',
          description: 'Research search',
          inputSchema: {
            type: 'object',
            required: ['query'],
            properties: {
              query: { type: 'string' },
              maxPages: { type: 'number' },
            },
          },
        },
      ],
    };

    await expect(tool.execute({
      tool: 'browser.research_search',
      input: '{"query":"pricing"}',
    }, context)).rejects.toThrow(
      'Invalid input for browser.research_search: input must be an object; got string.',
    );
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('surfaces missing required nested properties with path-aware errors', async () => {
    const tool = getTool('runtime.invoke_tool');
    const context: AgentToolContext = {
      runId: 'run-1',
      agentId: 'codex',
      mode: 'unrestricted-dev',
      toolNames: ['runtime.invoke_tool'],
      toolCatalog: [
        { name: 'runtime.invoke_tool', description: 'Invoke exact tools.', inputSchema: {} },
        {
          name: 'browser.research_search',
          description: 'Research search',
          inputSchema: {
            type: 'object',
            required: ['query'],
            properties: {
              query: { type: 'string' },
              maxPages: { type: 'number' },
            },
          },
        },
      ],
    };

    await expect(tool.execute({
      tool: 'browser.research_search',
      input: { maxPages: 2 },
    }, context)).rejects.toThrow(
      'Invalid input for browser.research_search: input.query is required.',
    );
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('returns next-turn hydration metadata for requested packs', async () => {
    const tool = getTool('runtime.request_tool_pack');
    const result = await tool.execute({ pack: 'debug' }, {
      runId: 'run-1',
      agentId: 'codex',
      mode: 'unrestricted-dev',
      toolCatalog: [],
    });

    expect(result.data.pack).toBe('debug');
    expect(result.data.hydration).toEqual({
      callableNow: [],
      availableNextTurn: expect.arrayContaining(['browser.evaluate_js', 'terminal.exec']),
      failed: [],
    });
  });
});
