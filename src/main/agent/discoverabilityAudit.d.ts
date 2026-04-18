export type DiscoverabilityFailureKind = 'premature_question' | 'weak_exploration' | 'missed_synthesis' | 'wrong_confidence' | 'tool_avoidance';
export type DiscoverabilityScenario = {
    id: string;
    title: string;
    minimumDiscoveryActions: string[];
    acceptableAlternativeActions?: string[];
    askRequired: boolean;
};
export type DiscoverabilityTraceStep = {
    type: 'tool_call';
    action: string;
} | {
    type: 'observation';
    action: string;
} | {
    type: 'ask_user';
    question: string;
} | {
    type: 'answer';
    correct: boolean;
    groundedInEvidence?: boolean;
};
export type DiscoverabilityScenarioScore = {
    scenarioId: string;
    askedUser: boolean;
    askedPrematurely: boolean;
    correctEscalation: boolean;
    minimumPathCoverage: number;
    coveredDiscoveryActions: string[];
    missingDiscoveryActions: string[];
    answerCorrect: boolean;
    groundedInEvidence: boolean;
    classification: 'strong_pass' | 'soft_pass' | 'fail';
    failures: DiscoverabilityFailureKind[];
};
export type DiscoverabilityAggregateScore = {
    totalScenarios: number;
    unnecessaryQuestionRate: number;
    prematureQuestionRate: number;
    correctEscalationRate: number;
    correctAnswerRate: number;
    groundedAnswerRate: number;
    minimumPathCompletionRate: number;
    classifications: Record<'strong_pass' | 'soft_pass' | 'fail', number>;
    failureCounts: Record<DiscoverabilityFailureKind, number>;
};
export declare function scoreDiscoverabilityScenario(scenario: DiscoverabilityScenario, trace: DiscoverabilityTraceStep[]): DiscoverabilityScenarioScore;
export declare function aggregateDiscoverabilityScores(scores: DiscoverabilityScenarioScore[]): DiscoverabilityAggregateScore;
