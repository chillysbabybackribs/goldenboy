import { describe, expect, it, vi } from 'vitest';
import type { AgentProvider, AgentProviderRequest, AgentProviderResult } from '../AgentTypes';
import { agentRunStore } from '../AgentRunStore';
import { agentToolExecutor } from '../AgentToolExecutor';
import { SubAgentManager } from './SubAgentManager';
import type { SubAgentSpawnInput } from './SubAgentTypes';
import { HAIKU_PROVIDER_ID, PRIMARY_PROVIDER_ID } from '../../../shared/types/model';

function createStubProvider(output = 'sub-agent completed'): AgentProvider {
  return {
    invoke: vi.fn(async (_request: AgentProviderRequest): Promise<AgentProviderResult> => ({
      output,
      usage: { inputTokens: 0, outputTokens: 0, durationMs: 1 },
    })),
  };
}

describe('SubAgentManager', () => {
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
      return createStubProvider(`handled:${input.providerId ?? 'auto'}:${input.task}`);
    });

    const manager = new SubAgentManager(providerFactory);
    const result = await manager.run('parent-run', {
      task: 'Search online for the latest Electron release notes',
      role: 'research',
      providerId: PRIMARY_PROVIDER_ID,
    });

    expect(providerFactory).toHaveBeenCalledTimes(1);
    expect(providerFactory).toHaveBeenCalledWith(expect.objectContaining({
      task: 'Search online for the latest Electron release notes',
      role: 'research',
      providerId: PRIMARY_PROVIDER_ID,
    }));
    expect(result.status).toBe('completed');
    expect(result.summary).toContain(`handled:${PRIMARY_PROVIDER_ID}:Search online for the latest Electron release notes`);
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
    const result = await manager.run('parent-run', {
      task: 'Patch the provider and verify the command failure',
      role: 'code',
      providerId: HAIKU_PROVIDER_ID,
    });

    expect(result.status).toBe('completed');
    expect(result.findings).toEqual(['Fixed provider routing', 'Reproduced the failing command']);
    expect(result.changedFiles).toEqual([
      'src/main/agent/CodexProvider.ts',
      'src/example.ts',
    ]);
    expect(result.commands).toEqual(['npm test (exit 1)']);
    expect(result.validation).toEqual({
      total: 2,
      valid: 1,
      invalid: 1,
      incomplete: 0,
    });
    expect(result.blockers).toEqual(['terminal.exec: Command exited with code 1']);
    expect(result.toolCalls).toEqual([
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
});
