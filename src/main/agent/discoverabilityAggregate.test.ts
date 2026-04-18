import { describe, expect, it } from 'vitest';
import {
  buildMergedDiscoverabilityReport,
  mergeDiscoverabilityArtifacts,
  type DiscoverabilityStoredPayload,
} from './discoverabilityAggregate';

describe('discoverability aggregate', () => {
  it('merges persisted artifacts from multiple chunk payloads into one report', () => {
    const payloads: DiscoverabilityStoredPayload[] = [
      {
        generatedAt: new Date().toISOString(),
        providers: ['gpt-5.4', 'haiku'],
        scenarios: ['local-config-lookup'],
        report: 'chunk-a',
        runs: [],
        artifacts: [
          {
            scenarioId: 'local-config-lookup',
            providerId: 'gpt-5.4',
            prompt: 'Find defaults',
            output: 'The provider order prefers the primary provider first, with haiku after it.',
            toolCalls: [
              {
                id: 'tool-1',
                runId: 'run-1',
                agentId: 'gpt-5.4',
                toolName: 'filesystem.search_file_cache',
                input: {},
                output: {},
                status: 'completed',
                startedAt: 1,
                completedAt: 2,
                error: null,
              },
              {
                id: 'tool-2',
                runId: 'run-1',
                agentId: 'gpt-5.4',
                toolName: 'filesystem.read_file_chunk',
                input: {},
                output: {},
                status: 'completed',
                startedAt: 3,
                completedAt: 4,
                error: null,
              },
            ],
          },
        ],
      },
      {
        generatedAt: new Date().toISOString(),
        providers: ['gpt-5.4', 'haiku'],
        scenarios: ['tests-infer-behavior'],
        report: 'chunk-b',
        runs: [],
        artifacts: [
          {
            scenarioId: 'tests-infer-behavior',
            providerId: 'haiku',
            prompt: 'Infer failure behavior',
            output: 'The runtime is marked failed when the provider surfaces the tool failure.',
            toolCalls: [
              {
                id: 'tool-3',
                runId: 'run-2',
                agentId: 'haiku',
                toolName: 'filesystem.search_file_cache',
                input: {},
                output: {},
                status: 'completed',
                startedAt: 5,
                completedAt: 6,
                error: null,
              },
              {
                id: 'tool-4',
                runId: 'run-2',
                agentId: 'haiku',
                toolName: 'filesystem.read',
                input: {},
                output: {},
                status: 'completed',
                startedAt: 7,
                completedAt: 8,
                error: null,
              },
            ],
          },
        ],
      },
    ];

    const merged = mergeDiscoverabilityArtifacts(payloads);
    expect(merged).toHaveLength(2);

    const report = buildMergedDiscoverabilityReport(payloads);
    expect(report).toContain('gpt-5.4');
    expect(report).toContain('haiku');
    expect(report).toContain('local-config-lookup');
    expect(report).toContain('tests-infer-behavior');
    expect(report).toContain('CorrectEsc');
  });
});
