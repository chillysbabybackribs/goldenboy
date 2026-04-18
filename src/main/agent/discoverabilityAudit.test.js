"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const discoverabilityAudit_1 = require("./discoverabilityAudit");
const baseScenario = {
    id: 'workspace-config',
    title: 'Workspace config lookup',
    minimumDiscoveryActions: ['filesystem.search_file_cache', 'filesystem.read'],
    askRequired: false,
};
(0, vitest_1.describe)('discoverability audit scoring', () => {
    (0, vitest_1.it)('marks a direct question before any discovery as premature and tool avoidance', () => {
        const score = (0, discoverabilityAudit_1.scoreDiscoverabilityScenario)(baseScenario, [
            { type: 'ask_user', question: 'Can you tell me where the config lives?' },
            { type: 'answer', correct: false, groundedInEvidence: false },
        ]);
        (0, vitest_1.expect)(score.classification).toBe('fail');
        (0, vitest_1.expect)(score.askedPrematurely).toBe(true);
        (0, vitest_1.expect)(score.failures).toContain('premature_question');
        (0, vitest_1.expect)(score.failures).toContain('tool_avoidance');
        (0, vitest_1.expect)(score.minimumPathCoverage).toBe(0);
    });
    (0, vitest_1.it)('marks shallow exploration plus a question as weak exploration', () => {
        const score = (0, discoverabilityAudit_1.scoreDiscoverabilityScenario)(baseScenario, [
            { type: 'tool_call', action: 'filesystem.search_file_cache' },
            { type: 'ask_user', question: 'What exact file should I read?' },
            { type: 'answer', correct: false, groundedInEvidence: false },
        ]);
        (0, vitest_1.expect)(score.classification).toBe('fail');
        (0, vitest_1.expect)(score.askedPrematurely).toBe(true);
        (0, vitest_1.expect)(score.failures).toContain('weak_exploration');
        (0, vitest_1.expect)(score.failures).not.toContain('premature_question');
        (0, vitest_1.expect)(score.minimumPathCoverage).toBe(0.5);
    });
    (0, vitest_1.it)('passes when the model completes the minimum discovery path and answers from evidence', () => {
        const score = (0, discoverabilityAudit_1.scoreDiscoverabilityScenario)(baseScenario, [
            { type: 'tool_call', action: 'filesystem.search_file_cache' },
            { type: 'tool_call', action: 'filesystem.read' },
            { type: 'answer', correct: true, groundedInEvidence: true },
        ]);
        (0, vitest_1.expect)(score.classification).toBe('strong_pass');
        (0, vitest_1.expect)(score.failures).toEqual([]);
        (0, vitest_1.expect)(score.minimumPathCoverage).toBe(1);
    });
    (0, vitest_1.it)('treats read_file_chunk as equivalent to a file read for path completion', () => {
        const score = (0, discoverabilityAudit_1.scoreDiscoverabilityScenario)(baseScenario, [
            { type: 'tool_call', action: 'filesystem.search_file_cache' },
            { type: 'tool_call', action: 'filesystem.read_file_chunk' },
            { type: 'answer', correct: true, groundedInEvidence: true },
        ]);
        (0, vitest_1.expect)(score.classification).toBe('strong_pass');
        (0, vitest_1.expect)(score.minimumPathCoverage).toBe(1);
        (0, vitest_1.expect)(score.missingDiscoveryActions).toEqual([]);
    });
    (0, vitest_1.it)('flags missed synthesis when evidence was gathered but the answer is still wrong', () => {
        const score = (0, discoverabilityAudit_1.scoreDiscoverabilityScenario)(baseScenario, [
            { type: 'tool_call', action: 'filesystem.search_file_cache' },
            { type: 'tool_call', action: 'filesystem.read' },
            { type: 'answer', correct: false, groundedInEvidence: true },
        ]);
        (0, vitest_1.expect)(score.classification).toBe('fail');
        (0, vitest_1.expect)(score.failures).toContain('missed_synthesis');
    });
    (0, vitest_1.it)('treats a correct but weakly observed answer as a soft pass instead of wrong confidence', () => {
        const score = (0, discoverabilityAudit_1.scoreDiscoverabilityScenario)(baseScenario, [
            { type: 'answer', correct: true, groundedInEvidence: false },
        ]);
        (0, vitest_1.expect)(score.classification).toBe('soft_pass');
        (0, vitest_1.expect)(score.failures).toEqual([]);
    });
    (0, vitest_1.it)('treats asking after exhausting sources in a true gap case as a soft pass', () => {
        const score = (0, discoverabilityAudit_1.scoreDiscoverabilityScenario)({
            ...baseScenario,
            id: 'negative-control',
            askRequired: true,
        }, [
            { type: 'tool_call', action: 'filesystem.search_file_cache' },
            { type: 'tool_call', action: 'filesystem.read' },
            { type: 'ask_user', question: 'Which deployment target should I use?' },
            { type: 'answer', correct: true, groundedInEvidence: true },
        ]);
        (0, vitest_1.expect)(score.classification).toBe('soft_pass');
        (0, vitest_1.expect)(score.askedPrematurely).toBe(false);
        (0, vitest_1.expect)(score.failures).toEqual([]);
    });
    (0, vitest_1.it)('aggregates per-scenario scores into comparative metrics', () => {
        const strongPass = (0, discoverabilityAudit_1.scoreDiscoverabilityScenario)(baseScenario, [
            { type: 'tool_call', action: 'filesystem.search_file_cache' },
            { type: 'tool_call', action: 'filesystem.read' },
            { type: 'answer', correct: true, groundedInEvidence: true },
        ]);
        const fail = (0, discoverabilityAudit_1.scoreDiscoverabilityScenario)(baseScenario, [
            { type: 'ask_user', question: 'Where is it?' },
            { type: 'answer', correct: false, groundedInEvidence: false },
        ]);
        const aggregate = (0, discoverabilityAudit_1.aggregateDiscoverabilityScores)([strongPass, fail]);
        (0, vitest_1.expect)(aggregate.totalScenarios).toBe(2);
        (0, vitest_1.expect)(aggregate.unnecessaryQuestionRate).toBe(0.5);
        (0, vitest_1.expect)(aggregate.correctAnswerRate).toBe(0.5);
        (0, vitest_1.expect)(aggregate.classifications.strong_pass).toBe(1);
        (0, vitest_1.expect)(aggregate.classifications.fail).toBe(1);
        (0, vitest_1.expect)(aggregate.failureCounts.tool_avoidance).toBe(1);
    });
});
//# sourceMappingURL=discoverabilityAudit.test.js.map