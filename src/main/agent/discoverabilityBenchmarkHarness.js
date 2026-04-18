"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDiscoverabilityBenchmark = runDiscoverabilityBenchmark;
exports.benchmarkRunsToArtifacts = benchmarkRunsToArtifacts;
const discoverabilityLiveCapture_1 = require("./discoverabilityLiveCapture");
const discoverabilityAuditFixtures_1 = require("./discoverabilityAuditFixtures");
function makeTaskId(prefix, scenarioId, providerId) {
    return `${prefix}-${scenarioId}-${providerId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
async function invokeWithTimeout(invoker, taskId, prompt, providerId, options, timeoutMs) {
    return await Promise.race([
        invoker.invoke(taskId, prompt, providerId, options),
        new Promise((resolve) => {
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
async function runDiscoverabilityBenchmark(invoker, options) {
    const scenarios = options?.scenarios ?? discoverabilityAuditFixtures_1.DISCOVERABILITY_AUDIT_SCENARIOS;
    const providers = options?.providers ?? ['gpt-5.4', 'haiku'];
    const prefix = options?.taskIdPrefix ?? 'discoverability-audit';
    const perInvocationTimeoutMs = Math.max(1_000, options?.perInvocationTimeoutMs ?? 120_000);
    const runs = [];
    for (const scenario of scenarios) {
        for (const providerId of providers) {
            const taskId = makeTaskId(prefix, scenario.id, providerId);
            let result;
            try {
                result = await invokeWithTimeout(invoker, taskId, scenario.task, providerId, options?.invocationOptions?.[providerId], perInvocationTimeoutMs);
            }
            catch (error) {
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
    const invocations = runs.map((run) => ({
        scenarioId: run.scenarioId,
        prompt: run.prompt,
        result: run.result,
    }));
    return {
        runs,
        invocations,
        report: (0, discoverabilityLiveCapture_1.buildDiscoverabilityAuditReportFromInvocations)(invocations),
    };
}
function benchmarkRunsToArtifacts(runs) {
    return runs.map((run) => (0, discoverabilityLiveCapture_1.captureDiscoverabilityArtifactsFromInvocation)({
        scenarioId: run.scenarioId,
        prompt: run.prompt,
        result: run.result,
    }));
}
//# sourceMappingURL=discoverabilityBenchmarkHarness.js.map