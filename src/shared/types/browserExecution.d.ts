import type { BrowserOperationKind } from './browserOperationLedger';
export type BrowserExecutionMode = 'deterministic_replay' | 'deterministic_execute' | 'heuristic_execute' | 'abort';
export type BrowserExecutionConfidence = 'high' | 'medium' | 'low';
export type BrowserNetworkAssessment = {
    availability: 'observe_only';
    reason: string;
} | {
    availability: 'not_applicable';
    reason: string;
};
export type BrowserExecutionDecision = {
    operationKind: BrowserOperationKind;
    selectedMode: BrowserExecutionMode;
    confidence: BrowserExecutionConfidence;
    reasonSummary: string;
    evidence: string[];
    fallbackMode: BrowserExecutionMode | null;
    network: BrowserNetworkAssessment;
};
export type BrowserExecutionDecisionResult = {
    selectedMode: BrowserExecutionMode;
    attemptedModes: BrowserExecutionMode[];
    fallbackUsed: boolean;
    finalStatus: 'completed' | 'failed' | 'aborted';
    summary: string;
};
