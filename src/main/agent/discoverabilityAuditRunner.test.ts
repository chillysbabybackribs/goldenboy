import { describe, expect, it } from 'vitest';
import type { AgentToolCallRecord } from './AgentTypes';
import {
  buildDiscoverabilityAuditReport,
  buildDiscoverabilityProviderReport,
  scoreDiscoverabilityRun,
  type DiscoverabilityRuntimeArtifacts,
} from './discoverabilityAuditRunner';

function toolCall(toolName: AgentToolCallRecord['toolName'], startedAt = 1): AgentToolCallRecord {
  return {
    id: `tool-${toolName}-${startedAt}`,
    runId: 'run-1',
    agentId: 'gpt-5.4',
    toolName,
    input: {},
    output: {},
    status: 'completed',
    startedAt,
    completedAt: startedAt + 1,
    error: null,
  };
}

describe('discoverability audit runner', () => {
  it('scores runtime-style artifacts against a concrete scenario fixture', () => {
    const scored = scoreDiscoverabilityRun({
      scenarioId: 'local-config-lookup',
      providerId: 'gpt-5.4',
      prompt: 'Find the routing defaults.',
      output: 'The provider order prefers the primary provider first, with haiku after it.',
      toolCalls: [
        toolCall('filesystem.search_file_cache', 1),
        toolCall('filesystem.read', 2),
      ],
    });

    expect(scored.score.classification).toBe('strong_pass');
    expect(scored.score.answerCorrect).toBe(true);
    expect(scored.trace[0]).toMatchObject({ type: 'tool_call', action: 'filesystem.search_file_cache' });
  });

  it('flags a provider output that asks the user instead of gathering the answer', () => {
    const scored = scoreDiscoverabilityRun({
      scenarioId: 'tests-infer-behavior',
      providerId: 'haiku',
      prompt: 'Determine the failure behavior.',
      output: 'What exact test file should I read?',
      toolCalls: [],
    });

    expect(scored.score.classification).toBe('fail');
    expect(scored.score.failures).toContain('premature_question');
    expect(scored.score.failures).toContain('tool_avoidance');
  });

  it('builds a per-provider aggregate report', () => {
    const runs: DiscoverabilityRuntimeArtifacts[] = [
      {
        scenarioId: 'local-config-lookup',
        providerId: 'gpt-5.4',
        prompt: 'Find the routing defaults.',
        output: 'The provider order prefers the primary provider first, with haiku after it.',
        toolCalls: [toolCall('filesystem.search_file_cache', 1), toolCall('filesystem.read', 2)],
      },
      {
        scenarioId: 'tests-infer-behavior',
        providerId: 'gpt-5.4',
        prompt: 'Infer the failure behavior.',
        output: 'The runtime is marked failed when the provider surfaces the tool failure.',
        toolCalls: [toolCall('filesystem.search_file_cache', 3), toolCall('filesystem.read', 4)],
      },
    ];

    const report = buildDiscoverabilityProviderReport('gpt-5.4', runs);
    expect(report.aggregate.totalScenarios).toBe(2);
    expect(report.aggregate.classifications.strong_pass).toBe(2);
    expect(report.aggregate.unnecessaryQuestionRate).toBe(0);
    expect(report.unavailableRuns).toHaveLength(0);
    expect(report.bucketAggregates).toHaveLength(1);
    expect(report.bucketAggregates[0].bucket).toBe('workspace_local');
  });

  it('renders a comparative text report for multiple providers', () => {
    const report = buildDiscoverabilityAuditReport([
      {
        scenarioId: 'local-config-lookup',
        providerId: 'gpt-5.4',
        prompt: 'Find the routing defaults.',
        output: 'The provider order prefers the primary provider first, with haiku after it.',
        toolCalls: [toolCall('filesystem.search_file_cache', 1), toolCall('filesystem.read', 2)],
      },
      {
        scenarioId: 'local-config-lookup',
        providerId: 'haiku',
        prompt: 'Find the routing defaults.',
        output: 'Where is the routing file?',
        toolCalls: [],
      },
    ]);

    expect(report).toContain('=== Discoverability Audit ===');
    expect(report).toContain('gpt-5.4');
    expect(report).toContain('haiku');
    expect(report).toContain('Buckets:');
    expect(report).toContain('workspace_local');
    expect(report).toContain('local-config-lookup');
  });

  it('excludes unavailable provider runs from scoring and reports them separately', () => {
    const report = buildDiscoverabilityProviderReport('haiku', [
      {
        scenarioId: 'cross-source-summary',
        providerId: 'haiku',
        prompt: 'Explain runtime validation failures.',
        output: '400 invalid_request_error: Your credit balance is too low to access the Anthropic API.',
        toolCalls: [],
        unavailableReason: 'provider unavailable: billing/credit issue',
      },
    ]);

    expect(report.aggregate.totalScenarios).toBe(0);
    expect(report.unavailableRuns).toEqual([
      {
        scenarioId: 'cross-source-summary',
        reason: 'provider unavailable: billing/credit issue',
      },
    ]);
  });

  it('excludes timed out benchmark runs from scoring and reports them separately', () => {
    const report = buildDiscoverabilityProviderReport('gpt-5.4', [
      {
        scenarioId: 'cross-source-summary',
        providerId: 'gpt-5.4',
        prompt: 'Explain runtime validation failures.',
        output: 'benchmark timeout after 15000ms',
        toolCalls: [],
        unavailableReason: 'benchmark unavailable: invocation timeout',
      },
    ]);

    expect(report.aggregate.totalScenarios).toBe(0);
    expect(report.unavailableRuns).toEqual([
      {
        scenarioId: 'cross-source-summary',
        reason: 'benchmark unavailable: invocation timeout',
      },
    ]);
  });

  it('renders unavailable runs in the audit report', () => {
    const report = buildDiscoverabilityAuditReport([
      {
        scenarioId: 'cross-source-summary',
        providerId: 'haiku',
        prompt: 'Explain runtime validation failures.',
        output: '400 invalid_request_error: Your credit balance is too low to access the Anthropic API.',
        toolCalls: [],
        unavailableReason: 'provider unavailable: billing/credit issue',
      },
    ]);

    expect(report).toContain('Unavailable runs:');
    expect(report).toContain('cross-source-summary: provider unavailable: billing/credit issue');
  });

  it('does not mistake a declarative sentence containing "which" for a user question', () => {
    const scored = scoreDiscoverabilityRun({
      scenarioId: 'local-config-lookup',
      providerId: 'gpt-5.4',
      prompt: 'Find the routing defaults.',
      output: 'So the only default preference that differs from the general order is research, which prefers haiku first.',
      toolCalls: [
        toolCall('filesystem.search_file_cache', 1),
        toolCall('filesystem.read_file_chunk', 2),
      ],
    });

    expect(scored.score.askedUser).toBe(false);
  });

  it('tracks correct escalation for true missing-information scenarios', () => {
    const scored = scoreDiscoverabilityRun({
      scenarioId: 'true-missing-information',
      providerId: 'gpt-5.4',
      prompt: 'Proceed as far as possible, then ask for the missing deployment target.',
      output: 'I checked the local config and docs, but the deployment target is still missing. Which deployment target should I use?',
      toolCalls: [
        toolCall('filesystem.search_file_cache', 1),
        toolCall('filesystem.read', 2),
      ],
      askedUserOverride: true,
      groundedOverride: true,
    });

    expect(scored.score.classification).toBe('soft_pass');
    expect(scored.score.correctEscalation).toBe(true);
    expect(scored.score.askedPrematurely).toBe(false);
  });

  it('includes correct escalation rate in the comparative report', () => {
    const report = buildDiscoverabilityAuditReport([
      {
        scenarioId: 'true-missing-information',
        providerId: 'gpt-5.4',
        prompt: 'Find the deployment target.',
        output: 'I checked the local config and docs, but the deployment target is still missing. Which deployment target should I use?',
        toolCalls: [toolCall('filesystem.search_file_cache', 1), toolCall('filesystem.read', 2)],
        askedUserOverride: true,
        groundedOverride: true,
      },
      {
        scenarioId: 'local-config-lookup',
        providerId: 'haiku',
        prompt: 'Find the routing defaults.',
        output: 'Where is the routing file?',
        toolCalls: [],
      },
    ]);

    expect(report).toContain('CorrectEsc');
    expect(report).toContain('correctEscalation=true');
  });
});
