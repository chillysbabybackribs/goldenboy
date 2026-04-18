"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const discoverabilityAuditRunner_1 = require("./discoverabilityAuditRunner");
function toolCall(toolName, startedAt = 1) {
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
(0, vitest_1.describe)('discoverability audit runner', () => {
    (0, vitest_1.it)('scores runtime-style artifacts against a concrete scenario fixture', () => {
        const scored = (0, discoverabilityAuditRunner_1.scoreDiscoverabilityRun)({
            scenarioId: 'local-config-lookup',
            providerId: 'gpt-5.4',
            prompt: 'Find the routing defaults.',
            output: 'The provider order prefers the primary provider first, with haiku after it.',
            toolCalls: [
                toolCall('filesystem.search_file_cache', 1),
                toolCall('filesystem.read', 2),
            ],
        });
        (0, vitest_1.expect)(scored.score.classification).toBe('strong_pass');
        (0, vitest_1.expect)(scored.score.answerCorrect).toBe(true);
        (0, vitest_1.expect)(scored.trace[0]).toMatchObject({ type: 'tool_call', action: 'filesystem.search_file_cache' });
    });
    (0, vitest_1.it)('flags a provider output that asks the user instead of gathering the answer', () => {
        const scored = (0, discoverabilityAuditRunner_1.scoreDiscoverabilityRun)({
            scenarioId: 'tests-infer-behavior',
            providerId: 'haiku',
            prompt: 'Determine the failure behavior.',
            output: 'What exact test file should I read?',
            toolCalls: [],
        });
        (0, vitest_1.expect)(scored.score.classification).toBe('fail');
        (0, vitest_1.expect)(scored.score.failures).toContain('premature_question');
        (0, vitest_1.expect)(scored.score.failures).toContain('tool_avoidance');
    });
    (0, vitest_1.it)('builds a per-provider aggregate report', () => {
        const runs = [
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
        const report = (0, discoverabilityAuditRunner_1.buildDiscoverabilityProviderReport)('gpt-5.4', runs);
        (0, vitest_1.expect)(report.aggregate.totalScenarios).toBe(2);
        (0, vitest_1.expect)(report.aggregate.classifications.strong_pass).toBe(2);
        (0, vitest_1.expect)(report.aggregate.unnecessaryQuestionRate).toBe(0);
        (0, vitest_1.expect)(report.unavailableRuns).toHaveLength(0);
        (0, vitest_1.expect)(report.bucketAggregates).toHaveLength(1);
        (0, vitest_1.expect)(report.bucketAggregates[0].bucket).toBe('workspace_local');
    });
    (0, vitest_1.it)('renders a comparative text report for multiple providers', () => {
        const report = (0, discoverabilityAuditRunner_1.buildDiscoverabilityAuditReport)([
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
        (0, vitest_1.expect)(report).toContain('=== Discoverability Audit ===');
        (0, vitest_1.expect)(report).toContain('gpt-5.4');
        (0, vitest_1.expect)(report).toContain('haiku');
        (0, vitest_1.expect)(report).toContain('Buckets:');
        (0, vitest_1.expect)(report).toContain('workspace_local');
        (0, vitest_1.expect)(report).toContain('local-config-lookup');
    });
    (0, vitest_1.it)('excludes unavailable provider runs from scoring and reports them separately', () => {
        const report = (0, discoverabilityAuditRunner_1.buildDiscoverabilityProviderReport)('haiku', [
            {
                scenarioId: 'cross-source-summary',
                providerId: 'haiku',
                prompt: 'Explain runtime validation failures.',
                output: '400 invalid_request_error: Your credit balance is too low to access the Anthropic API.',
                toolCalls: [],
                unavailableReason: 'provider unavailable: billing/credit issue',
            },
        ]);
        (0, vitest_1.expect)(report.aggregate.totalScenarios).toBe(0);
        (0, vitest_1.expect)(report.unavailableRuns).toEqual([
            {
                scenarioId: 'cross-source-summary',
                reason: 'provider unavailable: billing/credit issue',
            },
        ]);
    });
    (0, vitest_1.it)('excludes timed out benchmark runs from scoring and reports them separately', () => {
        const report = (0, discoverabilityAuditRunner_1.buildDiscoverabilityProviderReport)('gpt-5.4', [
            {
                scenarioId: 'cross-source-summary',
                providerId: 'gpt-5.4',
                prompt: 'Explain runtime validation failures.',
                output: 'benchmark timeout after 15000ms',
                toolCalls: [],
                unavailableReason: 'benchmark unavailable: invocation timeout',
            },
        ]);
        (0, vitest_1.expect)(report.aggregate.totalScenarios).toBe(0);
        (0, vitest_1.expect)(report.unavailableRuns).toEqual([
            {
                scenarioId: 'cross-source-summary',
                reason: 'benchmark unavailable: invocation timeout',
            },
        ]);
    });
    (0, vitest_1.it)('renders unavailable runs in the audit report', () => {
        const report = (0, discoverabilityAuditRunner_1.buildDiscoverabilityAuditReport)([
            {
                scenarioId: 'cross-source-summary',
                providerId: 'haiku',
                prompt: 'Explain runtime validation failures.',
                output: '400 invalid_request_error: Your credit balance is too low to access the Anthropic API.',
                toolCalls: [],
                unavailableReason: 'provider unavailable: billing/credit issue',
            },
        ]);
        (0, vitest_1.expect)(report).toContain('Unavailable runs:');
        (0, vitest_1.expect)(report).toContain('cross-source-summary: provider unavailable: billing/credit issue');
    });
    (0, vitest_1.it)('does not mistake a declarative sentence containing "which" for a user question', () => {
        const scored = (0, discoverabilityAuditRunner_1.scoreDiscoverabilityRun)({
            scenarioId: 'local-config-lookup',
            providerId: 'gpt-5.4',
            prompt: 'Find the routing defaults.',
            output: 'So the only default preference that differs from the general order is research, which prefers haiku first.',
            toolCalls: [
                toolCall('filesystem.search_file_cache', 1),
                toolCall('filesystem.read_file_chunk', 2),
            ],
        });
        (0, vitest_1.expect)(scored.score.askedUser).toBe(false);
    });
    (0, vitest_1.it)('tracks correct escalation for true missing-information scenarios', () => {
        const scored = (0, discoverabilityAuditRunner_1.scoreDiscoverabilityRun)({
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
        (0, vitest_1.expect)(scored.score.classification).toBe('soft_pass');
        (0, vitest_1.expect)(scored.score.correctEscalation).toBe(true);
        (0, vitest_1.expect)(scored.score.askedPrematurely).toBe(false);
    });
    (0, vitest_1.it)('includes correct escalation rate in the comparative report', () => {
        const report = (0, discoverabilityAuditRunner_1.buildDiscoverabilityAuditReport)([
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
        (0, vitest_1.expect)(report).toContain('CorrectEsc');
        (0, vitest_1.expect)(report).toContain('correctEscalation=true');
    });
});
//# sourceMappingURL=discoverabilityAuditRunner.test.js.map