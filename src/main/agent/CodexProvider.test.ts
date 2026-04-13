import { PassThrough } from 'stream';
import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentProviderRequest } from './AgentTypes';
import { PRIMARY_PROVIDER_ID } from '../../shared/types/model';

const { spawnMock, spawnSyncMock, executeMock, recordToolMessageMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  spawnSyncMock: vi.fn(() => ({ status: 0, stdout: 'codex-cli 0.120.0', stderr: '' })),
  executeMock: vi.fn(),
  recordToolMessageMock: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
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

import { CodexProvider } from './CodexProvider';

type MockChildProcess = EventEmitter & {
  stdin?: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
};

function createMockChildProcess(): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => {
    child.emit('close', null);
    return true;
  });
  return child;
}

async function completeTurn(
  child: MockChildProcess,
  message: string,
  usage = { input: 12, output: 3 },
): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      child.stdout.write(`{"type":"item.completed","item":{"id":"item-${Math.random()}","type":"agent_message","text":${JSON.stringify(message)}}}\n`);
      child.stdout.write(`{"type":"turn.completed","usage":{"input_tokens":${usage.input},"cached_input_tokens":0,"output_tokens":${usage.output}}}\n`);
      child.stdout.end();
      child.emit('close', 0);
      resolve();
    }, 0);
  });
}

function buildRequest(overrides: Partial<AgentProviderRequest> = {}): AgentProviderRequest {
  return {
    runId: 'run-1',
    agentId: PRIMARY_PROVIDER_ID,
    mode: 'unrestricted-dev',
    taskId: 'task-1',
    systemPrompt: 'You are a helpful assistant.',
    task: 'What is 2 + 2?',
    contextPrompt: '',
    tools: [],
    maxToolTurns: 2,
    ...overrides,
  };
}

describe('CodexProvider', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    spawnSyncMock.mockClear();
    executeMock.mockReset();
    recordToolMessageMock.mockReset();
  });

  it('reports Codex CLI availability', () => {
    expect(CodexProvider.isAvailable()).toEqual({ available: true });
    expect(spawnSyncMock).toHaveBeenCalledWith('codex', ['--version'], expect.objectContaining({
      cwd: process.cwd(),
      encoding: 'utf8',
    }));
  });

  it('routes tool requests through the V2 tool executor', async () => {
    const toolTurn = createMockChildProcess();
    const finalTurn = createMockChildProcess();
    spawnMock
      .mockReturnValueOnce(toolTurn)
      .mockReturnValueOnce(finalTurn);

    executeMock.mockResolvedValue({
      summary: 'Listed 3 files',
      data: { entries: ['a.ts', 'b.ts', 'c.ts'] },
    });

    const itemEvents: Array<{ eventType: string; type: string; tool?: string }> = [];
    const tokens: string[] = [];
    const provider = new CodexProvider({ providerId: PRIMARY_PROVIDER_ID, modelId: PRIMARY_PROVIDER_ID });
    const resultPromise = provider.invoke(buildRequest({
      task: 'Inspect the workspace and answer.',
      tools: [
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
      onItem: ({ item, eventType }) => {
        itemEvents.push({
          eventType,
          type: item.type,
          tool: item.type === 'mcp_tool_call' ? item.tool : undefined,
        });
      },
      onToken: (text) => {
        tokens.push(text);
      },
    }));

    await completeTurn(
      toolTurn,
      JSON.stringify({
        kind: 'tool_calls',
        tool_calls: [
          {
            name: 'filesystem.list',
            arguments_json: '{"path":"."}',
          },
        ],
        message: 'Checking the workspace root.',
      }),
    );
    await completeTurn(
      finalTurn,
      JSON.stringify({
        kind: 'final',
        tool_calls: [],
        message: 'Found the files.',
      }),
    );

    const result = await resultPromise;

    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      'codex',
      expect.arrayContaining([
        'exec',
        '--json',
        '--model',
        PRIMARY_PROVIDER_ID,
        '--dangerously-bypass-approvals-and-sandbox',
        '--output-schema',
      ]),
      expect.objectContaining({
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    );
    expect(executeMock).toHaveBeenCalledWith('filesystem.list', { path: '.' }, {
      runId: 'run-1',
      agentId: PRIMARY_PROVIDER_ID,
      mode: 'unrestricted-dev',
      taskId: 'task-1',
    });
    expect(recordToolMessageMock).toHaveBeenCalledTimes(1);
    expect(tokens).toEqual(['Found the files.']);
    expect(itemEvents).toEqual([
      { eventType: 'item.started', type: 'mcp_tool_call', tool: 'filesystem.list' },
      { eventType: 'item.completed', type: 'mcp_tool_call', tool: 'filesystem.list' },
      { eventType: 'item.completed', type: 'agent_message', tool: undefined },
    ]);
    expect(result).toEqual({
      output: 'Found the files.',
      codexItems: [
        expect.objectContaining({
          type: 'mcp_tool_call',
          tool: 'filesystem.list',
          status: 'completed',
        }),
        {
          id: expect.any(String),
          type: 'agent_message',
          text: 'Found the files.',
        },
      ],
      usage: {
        inputTokens: 24,
        outputTokens: 6,
        durationMs: expect.any(Number),
      },
    });
  });

  it('returns a final response directly when no tools are available', async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child);

    const provider = new CodexProvider();
    const resultPromise = provider.invoke(buildRequest());
    await completeTurn(child, JSON.stringify({
      kind: 'final',
      tool_calls: [],
      message: '4',
    }));

    await expect(resultPromise).resolves.toEqual({
      output: '4',
      codexItems: [
        {
          id: expect.any(String),
          type: 'agent_message',
          text: '4',
        },
      ],
      usage: {
        inputTokens: 12,
        outputTokens: 3,
        durationMs: expect.any(Number),
      },
    });
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('expands the active tool scope after requesting a tool pack', async () => {
    const expandTurn = createMockChildProcess();
    const workTurn = createMockChildProcess();
    const finalTurn = createMockChildProcess();
    spawnMock
      .mockReturnValueOnce(expandTurn)
      .mockReturnValueOnce(workTurn)
      .mockReturnValueOnce(finalTurn);

    executeMock
      .mockResolvedValueOnce({
        summary: 'Requested tool pack: implementation',
        data: {
          pack: 'implementation',
          description: 'Local code reading, editing, and build execution.',
          tools: ['filesystem.list'],
          scope: 'named',
          relatedPackIds: ['file-edit'],
        },
      })
      .mockResolvedValueOnce({
        summary: 'Listed 2 files',
        data: { entries: ['a.ts', 'b.ts'] },
      });

    const provider = new CodexProvider({ providerId: PRIMARY_PROVIDER_ID, modelId: PRIMARY_PROVIDER_ID });
    const resultPromise = provider.invoke(buildRequest({
      task: 'Load the needed tools, inspect the workspace, and answer.',
      tools: [
        {
          name: 'runtime.request_tool_pack',
          description: 'Request a tool pack.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: { pack: { type: 'string' } },
            required: ['pack'],
          },
        },
      ],
      toolCatalog: [
        {
          name: 'runtime.request_tool_pack',
          description: 'Request a tool pack.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: { pack: { type: 'string' } },
            required: ['pack'],
          },
        },
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
    }));

    await completeTurn(
      expandTurn,
      JSON.stringify({
        kind: 'tool_calls',
        tool_calls: [
          {
            name: 'runtime.request_tool_pack',
            arguments_json: '{"pack":"implementation"}',
          },
        ],
        message: 'Need the implementation pack.',
      }),
    );
    await completeTurn(
      workTurn,
      JSON.stringify({
        kind: 'tool_calls',
        tool_calls: [
          {
            name: 'filesystem.list',
            arguments_json: '{"path":"."}',
          },
        ],
        message: 'Now listing the workspace.',
      }),
    );
    await completeTurn(
      finalTurn,
      JSON.stringify({
        kind: 'final',
        tool_calls: [],
        message: 'Expansion worked.',
      }),
    );

    const result = await resultPromise;

    expect(executeMock).toHaveBeenNthCalledWith(1, 'runtime.request_tool_pack', { pack: 'implementation' }, expect.any(Object));
    expect(executeMock).toHaveBeenNthCalledWith(2, 'filesystem.list', { path: '.' }, expect.any(Object));
    expect(result.output).toBe('Expansion worked.');
  });

  it('auto-expands a related tool pack when the model says the current scope is missing browser tools', async () => {
    const blockedTurn = createMockChildProcess();
    const workTurn = createMockChildProcess();
    const finalTurn = createMockChildProcess();
    spawnMock
      .mockReturnValueOnce(blockedTurn)
      .mockReturnValueOnce(workTurn)
      .mockReturnValueOnce(finalTurn);

    executeMock.mockResolvedValueOnce({
      summary: 'Read browser tabs',
      data: { tabs: [{ id: 'tab-1' }, { id: 'tab-2' }] },
    });

    const provider = new CodexProvider({ providerId: PRIMARY_PROVIDER_ID, modelId: PRIMARY_PROVIDER_ID });
    const resultPromise = provider.invoke(buildRequest({
      task: 'Close the extra browser tabs and tell me what remains open.',
      maxToolTurns: 3,
      tools: [
        {
          name: 'runtime.request_tool_pack',
          description: 'Request a tool pack.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: { pack: { type: 'string' } },
            required: ['pack'],
          },
        },
        {
          name: 'runtime.list_tool_packs',
          description: 'List tool packs.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
          },
        },
      ],
      toolCatalog: [
        {
          name: 'runtime.request_tool_pack',
          description: 'Request a tool pack.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: { pack: { type: 'string' } },
            required: ['pack'],
          },
        },
        {
          name: 'runtime.list_tool_packs',
          description: 'List tool packs.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
          },
        },
        {
          name: 'browser.get_tabs',
          description: 'Return open browser tabs.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
          },
        },
      ],
    }));

    await completeTurn(
      blockedTurn,
      JSON.stringify({
        kind: 'final',
        tool_calls: [],
        message: 'I cannot continue because the current scope does not have browser tab tools.',
      }),
    );
    await completeTurn(
      workTurn,
      JSON.stringify({
        kind: 'tool_calls',
        tool_calls: [
          {
            name: 'browser.get_tabs',
            arguments_json: '{}',
          },
        ],
        message: 'Now checking the current browser tabs.',
      }),
    );
    await completeTurn(
      finalTurn,
      JSON.stringify({
        kind: 'final',
        tool_calls: [],
        message: 'Two tabs remain open.',
      }),
    );

    const result = await resultPromise;

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock).toHaveBeenCalledWith('browser.get_tabs', {}, expect.any(Object));
    expect(result.output).toBe('Two tabs remain open.');
  });

  it('aborts an active Codex process', () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child);

    const provider = new CodexProvider();
    const promise = provider.invoke(buildRequest()).catch((error) => error);
    provider.abort();

    expect(child.kill).toHaveBeenCalledTimes(1);
    return expect(promise).resolves.toBeInstanceOf(Error);
  });
});
