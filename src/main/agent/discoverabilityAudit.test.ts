import { describe, expect, it } from 'vitest';
import {
  aggregateDiscoverabilityScores,
  scoreDiscoverabilityScenario,
  type DiscoverabilityScenario,
} from './discoverabilityAudit';

const baseScenario: DiscoverabilityScenario = {
  id: 'workspace-config',
  title: 'Workspace config lookup',
  minimumDiscoveryActions: ['filesystem.search_file_cache', 'filesystem.read'],
  askRequired: false,
};

describe('discoverability audit scoring', () => {
  it('marks a direct question before any discovery as premature and tool avoidance', () => {
    const score = scoreDiscoverabilityScenario(baseScenario, [
      { type: 'ask_user', question: 'Can you tell me where the config lives?' },
      { type: 'answer', correct: false, groundedInEvidence: false },
    ]);

    expect(score.classification).toBe('fail');
    expect(score.askedPrematurely).toBe(true);
    expect(score.failures).toContain('premature_question');
    expect(score.failures).toContain('tool_avoidance');
    expect(score.minimumPathCoverage).toBe(0);
  });

  it('marks shallow exploration plus a question as weak exploration', () => {
    const score = scoreDiscoverabilityScenario(baseScenario, [
      { type: 'tool_call', action: 'filesystem.search_file_cache' },
      { type: 'ask_user', question: 'What exact file should I read?' },
      { type: 'answer', correct: false, groundedInEvidence: false },
    ]);

    expect(score.classification).toBe('fail');
    expect(score.askedPrematurely).toBe(true);
    expect(score.failures).toContain('weak_exploration');
    expect(score.failures).not.toContain('premature_question');
    expect(score.minimumPathCoverage).toBe(0.5);
  });

  it('passes when the model completes the minimum discovery path and answers from evidence', () => {
    const score = scoreDiscoverabilityScenario(baseScenario, [
      { type: 'tool_call', action: 'filesystem.search_file_cache' },
      { type: 'tool_call', action: 'filesystem.read' },
      { type: 'answer', correct: true, groundedInEvidence: true },
    ]);

    expect(score.classification).toBe('strong_pass');
    expect(score.failures).toEqual([]);
    expect(score.minimumPathCoverage).toBe(1);
  });

  it('treats read_file_chunk as equivalent to a file read for path completion', () => {
    const score = scoreDiscoverabilityScenario(baseScenario, [
      { type: 'tool_call', action: 'filesystem.search_file_cache' },
      { type: 'tool_call', action: 'filesystem.read_file_chunk' },
      { type: 'answer', correct: true, groundedInEvidence: true },
    ]);

    expect(score.classification).toBe('strong_pass');
    expect(score.minimumPathCoverage).toBe(1);
    expect(score.missingDiscoveryActions).toEqual([]);
  });

  it('flags missed synthesis when evidence was gathered but the answer is still wrong', () => {
    const score = scoreDiscoverabilityScenario(baseScenario, [
      { type: 'tool_call', action: 'filesystem.search_file_cache' },
      { type: 'tool_call', action: 'filesystem.read' },
      { type: 'answer', correct: false, groundedInEvidence: true },
    ]);

    expect(score.classification).toBe('fail');
    expect(score.failures).toContain('missed_synthesis');
  });

  it('treats a correct but weakly observed answer as a soft pass instead of wrong confidence', () => {
    const score = scoreDiscoverabilityScenario(baseScenario, [
      { type: 'answer', correct: true, groundedInEvidence: false },
    ]);

    expect(score.classification).toBe('soft_pass');
    expect(score.failures).toEqual([]);
  });

  it('treats asking after exhausting sources in a true gap case as a soft pass', () => {
    const score = scoreDiscoverabilityScenario({
      ...baseScenario,
      id: 'negative-control',
      askRequired: true,
    }, [
      { type: 'tool_call', action: 'filesystem.search_file_cache' },
      { type: 'tool_call', action: 'filesystem.read' },
      { type: 'ask_user', question: 'Which deployment target should I use?' },
      { type: 'answer', correct: true, groundedInEvidence: true },
    ]);

    expect(score.classification).toBe('soft_pass');
    expect(score.askedPrematurely).toBe(false);
    expect(score.failures).toEqual([]);
  });

  it('aggregates per-scenario scores into comparative metrics', () => {
    const strongPass = scoreDiscoverabilityScenario(baseScenario, [
      { type: 'tool_call', action: 'filesystem.search_file_cache' },
      { type: 'tool_call', action: 'filesystem.read' },
      { type: 'answer', correct: true, groundedInEvidence: true },
    ]);
    const fail = scoreDiscoverabilityScenario(baseScenario, [
      { type: 'ask_user', question: 'Where is it?' },
      { type: 'answer', correct: false, groundedInEvidence: false },
    ]);

    const aggregate = aggregateDiscoverabilityScores([strongPass, fail]);

    expect(aggregate.totalScenarios).toBe(2);
    expect(aggregate.unnecessaryQuestionRate).toBe(0.5);
    expect(aggregate.correctAnswerRate).toBe(0.5);
    expect(aggregate.classifications.strong_pass).toBe(1);
    expect(aggregate.classifications.fail).toBe(1);
    expect(aggregate.failureCounts.tool_avoidance).toBe(1);
  });
});
