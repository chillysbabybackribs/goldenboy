"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureDiscoverabilityArtifactsFromInvocation = captureDiscoverabilityArtifactsFromInvocation;
exports.buildDiscoverabilityProviderReportFromInvocations = buildDiscoverabilityProviderReportFromInvocations;
exports.buildDiscoverabilityAuditReportFromInvocations = buildDiscoverabilityAuditReportFromInvocations;
const AgentRunStore_1 = require("./AgentRunStore");
const discoverabilityAuditRunner_1 = require("./discoverabilityAuditRunner");
function detectProviderUnavailableReason(result) {
    if (result.success)
        return undefined;
    const text = `${result.error || ''}\n${result.output || ''}`.toLowerCase();
    if (!text.trim())
        return undefined;
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
function captureDiscoverabilityArtifactsFromInvocation(input) {
    return {
        scenarioId: input.scenarioId,
        providerId: input.result.providerId,
        prompt: input.prompt,
        output: input.result.success ? input.result.output : (input.result.error || ''),
        toolCalls: input.result.runId ? AgentRunStore_1.agentRunStore.listToolCalls(input.result.runId) : [],
        askedUserOverride: input.askedUserOverride,
        groundedOverride: input.groundedOverride,
        unavailableReason: detectProviderUnavailableReason(input.result),
    };
}
function buildDiscoverabilityProviderReportFromInvocations(providerId, inputs) {
    return (0, discoverabilityAuditRunner_1.buildDiscoverabilityProviderReport)(providerId, inputs.map(captureDiscoverabilityArtifactsFromInvocation));
}
function buildDiscoverabilityAuditReportFromInvocations(inputs) {
    return (0, discoverabilityAuditRunner_1.buildDiscoverabilityAuditReport)(inputs.map(captureDiscoverabilityArtifactsFromInvocation));
}
//# sourceMappingURL=discoverabilityLiveCapture.js.map