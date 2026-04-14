import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentProviderRequest, AgentToolDefinition } from './AgentTypes';
import { PRIMARY_PROVIDER_ID } from '../../shared/types/model';

const { dispatchMock, recordToolMessageMock } = vi.hoisted(() => ({
  dispatchMock: vi.fn(),
  recordToolMessageMock: vi.fn(),
}));

vi.mock('../state/appStateStore', () => ({
  appStateStore: {
    dispatch: dispatchMock,
  },
}));

vi.mock('../chatKnowledge/ChatKnowledgeStore', () => ({
  chatKnowledgeStore: {
    recordToolMessage: recordToolMessageMock,
  },
}));

import { AgentRuntime, assertInitialBrowserScope } from './AgentRuntime';
import { agentCache } from './AgentCache';
import { agentRunStore } from './AgentRunStore';
import { agentToolExecutor } from './AgentToolExecutor';
import { executeProviderToolCall } from './providerToolRuntime';

class SuccessfulToolLoopProvider {
  requests: AgentProviderRequest[] = [];

  async invoke(request: AgentProviderRequest) {
    this.requests.push(request);

    const execution = await executeProviderToolCall({
      providerId: PRIMARY_PROVIDER_ID,
      request,
      toolName: 'terminal.exec',
      toolInput: { command: 'echo ok' },
    });

    if (!execution.ok) {
      throw new Error(execution.errorMessage);
    }

    request.onStatus?.(`tool-done:${execution.resultDescription}`);

    return {
      output: execution.toolContent,
      usage: {
        inputTokens: 11,
        outputTokens: 7,
        durationMs: 5,
      },
    };
  }
}

class FailingToolLoopProvider {
  async invoke(request: AgentProviderRequest) {
    const execution = await executeProviderToolCall({
      providerId: PRIMARY_PROVIDER_ID,
      request,
      toolName: 'terminal.exec',
      toolInput: { command: 'false' },
    });

    if (!execution.ok) {
      throw new Error(execution.errorMessage);
    }

    throw new Error('Expected terminal.exec to fail');
  }
}

describe('AgentRuntime', () => {
  beforeEach(() => {
    dispatchMock.mockReset();
    recordToolMessageMock.mockReset();
    agentCache.clear();
  });

  it('runs the provider through the shared tool executor path with validation', async () => {
    const tool: AgentToolDefinition<{ command: string }> = {
      name: 'terminal.exec',
      description: 'Run a terminal command',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          command: { type: 'string' },
        },
        required: ['command'],
      },
      execute: async (input) => ({
        summary: `Ran ${input.command}`,
        data: {
          output: 'ok',
          exitCode: 0,
        },
      }),
    };

    const blockedTool: AgentToolDefinition = {
      name: 'subagent.list',
      description: 'List sub-agents',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
      execute: async () => ({
        summary: 'listed',
        data: {},
      }),
    };

    agentToolExecutor.register(tool);
    agentToolExecutor.register(blockedTool);

    const provider = new SuccessfulToolLoopProvider();
    const runtime = new AgentRuntime(provider);
    const statusUpdates: string[] = [];
    const result = await runtime.run({
      mode: 'unrestricted-dev',
      agentId: PRIMARY_PROVIDER_ID,
      role: 'primary',
      task: 'Run the command and report the validated result.',
      taskId: 'task-runtime-success',
      allowedTools: ['terminal.exec'],
      canSpawnSubagents: false,
      maxToolTurns: 4,
      onStatus: (status) => {
        statusUpdates.push(status);
      },
    });

    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].maxToolTurns).toBe(4);
    expect(provider.requests[0].tools.map(toolDef => toolDef.name)).toEqual(['terminal.exec']);
    expect(result.runId).toBeTruthy();
    expect(result.output).toContain('"summary":"Ran echo ok"');
    expect(result.output).toContain('STATUS: VALID');
    expect(statusUpdates).toEqual(['tool-done:Ran echo ok']);
    expect(recordToolMessageMock).toHaveBeenCalledWith(
      'task-runtime-success',
      expect.stringContaining('"tool": "terminal.exec"'),
      PRIMARY_PROVIDER_ID,
      expect.any(String),
    );

    const run = agentRunStore.getRun(result.runId!);
    expect(run).toMatchObject({
      id: result.runId,
      status: 'completed',
    });

    const toolCalls = agentRunStore.listToolCalls(result.runId);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({
      runId: result.runId,
      agentId: PRIMARY_PROVIDER_ID,
      toolName: 'terminal.exec',
      status: 'completed',
    });
    expect(toolCalls[0].output).toMatchObject({
      summary: 'Ran echo ok',
      validation: {
        status: 'VALID',
      },
    });

    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ADD_LOG',
      log: expect.objectContaining({
        message: expect.stringContaining('toolPayloadTokens='),
      }),
    }));
  });

  it('marks the runtime run as failed when the provider surfaces a tool failure', async () => {
    const failingTool: AgentToolDefinition<{ command: string }> = {
      name: 'terminal.exec',
      description: 'Run a terminal command',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          command: { type: 'string' },
        },
        required: ['command'],
      },
      execute: async () => {
        throw new Error('command exploded');
      },
    };

    agentToolExecutor.register(failingTool);

    const runtime = new AgentRuntime(new FailingToolLoopProvider());
    await expect(runtime.run({
      mode: 'unrestricted-dev',
      agentId: PRIMARY_PROVIDER_ID,
      role: 'primary',
      task: 'Run the command and handle the failure.',
      taskId: 'task-runtime-failure',
      allowedTools: ['terminal.exec'],
    })).rejects.toThrow('command exploded');

    expect(recordToolMessageMock).toHaveBeenCalledWith(
      'task-runtime-failure',
      expect.stringContaining('"error": "command exploded"'),
      PRIMARY_PROVIDER_ID,
      expect.any(String),
    );

    const failedRun = agentRunStore.listRuns().find(run => run.task === 'Run the command and handle the failure.');
    expect(failedRun).toBeTruthy();
    expect(failedRun).toMatchObject({
      status: 'failed',
      error: 'command exploded',
    });

    const toolCalls = agentRunStore.listToolCalls(failedRun!.id);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({
      runId: failedRun!.id,
      toolName: 'terminal.exec',
      status: 'failed',
      error: 'command exploded',
    });
  });

  it('preflight-expands the tool scope before the first provider turn when the task clearly needs adjacent tools', async () => {
    const browserTabsTool: AgentToolDefinition = {
      name: 'browser.get_tabs',
      description: 'Return open browser tabs',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
      execute: async () => ({
        summary: 'Read browser tabs',
        data: { tabs: [{ id: 'tab-1' }] },
      }),
    };

    agentToolExecutor.register(browserTabsTool);

    const provider = {
      requests: [] as AgentProviderRequest[],
      async invoke(request: AgentProviderRequest) {
        this.requests.push(request);
        return {
          output: 'ok',
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            durationMs: 1,
          },
        };
      },
    };
    const runtime = new AgentRuntime(provider);
    await runtime.run({
      mode: 'unrestricted-dev',
      agentId: PRIMARY_PROVIDER_ID,
      role: 'primary',
      task: 'Close the extra browser tabs and report what remains open.',
      taskId: 'task-runtime-preflight-browser',
      allowedTools: ['runtime.request_tool_pack', 'runtime.list_tool_packs'],
      canSpawnSubagents: false,
      maxToolTurns: 4,
    });

    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].tools.map(toolDef => toolDef.name)).toEqual(expect.arrayContaining([
      'browser.get_tabs',
    ]));
  });

  it('preflight-adds browser.create_tab for explicit multi-tab requests even when the baseline scope only has navigate', async () => {
    const browserTools: AgentToolDefinition[] = [
      {
        name: 'browser.get_state',
        description: 'Return current browser state',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
        execute: async () => ({ summary: 'state', data: {} }),
      },
      {
        name: 'browser.get_tabs',
        description: 'Return open browser tabs',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
        execute: async () => ({ summary: 'tabs', data: { tabs: [] } }),
      },
      {
        name: 'browser.navigate',
        description: 'Navigate the active tab',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: { url: { type: 'string' } },
          required: ['url'],
        },
        execute: async () => ({ summary: 'navigated', data: {} }),
      },
      {
        name: 'browser.close_tab',
        description: 'Close a tab',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
        execute: async () => ({ summary: 'closed', data: {} }),
      },
      {
        name: 'browser.click',
        description: 'Click an element',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
        execute: async () => ({ summary: 'clicked', data: {} }),
      },
      {
        name: 'browser.type',
        description: 'Type into an element',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
        execute: async () => ({ summary: 'typed', data: {} }),
      },
      {
        name: 'browser.create_tab',
        description: 'Create a new browser tab',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
        execute: async () => ({ summary: 'created', data: {} }),
      },
    ];

    for (const tool of browserTools) {
      agentToolExecutor.register(tool);
    }

    const provider = {
      requests: [] as AgentProviderRequest[],
      async invoke(request: AgentProviderRequest) {
        this.requests.push(request);
        return {
          output: 'ok',
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            durationMs: 1,
          },
        };
      },
    };

    const runtime = new AgentRuntime(provider);
    await runtime.run({
      mode: 'unrestricted-dev',
      agentId: PRIMARY_PROVIDER_ID,
      role: 'primary',
      task: 'Open three new tabs one for yahoo one for reddit and one for gmail.',
      taskId: 'task-runtime-preflight-create-tab',
      allowedTools: [
        'browser.get_state',
        'browser.get_tabs',
        'browser.close_tab',
        'browser.navigate',
        'browser.click',
        'browser.type',
      ],
      canSpawnSubagents: false,
      maxToolTurns: 4,
    });

    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].tools.map(toolDef => toolDef.name)).toEqual(expect.arrayContaining([
      'browser.create_tab',
    ]));
  });

  it('hard-fails browser tasks when the initial tool scope exposes no browser tools', () => {
    expect(() => assertInitialBrowserScope(
      'Search the web for the latest browser tool issue and summarize it.',
      ['runtime.request_tool_pack', 'runtime.list_tool_packs', 'filesystem.read'],
    )).toThrow('Browser task blocked: initial MCP tool scope for research did not expose any browser.* tools.');
  });
});
