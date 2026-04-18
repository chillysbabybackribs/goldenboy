import type { AnyProviderId } from '../../shared/types/model';
import type { AgentToolCallRecord } from './AgentTypes';
import {
  aggregateDiscoverabilityScores,
  scoreDiscoverabilityScenario,
  type DiscoverabilityAggregateScore,
  type DiscoverabilityScenarioScore,
  type DiscoverabilityTraceStep,
} from './discoverabilityAudit';
import {
  DISCOVERABILITY_AUDIT_SCENARIOS,
  discoverabilityScenarioById,
  type DiscoverabilityScenarioBucket,
  type DiscoverabilityAuditScenario,
} from './discoverabilityAuditFixtures';

export type DiscoverabilityRuntimeArtifacts = {
  scenarioId: string;
  providerId: AnyProviderId;
  prompt: string;
  output: string;
  toolCalls: AgentToolCallRecord[];
  askedUserOverride?: boolean;
  groundedOverride?: boolean;
  unavailableReason?: string;
};

export type DiscoverabilityRunScore = {
  scenario: DiscoverabilityAuditScenario;
  providerId: AnyProviderId;
  score: DiscoverabilityScenarioScore;
  trace: DiscoverabilityTraceStep[];
};

export type DiscoverabilityProviderReport = {
  providerId: AnyProviderId;
  scenarioScores: DiscoverabilityRunScore[];
  aggregate: DiscoverabilityAggregateScore;
  unavailableRuns: Array<{
    scenarioId: string;
    reason: string;
  }>;
  bucketAggregates: Array<{
    bucket: DiscoverabilityScenarioBucket;
    aggregate: DiscoverabilityAggregateScore;
    scenarioIds: string[];
  }>;
};

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function looksLikeUserQuestion(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (/\?\s*$/.test(normalized)) return true;
  return /^(can you|could you|what exact|what is the|what's the|where is|where should|do you know|please provide)\b/.test(normalized);
}

function answerMatchesScenario(output: string, scenario: DiscoverabilityAuditScenario): boolean {
  const normalized = normalizeText(output);
  if (!normalized) return false;
  if (scenario.expectedAnswerIncludes.some((token) => !normalized.includes(normalizeText(token)))) {
    return false;
  }
  return !(scenario.expectedAnswerExcludes || []).some((token) => normalized.includes(normalizeText(token)));
}

function inferGroundedFromArtifacts(input: DiscoverabilityRuntimeArtifacts): boolean {
  if (typeof input.groundedOverride === 'boolean') return input.groundedOverride;
  return input.toolCalls.some((call) => call.status === 'completed');
}

function toTrace(input: DiscoverabilityRuntimeArtifacts): DiscoverabilityTraceStep[] {
  const trace: DiscoverabilityTraceStep[] = [];
  const sortedToolCalls = [...input.toolCalls].sort((a, b) => a.startedAt - b.startedAt);

  for (const call of sortedToolCalls) {
    if (call.status !== 'completed') continue;
    trace.push({ type: 'tool_call', action: call.toolName });
  }

  const askedUser = typeof input.askedUserOverride === 'boolean'
    ? input.askedUserOverride
    : looksLikeUserQuestion(input.output);
  if (askedUser) {
    trace.push({ type: 'ask_user', question: input.output.trim() });
  }

  trace.push({
    type: 'answer',
    correct: answerMatchesScenario(input.output, discoverabilityScenarioById(input.scenarioId)),
    groundedInEvidence: inferGroundedFromArtifacts(input),
  });

  return trace;
}

export function scoreDiscoverabilityRun(input: DiscoverabilityRuntimeArtifacts): DiscoverabilityRunScore {
  const scenario = discoverabilityScenarioById(input.scenarioId);
  const trace = toTrace(input);
  return {
    scenario,
    providerId: input.providerId,
    score: scoreDiscoverabilityScenario(scenario, trace),
    trace,
  };
}

export function buildDiscoverabilityProviderReport(
  providerId: AnyProviderId,
  runs: DiscoverabilityRuntimeArtifacts[],
): DiscoverabilityProviderReport {
  const providerRuns = runs.filter((run) => run.providerId === providerId);
  const unavailableRuns = providerRuns
    .filter((run) => Boolean(run.unavailableReason))
    .map((run) => ({
      scenarioId: run.scenarioId,
      reason: run.unavailableReason as string,
    }));
  const scenarioScores = providerRuns
    .filter((run) => !run.unavailableReason)
    .filter((run) => run.providerId === providerId)
    .map(scoreDiscoverabilityRun);
  const bucketOrder: DiscoverabilityScenarioBucket[] = [
    'workspace_local',
    'runtime_observable',
    'cross_source',
    'stale_vs_current',
    'negative_control',
  ];
  const bucketAggregates = bucketOrder
    .map((bucket) => {
      const bucketScores = scenarioScores.filter((entry) => entry.scenario.bucket === bucket);
      if (bucketScores.length === 0) return null;
      return {
        bucket,
        aggregate: aggregateDiscoverabilityScores(bucketScores.map((entry) => entry.score)),
        scenarioIds: bucketScores.map((entry) => entry.scenario.id),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  return {
    providerId,
    scenarioScores,
    aggregate: aggregateDiscoverabilityScores(scenarioScores.map((entry) => entry.score)),
    unavailableRuns,
    bucketAggregates,
  };
}

function pad(value: string | number, width: number): string {
  return String(value).padEnd(width, ' ');
}

function formatRate(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function buildDiscoverabilityAuditReport(runs: DiscoverabilityRuntimeArtifacts[]): string {
  const providerIds = Array.from(new Set(runs.map((run) => run.providerId))).sort();
  const reports = providerIds.map((providerId) => buildDiscoverabilityProviderReport(providerId, runs));

  const header = [
    pad('Provider', 12),
    pad('Scenarios', 10),
    pad('Strong', 8),
    pad('Soft', 8),
    pad('Fail', 8),
    pad('UnneededQ', 10),
    pad('CorrectEsc', 10),
    pad('Correct', 8),
    pad('Grounded', 9),
    'MinPath',
  ].join(' ');
  const separator = '-'.repeat(header.length);
  const rows = reports.map((report) => [
    pad(report.providerId, 12),
    pad(report.aggregate.totalScenarios, 10),
    pad(report.aggregate.classifications.strong_pass, 8),
    pad(report.aggregate.classifications.soft_pass, 8),
    pad(report.aggregate.classifications.fail, 8),
    pad(formatRate(report.aggregate.unnecessaryQuestionRate), 10),
    pad(formatRate(report.aggregate.correctEscalationRate), 10),
    pad(formatRate(report.aggregate.correctAnswerRate), 8),
    pad(formatRate(report.aggregate.groundedAnswerRate), 9),
    formatRate(report.aggregate.minimumPathCompletionRate),
  ].join(' '));

  const scenarioSections: string[] = [];
  for (const report of reports) {
    scenarioSections.push(`## ${report.providerId}`);
    if (report.unavailableRuns.length > 0) {
      scenarioSections.push('Unavailable runs:');
      for (const unavailable of report.unavailableRuns) {
        scenarioSections.push(`- ${unavailable.scenarioId}: ${unavailable.reason}`);
      }
      scenarioSections.push('');
    }
    if (report.bucketAggregates.length > 0) {
      scenarioSections.push('Buckets:');
      for (const bucketEntry of report.bucketAggregates) {
        scenarioSections.push(
          `- ${bucketEntry.bucket}: scenarios=${bucketEntry.aggregate.totalScenarios} | strong=${bucketEntry.aggregate.classifications.strong_pass} | soft=${bucketEntry.aggregate.classifications.soft_pass} | fail=${bucketEntry.aggregate.classifications.fail} | correctEsc=${formatRate(bucketEntry.aggregate.correctEscalationRate)} | minPath=${formatRate(bucketEntry.aggregate.minimumPathCompletionRate)}`,
        );
      }
      scenarioSections.push('');
    }
    for (const entry of report.scenarioScores) {
      scenarioSections.push(
        `- ${entry.scenario.id}: ${entry.score.classification} | asked=${entry.score.askedUser} | correctEscalation=${entry.score.correctEscalation} | coverage=${entry.score.minimumPathCoverage.toFixed(2)} | failures=${entry.score.failures.join(', ') || 'none'}`,
      );
    }
    scenarioSections.push('');
  }

  const missingScenarios = DISCOVERABILITY_AUDIT_SCENARIOS
    .filter((scenario) => !runs.some((run) => run.scenarioId === scenario.id))
    .map((scenario) => scenario.id);

  return [
    '=== Discoverability Audit ===',
    '',
    header,
    separator,
    ...rows,
    '',
    ...scenarioSections,
    missingScenarios.length > 0
      ? `Scenarios without any submitted runs: ${missingScenarios.join(', ')}`
      : 'All defined scenarios have at least one submitted run.',
  ].join('\n');
}
