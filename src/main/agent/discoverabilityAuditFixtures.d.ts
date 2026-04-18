import type { DiscoverabilityScenario } from './discoverabilityAudit';
export type DiscoverabilityScenarioBucket = 'workspace_local' | 'runtime_observable' | 'cross_source' | 'stale_vs_current' | 'negative_control';
export type DiscoverabilityAuditScenario = DiscoverabilityScenario & {
    bucket: DiscoverabilityScenarioBucket;
    task: string;
    availableFacts: string[];
    reachableSources: string[];
    expectedAnswerIncludes: string[];
    expectedAnswerExcludes?: string[];
};
export declare const DISCOVERABILITY_AUDIT_SCENARIOS: DiscoverabilityAuditScenario[];
export declare function discoverabilityScenarioById(id: string): DiscoverabilityAuditScenario;
