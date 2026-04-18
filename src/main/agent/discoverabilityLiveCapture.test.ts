import { describe, expect, it } from 'vitest';
import { agentRunStore } from './AgentRunStore';
import {
  buildDiscoverabilityAuditReportFromInvocations,
  buildDiscoverabilityProviderReportFromInvocations,
  captureDiscoverabilityArtifactsFromInvocation,
} from './discoverabilityLiveCapture';

describe('discoverability live capture', () => {
  it('captures runtime tool calls from a real invocation result runId', () => {
    const run = agentRunStore.createRun({
      parentRunId: null,
      depth: 0,
      role: 'primary',
      task: 'Find the routing defaults',
      mode: 'unrestricted-dev',
    });
    agentRunStore.updateRun(run.id, { status: 'running' });
    const tool = agentRunStore.startToolCall({
      runId: run.id,
      agentId: 'gpt-5.4',
      toolName: 'filesystem.search_file_cache',
      toolInput: { query: 'provider routing' },
    });
    agentRunStore.finishToolCall(tool.id, 'completed', { summary: 'found file' });
    agentRunStore.finishRun(run.id, 'completed', 'done');

    const artifacts = captureDiscoverabilityArtifactsFromInvocation({
      scenarioId: 'local-config-lookup',
      prompt: 'Find the routing defaults.',
      result: {
        taskId: 'task-1',
        providerId: 'gpt-5.4',
        success: true,
        output: 'The provider order prefers the primary provider first, with haiku after it.',
        artifacts: [],
        usage: { inputTokens: 1, outputTokens: 1, durationMs: 1 },
        runId: run.id,
      },
    });

    expect(artifacts.toolCalls).toHaveLength(1);
    expect(artifacts.toolCalls[0].toolName).toBe('filesystem.search_file_cache');
  });

  it('builds provider and full reports directly from invocation results', () => {
    const report = buildDiscoverabilityProviderReportFromInvocations('gpt-5.4', [
      {
        scenarioId: 'local-config-lookup',
        prompt: 'Find the routing defaults.',
        result: {
          taskId: 'task-1',
          providerId: 'gpt-5.4',
          success: true,
          output: 'The provider order prefers the primary provider first, with haiku after it.',
          artifacts: [],
          usage: { inputTokens: 1, outputTokens: 1, durationMs: 1 },
        },
        groundedOverride: true,
      },
    ]);

    expect(report.aggregate.totalScenarios).toBe(1);
    expect(report.providerId).toBe('gpt-5.4');

    const fullReport = buildDiscoverabilityAuditReportFromInvocations([
      {
        scenarioId: 'local-config-lookup',
        prompt: 'Find the routing defaults.',
        result: {
          taskId: 'task-1',
          providerId: 'gpt-5.4',
          success: true,
          output: 'The provider order prefers the primary provider first, with haiku after it.',
          artifacts: [],
          usage: { inputTokens: 1, outputTokens: 1, durationMs: 1 },
        },
        groundedOverride: true,
      },
      {
        scenarioId: 'local-config-lookup',
        prompt: 'Find the routing defaults.',
        result: {
          taskId: 'task-2',
          providerId: 'haiku',
          success: true,
          output: 'Where is the routing file?',
          artifacts: [],
          usage: { inputTokens: 1, outputTokens: 1, durationMs: 1 },
        },
      },
    ]);

    expect(fullReport).toContain('gpt-5.4');
    expect(fullReport).toContain('haiku');
  });

  it('marks provider billing failures as unavailable instead of scoring them', () => {
    const artifacts = captureDiscoverabilityArtifactsFromInvocation({
      scenarioId: 'cross-source-summary',
      prompt: 'Explain runtime validation failures.',
      result: {
        taskId: 'task-3',
        providerId: 'haiku',
        success: false,
        output: '',
        error: '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}',
        artifacts: [],
        usage: { inputTokens: 0, outputTokens: 0, durationMs: 0 },
      },
    });

    expect(artifacts.unavailableReason).toBe('provider unavailable: billing/credit issue');
  });

  it('marks benchmark invocation timeouts as unavailable instead of scoring them', () => {
    const artifacts = captureDiscoverabilityArtifactsFromInvocation({
      scenarioId: 'cross-source-summary',
      prompt: 'Explain runtime validation failures.',
      result: {
        taskId: 'task-4',
        providerId: 'gpt-5.4',
        success: false,
        output: '',
        error: 'benchmark timeout after 15000ms',
        artifacts: [],
        usage: { inputTokens: 0, outputTokens: 0, durationMs: 15000 },
      },
    });

    expect(artifacts.unavailableReason).toBe('benchmark unavailable: invocation timeout');
  });
});
