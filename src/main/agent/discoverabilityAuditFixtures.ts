import type { DiscoverabilityScenario } from './discoverabilityAudit';

export type DiscoverabilityScenarioBucket =
  | 'workspace_local'
  | 'runtime_observable'
  | 'cross_source'
  | 'stale_vs_current'
  | 'negative_control';

export type DiscoverabilityAuditScenario = DiscoverabilityScenario & {
  bucket: DiscoverabilityScenarioBucket;
  task: string;
  availableFacts: string[];
  reachableSources: string[];
  expectedAnswerIncludes: string[];
  expectedAnswerExcludes?: string[];
};

export const DISCOVERABILITY_AUDIT_SCENARIOS: DiscoverabilityAuditScenario[] = [
  {
    id: 'local-config-lookup',
    title: 'Local config lookup',
    bucket: 'workspace_local',
    task: 'Find which file defines the provider routing defaults and summarize the default preference order.',
    minimumDiscoveryActions: ['filesystem.search_file_cache', 'filesystem.read'],
    acceptableAlternativeActions: ['filesystem.search', 'filesystem.answer_from_cache'],
    askRequired: false,
    availableFacts: [
      'The routing defaults are in repo source.',
      'The provider order is discoverable from the implementation, not the user.',
    ],
    reachableSources: [
      'filesystem.search_file_cache',
      'filesystem.read',
      'filesystem.search',
    ],
    expectedAnswerIncludes: ['provider', 'order'],
  },
  {
    id: 'tests-infer-behavior',
    title: 'Infer behavior from tests',
    bucket: 'workspace_local',
    task: 'Determine how runtime failures are recorded by inspecting the tests instead of asking for expected behavior.',
    minimumDiscoveryActions: ['filesystem.search_file_cache', 'filesystem.read'],
    acceptableAlternativeActions: ['filesystem.search', 'filesystem.answer_from_cache'],
    askRequired: false,
    availableFacts: [
      'The expected failure behavior is encoded in tests.',
      'The user does not need to restate the expected runtime behavior.',
    ],
    reachableSources: [
      'filesystem.search_file_cache',
      'filesystem.read',
    ],
    expectedAnswerIncludes: ['failed', 'runtime'],
  },
  {
    id: 'runtime-status-from-logs',
    title: 'Runtime status from logs or tool output',
    bucket: 'runtime_observable',
    task: 'Figure out whether a process completed successfully from runtime evidence rather than asking the user what happened.',
    minimumDiscoveryActions: ['terminal.exec'],
    acceptableAlternativeActions: ['chat.read_last'],
    askRequired: false,
    availableFacts: [
      'The result is observable from command output or the recent tool transcript.',
    ],
    reachableSources: [
      'terminal.exec',
      'chat.read_last',
    ],
    expectedAnswerIncludes: ['exit', 'success'],
  },
  {
    id: 'cross-source-summary',
    title: 'Cross-source summary',
    bucket: 'cross_source',
    task: 'Using `ConstraintValidator.ts`, `discoverabilityAudit.ts`, and `MODEL_DISCOVERABILITY_AUDIT_PLAN.md`, explain how tool-result validation differs from discoverability benchmark scoring in this repo.',
    minimumDiscoveryActions: ['filesystem.search_file_cache', 'filesystem.read', 'filesystem.read'],
    acceptableAlternativeActions: ['chat.search', 'filesystem.answer_from_cache'],
    askRequired: false,
    availableFacts: [
      'No single file is sufficient.',
      'The answer requires combining current implementation with the benchmark plan terminology.',
    ],
    reachableSources: [
      'filesystem.search_file_cache',
      'filesystem.read',
      'chat.search',
    ],
    expectedAnswerIncludes: ['valid', 'strong_pass'],
  },
  {
    id: 'stale-doc-vs-current-code',
    title: 'Stale doc versus current code',
    bucket: 'stale_vs_current',
    task: 'A historical app-server rollout plan is marked partially stale. Check the current code and determine which implementation file now persists Codex thread IDs, and what persisted filename it uses.',
    minimumDiscoveryActions: ['filesystem.read', 'filesystem.read'],
    acceptableAlternativeActions: ['filesystem.search_file_cache'],
    askRequired: false,
    availableFacts: [
      'One source is explicitly marked stale.',
      'Current code should take precedence over the historical plan.',
    ],
    reachableSources: [
      'filesystem.read',
      'filesystem.search_file_cache',
    ],
    expectedAnswerIncludes: ['AppServerProvider', 'codex-threads.json'],
  },
  {
    id: 'true-missing-information',
    title: 'True missing information',
    bucket: 'negative_control',
    task: 'Proceed as far as possible, then ask for the single missing deployment target only if it is not discoverable anywhere.',
    minimumDiscoveryActions: ['filesystem.search_file_cache', 'filesystem.read'],
    acceptableAlternativeActions: ['chat.search', 'chat.read_last'],
    askRequired: true,
    availableFacts: [
      'Most context is local.',
      'The deployment target itself is intentionally missing.',
    ],
    reachableSources: [
      'filesystem.search_file_cache',
      'filesystem.read',
      'chat.search',
    ],
    expectedAnswerIncludes: ['deployment', 'target'],
  },
];

export function discoverabilityScenarioById(id: string): DiscoverabilityAuditScenario {
  const scenario = DISCOVERABILITY_AUDIT_SCENARIOS.find((entry) => entry.id === id);
  if (!scenario) throw new Error(`Unknown discoverability audit scenario: ${id}`);
  return scenario;
}
