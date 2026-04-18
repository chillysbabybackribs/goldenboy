import { describe, expect, it } from 'vitest';
import type { InvocationResult, ProviderId } from '../../shared/types/model';
import {
  benchmarkRunsToArtifacts,
  runDiscoverabilityBenchmark,
  type DiscoverabilityBenchmarkInvoker,
} from './discoverabilityBenchmarkHarness';
import { agentRunStore } from './AgentRunStore';

function createInvocationResult(providerId: ProviderId, output: string, runId?: string): InvocationResult {
  return {
    taskId: 'unused',
    providerId,
    success: true,
    output,
    artifacts: [],
    usage: { inputTokens: 1, outputTokens: 1, durationMs: 1 },
    runId,
  };
}

describe('discoverability benchmark harness', () => {
  it('runs the scenario matrix across both providers and returns a comparative report', async () => {
    const calls: Array<{ taskId: string; prompt: string; owner?: string }> = [];
    const invoker: DiscoverabilityBenchmarkInvoker = {
      async invoke(taskId, prompt, explicitOwner) {
        calls.push({ taskId, prompt, owner: explicitOwner });
        if (explicitOwner === 'gpt-5.4') {
          return createInvocationResult('gpt-5.4', 'The provider order prefers the primary provider first, with haiku after it.');
        }
        return createInvocationResult('haiku', 'Where is the routing file?');
      },
    };

    const result = await runDiscoverabilityBenchmark(invoker, {
      scenarios: [
        {
          id: 'local-config-lookup',
          title: 'Local config lookup',
          bucket: 'workspace_local',
          task: 'Find which file defines the provider routing defaults and summarize the default preference order.',
          minimumDiscoveryActions: ['filesystem.search_file_cache', 'filesystem.read'],
          askRequired: false,
          availableFacts: [],
          reachableSources: [],
          expectedAnswerIncludes: ['provider', 'order'],
        },
      ],
    });

    expect(calls).toHaveLength(2);
    expect(result.runs).toHaveLength(2);
    expect(result.invocations).toHaveLength(2);
    expect(result.report).toContain('gpt-5.4');
    expect(result.report).toContain('haiku');
  });

  it('can convert harness runs back into scored artifact inputs using live runIds', async () => {
    const run = agentRunStore.createRun({
      parentRunId: null,
      depth: 0,
      role: 'primary',
      task: 'Find defaults',
      mode: 'unrestricted-dev',
    });
    agentRunStore.updateRun(run.id, { status: 'running' });
    const toolCall = agentRunStore.startToolCall({
      runId: run.id,
      agentId: 'gpt-5.4',
      toolName: 'filesystem.search_file_cache',
      toolInput: { query: 'provider order' },
    });
    agentRunStore.finishToolCall(toolCall.id, 'completed', { summary: 'found match' });
    agentRunStore.finishRun(run.id, 'completed', 'done');

    const artifacts = benchmarkRunsToArtifacts([
      {
        scenarioId: 'local-config-lookup',
        providerId: 'gpt-5.4',
        taskId: 'task-1',
        prompt: 'Find defaults',
        result: createInvocationResult(
          'gpt-5.4',
          'The provider order prefers the primary provider first, with haiku after it.',
          run.id,
        ),
      },
    ]);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].toolCalls).toHaveLength(1);
    expect(artifacts[0].toolCalls[0].toolName).toBe('filesystem.search_file_cache');
  });

  it('times out a hung invocation and continues the benchmark matrix', async () => {
    const invoker: DiscoverabilityBenchmarkInvoker = {
      async invoke(taskId, _prompt, explicitOwner) {
        if (explicitOwner === 'gpt-5.4') {
          return createInvocationResult('gpt-5.4', 'The provider order prefers the primary provider first, with haiku after it.');
        }
        return await new Promise<InvocationResult>(() => {});
      },
    };

    const result = await runDiscoverabilityBenchmark(invoker, {
      scenarios: [
        {
          id: 'local-config-lookup',
          title: 'Local config lookup',
          bucket: 'workspace_local',
          task: 'Find which file defines the provider routing defaults and summarize the default preference order.',
          minimumDiscoveryActions: ['filesystem.search_file_cache', 'filesystem.read'],
          askRequired: false,
          availableFacts: [],
          reachableSources: [],
          expectedAnswerIncludes: ['provider', 'order'],
        },
      ],
      perInvocationTimeoutMs: 10,
    });

    expect(result.runs).toHaveLength(2);
    const timedOut = result.runs.find((run) => run.providerId === 'haiku');
    expect(timedOut?.result.success).toBe(false);
    expect(timedOut?.result.error).toContain('benchmark timeout after 1000ms');
  });
});
