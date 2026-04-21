import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentProvider, AgentProviderRequest, AgentProviderResult } from '../AgentTypes';
import { agentRunStore } from '../AgentRunStore';
import { agentToolExecutor } from '../AgentToolExecutor';
import { SubAgentManager } from './SubAgentManager';
import type { SubAgentSpawnInput } from './SubAgentTypes';
import { HAIKU_PROVIDER_ID, PRIMARY_PROVIDER_ID } from '../../../shared/types/model';
import { taskMemoryStore } from '../../models/taskMemoryStore';

vi.mock('electron', () => ({
  app: {
    getPath: () => process.env.V2_TEST_USER_DATA || os.tmpdir(),
  },
}));

function createStubProvider(output = 'sub-agent completed'): AgentProvider {
  return {
    invoke: vi.fn(async (_request: AgentProviderRequest): Promise<AgentProviderResult> => ({
      output,
      usage: { inputTokens: 0, outputTokens: 0, durationMs: 1 },
    })),
  };
}

describe('SubAgentManager', () => {
  let userDataDir = '';

  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-subagent-user-data-'));
    process.env.V2_TEST_USER_DATA = userDataDir;
  });

  afterEach(() => {
    delete process.env.V2_TEST_USER_DATA;
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it('selects the child provider using the spawn input', async () => {
    agentToolExecutor.register({
      name: 'browser.research_search',
      description: 'Search the web',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string' },
        },
      },
      execute: async () => ({
        summary: 'searched',
        data: {},
      }),
    });

    const providerFactory = vi.fn((input: SubAgentSpawnInput) => {
      return createStubProvider(`handled:${input.providerId ?? 'auto'}:${input.modelId ?? 'default'}:${input.task}`);
    });

    const manager = new SubAgentManager(providerFactory);
    const execution = await manager.run('parent-run', {
      task: 'Search online for the latest Electron release notes',
      role: 'research',
      providerId: PRIMARY_PROVIDER_ID,
      modelId: PRIMARY_PROVIDER_ID,
    });

    expect(providerFactory).toHaveBeenCalledTimes(1);
    expect(providerFactory).toHaveBeenCalledWith(expect.objectContaining({
      task: 'Search online for the latest Electron release notes',
      role: 'research',
      providerId: PRIMARY_PROVIDER_ID,
      modelId: PRIMARY_PROVIDER_ID,
    }));
    expect(execution.record.status).toBe('completed');
    expect(execution.result.status).toBe('completed');
    expect(execution.result.summary).toContain(`handled:${PRIMARY_PROVIDER_ID}:${PRIMARY_PROVIDER_ID}:Search online for the latest Electron release notes`);
  });

  it('returns structured execution details for completed sub-agents', async () => {
    const providerFactory = vi.fn((): AgentProvider => ({
      invoke: vi.fn(async (request: AgentProviderRequest): Promise<AgentProviderResult> => {
        const patchCall = agentRunStore.startToolCall({
          runId: request.runId,
          agentId: request.agentId,
          toolName: 'filesystem.patch',
          toolInput: { path: 'src/example.ts' },
        });
        agentRunStore.finishToolCall(patchCall.id, 'completed', {
          summary: 'Patched /home/dp/Desktop/v2workspace/src/example.ts',
          data: { path: '/home/dp/Desktop/v2workspace/src/example.ts', changed: true },
          validation: { status: 'VALID', constraints: [], summary: 'File patch verified' },
        });

        const terminalCall = agentRunStore.startToolCall({
          runId: request.runId,
          agentId: request.agentId,
          toolName: 'terminal.exec',
          toolInput: { command: 'npm test' },
        });
        agentRunStore.finishToolCall(terminalCall.id, 'completed', {
          summary: 'Executed command: npm test (exit 1)',
          data: { command: 'npm test', exitCode: 1 },
          validation: { status: 'INVALID', constraints: [], summary: 'Command exited with code 1' },
        });

        return {
          output: '- Fixed provider routing\n- Reproduced the failing command',
          codexItems: [
            {
              id: 'file-1',
              type: 'file_change',
              changes: [{ path: 'src/main/agent/CodexProvider.ts', kind: 'update' }],
              status: 'completed',
            },
          ],
          usage: { inputTokens: 0, outputTokens: 0, durationMs: 1 },
        };
      }),
    }));

    const manager = new SubAgentManager(providerFactory);
    const execution = await manager.run('parent-run', {
      task: 'Patch the provider and verify the command failure',
      role: 'code',
      providerId: HAIKU_PROVIDER_ID,
    });

    expect(execution.result.status).toBe('completed');
    expect(execution.result.findings).toEqual(['Fixed provider routing', 'Reproduced the failing command']);
    expect(execution.result.changedFiles).toEqual([
      'src/main/agent/CodexProvider.ts',
      '/home/dp/Desktop/v2workspace/src/example.ts',
    ]);
    expect(execution.result.commands).toEqual(['npm test (exit 1)']);
    expect(execution.result.validation).toEqual({
      total: 2,
      valid: 1,
      invalid: 1,
      incomplete: 0,
    });
    expect(execution.result.blockers).toEqual(['terminal.exec: Command exited with code 1']);
    expect(execution.result.toolCalls).toEqual([
      {
        toolName: 'filesystem.patch',
        status: 'completed',
        summary: 'Patched /home/dp/Desktop/v2workspace/src/example.ts',
        validationStatus: 'VALID',
      },
      {
        toolName: 'terminal.exec',
        status: 'completed',
        summary: 'Executed command: npm test (exit 1)',
        validationStatus: 'INVALID',
      },
    ]);
  });

  it('rolls sub-agent usage through the recorder using the child provider id', async () => {
    const provider: AgentProvider & { providerId: string } = {
      providerId: HAIKU_PROVIDER_ID,
      invoke: vi.fn(async (): Promise<AgentProviderResult> => ({
        output: 'delegated summary',
        usage: {
          inputTokens: 120,
          outputTokens: 37,
          cachedInputTokens: 60,
          durationMs: 45,
        },
      })),
    };
    const recorder = vi.fn();
    const manager = new SubAgentManager(() => provider, recorder);

    await manager.run('parent-run', {
      task: 'Investigate the module graph',
      role: 'research',
      taskId: 'task-usage-rollup',
      providerId: HAIKU_PROVIDER_ID,
    });

    expect(recorder).toHaveBeenCalledTimes(1);
    expect(recorder).toHaveBeenCalledWith({
      taskId: 'task-usage-rollup',
      providerId: HAIKU_PROVIDER_ID,
      usage: {
        inputTokens: 120,
        outputTokens: 37,
        cachedInputTokens: 60,
        durationMs: 45,
      },
    });
  });

  it('skips usage recording when no taskId is supplied', async () => {
    const provider: AgentProvider = {
      providerId: HAIKU_PROVIDER_ID,
      invoke: vi.fn(async (): Promise<AgentProviderResult> => ({
        output: 'done',
        usage: { inputTokens: 1, outputTokens: 2, durationMs: 1 },
      })),
    };
    const recorder = vi.fn();
    const manager = new SubAgentManager(() => provider, recorder);

    await manager.run('parent-run', {
      task: 'No-task usage case',
      role: 'research',
      providerId: HAIKU_PROVIDER_ID,
    });

    expect(recorder).not.toHaveBeenCalled();
  });

  it('records plan milestones for spawn and completion when task memory is available', async () => {
    const providerFactory = vi.fn(() => createStubProvider('- Checked renderer state\n- Scoped the next patch'));
    const manager = new SubAgentManager(providerFactory);
    const parentRun = agentRunStore.createRun({
      role: 'primary',
      task: 'Coordinate repo work',
      mode: 'unrestricted-dev',
      parentRunId: null,
      depth: 0,
    });

    await manager.run(parentRun.id, {
      task: 'Inspect renderer build pipeline',
      role: 'research',
      taskId: 'task-plan-ledger',
      providerId: PRIMARY_PROVIDER_ID,
    });

    const context = taskMemoryStore.buildContext('task-plan-ledger');
    expect(context).toContain('### Planning State');
    expect(context).toContain('Sub-agent research running');
    expect(context).toContain('Sub-agent research completed');
  });

  it('runs a sub-agent as a single delegated call and returns its result with the record', async () => {
    const providerFactory = vi.fn(() => createStubProvider('blocking result'));
    const manager = new SubAgentManager(providerFactory);

    const execution = await manager.run('parent-run', {
      task: 'Search Reddit for Claude Code discussions',
      role: 'research',
      providerId: PRIMARY_PROVIDER_ID,
    });

    expect(execution.record.status).toBe('completed');
    expect(execution.result).toMatchObject({
      status: 'completed',
      summary: 'blocking result',
    });
  });

  it('derives a narrow role-based tool scope for sub-agents when none is specified', async () => {
    agentToolExecutor.register({
      name: 'browser.research_search',
      description: 'Research the web for current information',
      inputSchema: { type: 'object', additionalProperties: false, properties: { query: { type: 'string' } } },
      execute: async () => ({ summary: 'researched web', data: {} }),
    });
    agentToolExecutor.register({
      name: 'browser.search_page_cache',
      description: 'Search cached pages',
      inputSchema: { type: 'object', additionalProperties: false, properties: { query: { type: 'string' } } },
      execute: async () => ({ summary: 'searched cache', data: {} }),
    });
    agentToolExecutor.register({
      name: 'browser.read_cached_chunk',
      description: 'Read cached chunk',
      inputSchema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' } } },
      execute: async () => ({ summary: 'read chunk', data: {} }),
    });
    taskMemoryStore.recordPlan('task-scope-derived', 'Execution underway', {
      category: 'plan',
      stage: 'subagent-spawn',
      role: 'research',
      subagentId: 'seed',
      task: 'Inspect scope',
      status: 'running',
      nextAction: 'Wait for findings',
    });

    const seenRequests: AgentProviderRequest[] = [];
    const providerFactory = vi.fn((): AgentProvider => ({
      invoke: vi.fn(async (request: AgentProviderRequest): Promise<AgentProviderResult> => {
        seenRequests.push(request);
        return {
          output: 'done',
          usage: { inputTokens: 0, outputTokens: 0, durationMs: 1 },
        };
      }),
    }));
    const manager = new SubAgentManager(providerFactory);

    await manager.run('parent-run', {
      task: 'Search online for the latest Electron release notes',
      role: 'research',
      taskId: 'task-scope-derived',
      providerId: PRIMARY_PROVIDER_ID,
    });

    expect(seenRequests).toHaveLength(1);
    expect(seenRequests[0].tools.map((tool) => tool.name)).toHaveLength(3);
    expect(seenRequests[0].tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'browser.research_search',
      'browser.search_page_cache',
      'browser.read_cached_chunk',
    ]));
  });

  it('starts an explicit all-tools sub-agent with the map-first surface (context.load + preloaded categories)', async () => {
    const seenRequests: AgentProviderRequest[] = [];
    agentToolExecutor.register({
      name: 'context.load',
      description: 'Load tool categories',
      inputSchema: {
        type: 'object',
        properties: { categories: { type: 'array', items: { type: 'string' } } },
        required: ['categories'],
      },
      execute: async () => ({ summary: 'loaded', data: {} }),
    });
    agentToolExecutor.register({
      name: 'terminal.exec',
      description: 'Run a command',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { command: { type: 'string' } },
      },
      execute: async () => ({
        summary: 'ran',
        data: {},
      }),
    });
    agentToolExecutor.register({
      name: 'filesystem.patch',
      description: 'Patch a file',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { path: { type: 'string' }, patch: { type: 'string' } },
      },
      execute: async () => ({ summary: 'patched', data: {} }),
    });

    const providerFactory = vi.fn((): AgentProvider => ({
      invoke: vi.fn(async (request: AgentProviderRequest): Promise<AgentProviderResult> => {
        seenRequests.push(request);
        return {
          output: 'done',
          usage: { inputTokens: 0, outputTokens: 0, durationMs: 1 },
        };
      }),
    }));
    const manager = new SubAgentManager(providerFactory);

    await manager.run('parent-run-all', {
      task: 'Run the build and patch the file that is failing',
      role: 'code',
      taskId: 'task-scope-all',
      providerId: PRIMARY_PROVIDER_ID,
      allowedTools: 'all',
    });

    expect(seenRequests).toHaveLength(1);
    const toolNames = seenRequests[0].tools.map((tool) => tool.name);
    expect(toolNames).toContain('context.load');
    expect(toolNames).toContain('terminal.exec');
    expect(toolNames).toContain('filesystem.patch');
  });

  it('keeps a broader scope for verification-heavy child tasks even during execution phase', async () => {
    agentToolExecutor.register({
      name: 'filesystem.search',
      description: 'Search files',
      inputSchema: { type: 'object', additionalProperties: false, properties: { query: { type: 'string' } } },
      execute: async () => ({ summary: 'searched files', data: {} }),
    });
    agentToolExecutor.register({
      name: 'filesystem.read',
      description: 'Read file',
      inputSchema: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' } } },
      execute: async () => ({ summary: 'read file', data: {} }),
    });
    agentToolExecutor.register({
      name: 'filesystem.patch',
      description: 'Patch file',
      inputSchema: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' } } },
      execute: async () => ({ summary: 'patched file', data: {} }),
    });
    agentToolExecutor.register({
      name: 'filesystem.write',
      description: 'Write file',
      inputSchema: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' } } },
      execute: async () => ({ summary: 'wrote file', data: {} }),
    });
    agentToolExecutor.register({
      name: 'terminal.exec',
      description: 'Run command',
      inputSchema: { type: 'object', additionalProperties: false, properties: { command: { type: 'string' } } },
      execute: async () => ({ summary: 'ran command', data: {} }),
    });

    taskMemoryStore.recordPlan('task-scope-verify', 'Execution underway', {
      category: 'plan',
      stage: 'subagent-spawn',
      role: 'research',
      subagentId: 'seed_verify',
      task: 'Inspect scope',
      status: 'running',
      nextAction: 'Wait for findings',
    });

    const seenRequests: AgentProviderRequest[] = [];
    const providerFactory = vi.fn((): AgentProvider => ({
      invoke: vi.fn(async (request: AgentProviderRequest): Promise<AgentProviderResult> => {
        seenRequests.push(request);
        return {
          output: 'done',
          usage: { inputTokens: 0, outputTokens: 0, durationMs: 1 },
        };
      }),
    }));
    const manager = new SubAgentManager(providerFactory);

    await manager.run('parent-run-verify', {
      task: 'Patch the provider and verify the command failure',
      role: 'code',
      taskId: 'task-scope-verify',
      providerId: PRIMARY_PROVIDER_ID,
    });

    expect(seenRequests).toHaveLength(1);
    expect(seenRequests[0].tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'filesystem.search',
      'filesystem.read',
      'filesystem.patch',
      'filesystem.write',
      'terminal.exec',
    ]));
  });
});
