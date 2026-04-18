"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const discoverabilityBenchmarkHarness_1 = require("./discoverabilityBenchmarkHarness");
const AgentRunStore_1 = require("./AgentRunStore");
function createInvocationResult(providerId, output, runId) {
    return {
        taskId: 'unused',
        providerId,
        success: true,
        output,
        artifacts: [],
        usage: { inputTokens: 1, outputTokens: 1, durationMs: 1 },
        runId,
    };
}
(0, vitest_1.describe)('discoverability benchmark harness', () => {
    (0, vitest_1.it)('runs the scenario matrix across both providers and returns a comparative report', async () => {
        const calls = [];
        const invoker = {
            async invoke(taskId, prompt, explicitOwner) {
                calls.push({ taskId, prompt, owner: explicitOwner });
                if (explicitOwner === 'gpt-5.4') {
                    return createInvocationResult('gpt-5.4', 'The provider order prefers the primary provider first, with haiku after it.');
                }
                return createInvocationResult('haiku', 'Where is the routing file?');
            },
        };
        const result = await (0, discoverabilityBenchmarkHarness_1.runDiscoverabilityBenchmark)(invoker, {
            scenarios: [
                {
                    id: 'local-config-lookup',
                    title: 'Local config lookup',
                    bucket: 'workspace_local',
                    task: 'Find which file defines the provider routing defaults and summarize the default preference order.',
                    minimumDiscoveryActions: ['filesystem.search_file_cache', 'filesystem.read'],
                    askRequired: false,
                    availableFacts: [],
                    reachableSources: [],
                    expectedAnswerIncludes: ['provider', 'order'],
                },
            ],
        });
        (0, vitest_1.expect)(calls).toHaveLength(2);
        (0, vitest_1.expect)(result.runs).toHaveLength(2);
        (0, vitest_1.expect)(result.invocations).toHaveLength(2);
        (0, vitest_1.expect)(result.report).toContain('gpt-5.4');
        (0, vitest_1.expect)(result.report).toContain('haiku');
    });
    (0, vitest_1.it)('can convert harness runs back into scored artifact inputs using live runIds', async () => {
        const run = AgentRunStore_1.agentRunStore.createRun({
            parentRunId: null,
            depth: 0,
            role: 'primary',
            task: 'Find defaults',
            mode: 'unrestricted-dev',
        });
        AgentRunStore_1.agentRunStore.updateRun(run.id, { status: 'running' });
        const toolCall = AgentRunStore_1.agentRunStore.startToolCall({
            runId: run.id,
            agentId: 'gpt-5.4',
            toolName: 'filesystem.search_file_cache',
            toolInput: { query: 'provider order' },
        });
        AgentRunStore_1.agentRunStore.finishToolCall(toolCall.id, 'completed', { summary: 'found match' });
        AgentRunStore_1.agentRunStore.finishRun(run.id, 'completed', 'done');
        const artifacts = (0, discoverabilityBenchmarkHarness_1.benchmarkRunsToArtifacts)([
            {
                scenarioId: 'local-config-lookup',
                providerId: 'gpt-5.4',
                taskId: 'task-1',
                prompt: 'Find defaults',
                result: createInvocationResult('gpt-5.4', 'The provider order prefers the primary provider first, with haiku after it.', run.id),
            },
        ]);
        (0, vitest_1.expect)(artifacts).toHaveLength(1);
        (0, vitest_1.expect)(artifacts[0].toolCalls).toHaveLength(1);
        (0, vitest_1.expect)(artifacts[0].toolCalls[0].toolName).toBe('filesystem.search_file_cache');
    });
    (0, vitest_1.it)('times out a hung invocation and continues the benchmark matrix', async () => {
        const invoker = {
            async invoke(taskId, _prompt, explicitOwner) {
                if (explicitOwner === 'gpt-5.4') {
                    return createInvocationResult('gpt-5.4', 'The provider order prefers the primary provider first, with haiku after it.');
                }
                return await new Promise(() => { });
            },
        };
        const result = await (0, discoverabilityBenchmarkHarness_1.runDiscoverabilityBenchmark)(invoker, {
            scenarios: [
                {
                    id: 'local-config-lookup',
                    title: 'Local config lookup',
                    bucket: 'workspace_local',
                    task: 'Find which file defines the provider routing defaults and summarize the default preference order.',
                    minimumDiscoveryActions: ['filesystem.search_file_cache', 'filesystem.read'],
                    askRequired: false,
                    availableFacts: [],
                    reachableSources: [],
                    expectedAnswerIncludes: ['provider', 'order'],
                },
            ],
            perInvocationTimeoutMs: 10,
        });
        (0, vitest_1.expect)(result.runs).toHaveLength(2);
        const timedOut = result.runs.find((run) => run.providerId === 'haiku');
        (0, vitest_1.expect)(timedOut?.result.success).toBe(false);
        (0, vitest_1.expect)(timedOut?.result.error).toContain('benchmark timeout after 1000ms');
    });
});
//# sourceMappingURL=discoverabilityBenchmarkHarness.test.js.map