import type { InvocationResult } from '../../shared/types/model';
import { type DiscoverabilityProviderReport, type DiscoverabilityRuntimeArtifacts } from './discoverabilityAuditRunner';
export type DiscoverabilityInvocationInput = {
    scenarioId: string;
    prompt: string;
    result: InvocationResult;
    askedUserOverride?: boolean;
    groundedOverride?: boolean;
};
export declare function captureDiscoverabilityArtifactsFromInvocation(input: DiscoverabilityInvocationInput): DiscoverabilityRuntimeArtifacts;
export declare function buildDiscoverabilityProviderReportFromInvocations(providerId: InvocationResult['providerId'], inputs: DiscoverabilityInvocationInput[]): DiscoverabilityProviderReport;
export declare function buildDiscoverabilityAuditReportFromInvocations(inputs: DiscoverabilityInvocationInput[]): string;
