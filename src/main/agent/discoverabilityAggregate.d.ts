import { type DiscoverabilityRuntimeArtifacts } from './discoverabilityAuditRunner';
export type DiscoverabilityStoredRun = {
    scenarioId: string;
    providerId: string;
    taskId: string;
    prompt: string;
    result: {
        taskId: string;
        providerId: string;
        success: boolean;
        output: string;
        artifacts: unknown[];
        error?: string;
        usage: {
            inputTokens: number;
            outputTokens: number;
            durationMs: number;
        };
        codexItems?: unknown[];
        runId?: string;
    };
};
export type DiscoverabilityStoredPayload = {
    generatedAt: string;
    providers: string[];
    scenarios: string[];
    report: string;
    runs: DiscoverabilityStoredRun[];
    artifacts?: DiscoverabilityRuntimeArtifacts[];
};
export declare function mergeDiscoverabilityArtifacts(payloads: DiscoverabilityStoredPayload[]): DiscoverabilityRuntimeArtifacts[];
export declare function buildMergedDiscoverabilityReport(payloads: DiscoverabilityStoredPayload[]): string;
