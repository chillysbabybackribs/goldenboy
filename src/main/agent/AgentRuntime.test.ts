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

import { AgentRuntime } from './AgentRuntime';
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
});
