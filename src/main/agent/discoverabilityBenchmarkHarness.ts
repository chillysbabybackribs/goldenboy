import type { AgentInvocationOptions, InvocationResult, ProviderId } from '../../shared/types/model';
import {
  buildDiscoverabilityAuditReportFromInvocations,
  captureDiscoverabilityArtifactsFromInvocation,
  type DiscoverabilityInvocationInput,
} from './discoverabilityLiveCapture';
import {
  DISCOVERABILITY_AUDIT_SCENARIOS,
  type DiscoverabilityAuditScenario,
} from './discoverabilityAuditFixtures';

export type DiscoverabilityBenchmarkInvoker = {
  invoke: (
    taskId: string,
    prompt: string,
    explicitOwner?: string,
    options?: AgentInvocationOptions,
  ) => Promise<InvocationResult>;
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

function makeTaskId(prefix: string, scenarioId: string, providerId: ProviderId): string {
  return `${prefix}-${scenarioId}-${providerId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function invokeWithTimeout(
  invoker: DiscoverabilityBenchmarkInvoker,
  taskId: string,
  prompt: string,
  providerId: ProviderId,
  options: AgentInvocationOptions | undefined,
  timeoutMs: number,
): Promise<InvocationResult> {
  return await Promise.race([
    invoker.invoke(taskId, prompt, providerId, options),
    new Promise<InvocationResult>((resolve) => {
      const timer = setTimeout(() => {
        clearTimeout(timer);
        resolve({
          taskId,
          providerId,
          success: false,
          output: '',
          artifacts: [],
          error: `benchmark timeout after ${timeoutMs}ms`,
          usage: { inputTokens: 0, outputTokens: 0, durationMs: timeoutMs },
        });
      }, timeoutMs);
    }),
  ]);
}

export async function runDiscoverabilityBenchmark(
  invoker: DiscoverabilityBenchmarkInvoker,
  options?: DiscoverabilityBenchmarkOptions,
): Promise<DiscoverabilityBenchmarkOutput> {
  const scenarios = options?.scenarios ?? DISCOVERABILITY_AUDIT_SCENARIOS;
  const providers = options?.providers ?? ['gpt-5.4', 'haiku'];
  const prefix = options?.taskIdPrefix ?? 'discoverability-audit';
  const perInvocationTimeoutMs = Math.max(1_000, options?.perInvocationTimeoutMs ?? 120_000);
  const runs: DiscoverabilityBenchmarkRun[] = [];

  for (const scenario of scenarios) {
    for (const providerId of providers) {
      const taskId = makeTaskId(prefix, scenario.id, providerId);
      let result: InvocationResult;
      try {
        result = await invokeWithTimeout(
          invoker,
          taskId,
          scenario.task,
          providerId,
          options?.invocationOptions?.[providerId],
          perInvocationTimeoutMs,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result = {
          taskId,
          providerId,
          success: false,
          output: '',
          artifacts: [],
          error: message,
          usage: { inputTokens: 0, outputTokens: 0, durationMs: 0 },
        };
      }
      runs.push({
        scenarioId: scenario.id,
        providerId,
        taskId,
        prompt: scenario.task,
        result,
      });
    }
  }

  const invocations: DiscoverabilityInvocationInput[] = runs.map((run) => ({
    scenarioId: run.scenarioId,
    prompt: run.prompt,
    result: run.result,
  }));

  return {
    runs,
    invocations,
    report: buildDiscoverabilityAuditReportFromInvocations(invocations),
  };
}

export function benchmarkRunsToArtifacts(runs: DiscoverabilityBenchmarkRun[]) {
  return runs.map((run) => captureDiscoverabilityArtifactsFromInvocation({
    scenarioId: run.scenarioId,
    prompt: run.prompt,
    result: run.result,
  }));
}
