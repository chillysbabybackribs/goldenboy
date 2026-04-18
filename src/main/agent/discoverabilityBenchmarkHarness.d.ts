import type { AgentInvocationOptions, InvocationResult, ProviderId } from '../../shared/types/model';
import { type DiscoverabilityInvocationInput } from './discoverabilityLiveCapture';
import { type DiscoverabilityAuditScenario } from './discoverabilityAuditFixtures';
export type DiscoverabilityBenchmarkInvoker = {
    invoke: (taskId: string, prompt: string, explicitOwner?: string, options?: AgentInvocationOptions) => Promise<InvocationResult>;
};
export type DiscoverabilityBenchmarkRun = {
    scenarioId: string;
    providerId: ProviderId;
    taskId: string;
    prompt: string;
    result: InvocationResult;
};
export type DiscoverabilityBenchmarkOutput = {
    runs: DiscoverabilityBenchmarkRun[];
    invocations: DiscoverabilityInvocationInput[];
    report: string;
};
export type DiscoverabilityBenchmarkOptions = {
    scenarios?: DiscoverabilityAuditScenario[];
    providers?: ProviderId[];
    taskIdPrefix?: string;
    invocationOptions?: Partial<Record<ProviderId, AgentInvocationOptions>>;
    perInvocationTimeoutMs?: number;
};
export declare function runDiscoverabilityBenchmark(invoker: DiscoverabilityBenchmarkInvoker, options?: DiscoverabilityBenchmarkOptions): Promise<DiscoverabilityBenchmarkOutput>;
export declare function benchmarkRunsToArtifacts(runs: DiscoverabilityBenchmarkRun[]): import("./discoverabilityAuditRunner").DiscoverabilityRuntimeArtifacts[];
