"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const AgentRunStore_1 = require("./AgentRunStore");
const discoverabilityLiveCapture_1 = require("./discoverabilityLiveCapture");
(0, vitest_1.describe)('discoverability live capture', () => {
    (0, vitest_1.it)('captures runtime tool calls from a real invocation result runId', () => {
        const run = AgentRunStore_1.agentRunStore.createRun({
            parentRunId: null,
            depth: 0,
            role: 'primary',
            task: 'Find the routing defaults',
            mode: 'unrestricted-dev',
        });
        AgentRunStore_1.agentRunStore.updateRun(run.id, { status: 'running' });
        const tool = AgentRunStore_1.agentRunStore.startToolCall({
            runId: run.id,
            agentId: 'gpt-5.4',
            toolName: 'filesystem.search_file_cache',
            toolInput: { query: 'provider routing' },
        });
        AgentRunStore_1.agentRunStore.finishToolCall(tool.id, 'completed', { summary: 'found file' });
        AgentRunStore_1.agentRunStore.finishRun(run.id, 'completed', 'done');
        const artifacts = (0, discoverabilityLiveCapture_1.captureDiscoverabilityArtifactsFromInvocation)({
            scenarioId: 'local-config-lookup',
            prompt: 'Find the routing defaults.',
            result: {
                taskId: 'task-1',
                providerId: 'gpt-5.4',
                success: true,
                output: 'The provider order prefers the primary provider first, with haiku after it.',
                artifacts: [],
                usage: { inputTokens: 1, outputTokens: 1, durationMs: 1 },
                runId: run.id,
            },
        });
        (0, vitest_1.expect)(artifacts.toolCalls).toHaveLength(1);
        (0, vitest_1.expect)(artifacts.toolCalls[0].toolName).toBe('filesystem.search_file_cache');
    });
    (0, vitest_1.it)('builds provider and full reports directly from invocation results', () => {
        const report = (0, discoverabilityLiveCapture_1.buildDiscoverabilityProviderReportFromInvocations)('gpt-5.4', [
            {
                scenarioId: 'local-config-lookup',
                prompt: 'Find the routing defaults.',
                result: {
                    taskId: 'task-1',
                    providerId: 'gpt-5.4',
                    success: true,
                    output: 'The provider order prefers the primary provider first, with haiku after it.',
                    artifacts: [],
                    usage: { inputTokens: 1, outputTokens: 1, durationMs: 1 },
                },
                groundedOverride: true,
            },
        ]);
        (0, vitest_1.expect)(report.aggregate.totalScenarios).toBe(1);
        (0, vitest_1.expect)(report.providerId).toBe('gpt-5.4');
        const fullReport = (0, discoverabilityLiveCapture_1.buildDiscoverabilityAuditReportFromInvocations)([
            {
                scenarioId: 'local-config-lookup',
                prompt: 'Find the routing defaults.',
                result: {
                    taskId: 'task-1',
                    providerId: 'gpt-5.4',
                    success: true,
                    output: 'The provider order prefers the primary provider first, with haiku after it.',
                    artifacts: [],
                    usage: { inputTokens: 1, outputTokens: 1, durationMs: 1 },
                },
                groundedOverride: true,
            },
            {
                scenarioId: 'local-config-lookup',
                prompt: 'Find the routing defaults.',
                result: {
                    taskId: 'task-2',
                    providerId: 'haiku',
                    success: true,
                    output: 'Where is the routing file?',
                    artifacts: [],
                    usage: { inputTokens: 1, outputTokens: 1, durationMs: 1 },
                },
            },
        ]);
        (0, vitest_1.expect)(fullReport).toContain('gpt-5.4');
        (0, vitest_1.expect)(fullReport).toContain('haiku');
    });
    (0, vitest_1.it)('marks provider billing failures as unavailable instead of scoring them', () => {
        const artifacts = (0, discoverabilityLiveCapture_1.captureDiscoverabilityArtifactsFromInvocation)({
            scenarioId: 'cross-source-summary',
            prompt: 'Explain runtime validation failures.',
            result: {
                taskId: 'task-3',
                providerId: 'haiku',
                success: false,
                output: '',
                error: '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}',
                artifacts: [],
                usage: { inputTokens: 0, outputTokens: 0, durationMs: 0 },
            },
        });
        (0, vitest_1.expect)(artifacts.unavailableReason).toBe('provider unavailable: billing/credit issue');
    });
    (0, vitest_1.it)('marks benchmark invocation timeouts as unavailable instead of scoring them', () => {
        const artifacts = (0, discoverabilityLiveCapture_1.captureDiscoverabilityArtifactsFromInvocation)({
            scenarioId: 'cross-source-summary',
            prompt: 'Explain runtime validation failures.',
            result: {
                taskId: 'task-4',
                providerId: 'gpt-5.4',
                success: false,
                output: '',
                error: 'benchmark timeout after 15000ms',
                artifacts: [],
                usage: { inputTokens: 0, outputTokens: 0, durationMs: 15000 },
            },
        });
        (0, vitest_1.expect)(artifacts.unavailableReason).toBe('benchmark unavailable: invocation timeout');
    });
});
//# sourceMappingURL=discoverabilityLiveCapture.test.js.map