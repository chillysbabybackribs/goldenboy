import {
  buildDiscoverabilityAuditReport,
  type DiscoverabilityRuntimeArtifacts,
} from './discoverabilityAuditRunner';

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
    usage: { inputTokens: number; outputTokens: number; durationMs: number };
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

export function mergeDiscoverabilityArtifacts(
  payloads: DiscoverabilityStoredPayload[],
): DiscoverabilityRuntimeArtifacts[] {
  const merged: DiscoverabilityRuntimeArtifacts[] = [];
  for (const payload of payloads) {
    for (const artifact of payload.artifacts || []) {
      merged.push(artifact);
    }
  }
  return merged;
}

export function buildMergedDiscoverabilityReport(
  payloads: DiscoverabilityStoredPayload[],
): string {
  return buildDiscoverabilityAuditReport(mergeDiscoverabilityArtifacts(payloads));
}
