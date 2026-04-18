import type { AnyProviderId } from '../../shared/types/model';
import type { AgentToolCallRecord } from './AgentTypes';
import { type DiscoverabilityAggregateScore, type DiscoverabilityScenarioScore, type DiscoverabilityTraceStep } from './discoverabilityAudit';
import { type DiscoverabilityScenarioBucket, type DiscoverabilityAuditScenario } from './discoverabilityAuditFixtures';
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
export declare function scoreDiscoverabilityRun(input: DiscoverabilityRuntimeArtifacts): DiscoverabilityRunScore;
export declare function buildDiscoverabilityProviderReport(providerId: AnyProviderId, runs: DiscoverabilityRuntimeArtifacts[]): DiscoverabilityProviderReport;
export declare function buildDiscoverabilityAuditReport(runs: DiscoverabilityRuntimeArtifacts[]): string;
