import type { InvocationResult } from '../../shared/types/model';
import { agentRunStore } from './AgentRunStore';
import {
  buildDiscoverabilityAuditReport,
  buildDiscoverabilityProviderReport,
  type DiscoverabilityProviderReport,
  type DiscoverabilityRuntimeArtifacts,
} from './discoverabilityAuditRunner';

export type DiscoverabilityInvocationInput = {
  scenarioId: string;
  prompt: string;
  result: InvocationResult;
  askedUserOverride?: boolean;
  groundedOverride?: boolean;
};

function detectProviderUnavailableReason(result: InvocationResult): string | undefined {
  if (result.success) return undefined;
  const text = `${result.error || ''}\n${result.output || ''}`.toLowerCase();
  if (!text.trim()) return undefined;

  if (/benchmark timeout after \d+ms/i.test(text)) {
    return 'benchmark unavailable: invocation timeout';
  }

  if (/(credit balance is too low|plans? ?& ?billing|purchase credits)/i.test(text)) {
    return 'provider unavailable: billing/credit issue';
  }
  if (/(rate limit|quota exceeded|insufficient_quota)/i.test(text)) {
    return 'provider unavailable: quota/rate limit';
  }
  if (/(api key|authentication|unauthorized|forbidden)/i.test(text)) {
    return 'provider unavailable: auth/config issue';
  }

  return undefined;
}

export function captureDiscoverabilityArtifactsFromInvocation(
  input: DiscoverabilityInvocationInput,
): DiscoverabilityRuntimeArtifacts {
  return {
    scenarioId: input.scenarioId,
    providerId: input.result.providerId,
    prompt: input.prompt,
    output: input.result.success ? input.result.output : (input.result.error || ''),
    toolCalls: input.result.runId ? agentRunStore.listToolCalls(input.result.runId) : [],
    askedUserOverride: input.askedUserOverride,
    groundedOverride: input.groundedOverride,
    unavailableReason: detectProviderUnavailableReason(input.result),
  };
}

export function buildDiscoverabilityProviderReportFromInvocations(
  providerId: InvocationResult['providerId'],
  inputs: DiscoverabilityInvocationInput[],
): DiscoverabilityProviderReport {
  return buildDiscoverabilityProviderReport(
    providerId,
    inputs.map(captureDiscoverabilityArtifactsFromInvocation),
  );
}

export function buildDiscoverabilityAuditReportFromInvocations(
  inputs: DiscoverabilityInvocationInput[],
): string {
  return buildDiscoverabilityAuditReport(
    inputs.map(captureDiscoverabilityArtifactsFromInvocation),
  );
}
