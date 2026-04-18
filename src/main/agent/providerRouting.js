"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.taskKindRequiresV2ToolRuntime = taskKindRequiresV2ToolRuntime;
exports.shouldPreferExecForTaskKind = shouldPreferExecForTaskKind;
exports.resolvePrimaryProviderBackend = resolvePrimaryProviderBackend;
exports.providerSupportsPrompt = providerSupportsPrompt;
exports.pickProviderForPrompt = pickProviderForPrompt;
const model_1 = require("../../shared/types/model");
const taskProfile_1 = require("./taskProfile");
const DEFAULT_PROVIDER_ORDER = [model_1.PRIMARY_PROVIDER_ID, model_1.HAIKU_PROVIDER_ID];
function taskKindRequiresV2ToolRuntime(kind) {
    return kind === 'orchestration'
        || kind === 'research'
        || kind === 'browser-automation'
        || kind === 'implementation'
        || kind === 'debug'
        || kind === 'review';
}
function shouldPreferExecForTaskKind(taskKind) {
    return taskKind === 'implementation' || taskKind === 'debug' || taskKind === 'review';
}
function resolvePrimaryProviderBackend(taskKind, configuredMode = process.env.CODEX_PROVIDER, execAvailable = true) {
    if (!execAvailable)
        return 'app-server';
    if (configuredMode === 'exec')
        return 'exec';
    return shouldPreferExecForTaskKind(taskKind) ? 'exec' : 'app-server';
}
function providerSupportsPrompt(providerId, prompt, overrides, capabilities) {
    const profile = (0, taskProfile_1.buildTaskProfile)(prompt, overrides);
    if (!taskKindRequiresV2ToolRuntime(profile.kind))
        return true;
    if (!capabilities)
        return true;
    return capabilities[providerId]?.supportsV2ToolRuntime === true;
}
function pickProviderForPrompt(prompt, availableProviders, overrides, capabilities) {
    const available = new Set(Array.from(availableProviders).filter((providerId) => providerSupportsPrompt(providerId, prompt, overrides, capabilities)));
    const profile = (0, taskProfile_1.buildTaskProfile)(prompt, overrides);
    if (available.size === 0)
        return null;
    if (profile.kind === 'research') {
        if (available.has(model_1.HAIKU_PROVIDER_ID))
            return model_1.HAIKU_PROVIDER_ID;
        if (available.has(model_1.PRIMARY_PROVIDER_ID))
            return model_1.PRIMARY_PROVIDER_ID;
    }
    if (profile.kind === 'browser-automation') {
        if (available.has(model_1.PRIMARY_PROVIDER_ID))
            return model_1.PRIMARY_PROVIDER_ID;
        if (available.has(model_1.HAIKU_PROVIDER_ID))
            return model_1.HAIKU_PROVIDER_ID;
    }
    if (profile.kind === 'implementation') {
        if (available.has(model_1.PRIMARY_PROVIDER_ID))
            return model_1.PRIMARY_PROVIDER_ID;
        if (available.has(model_1.HAIKU_PROVIDER_ID))
            return model_1.HAIKU_PROVIDER_ID;
    }
    if (profile.kind === 'orchestration'
        || profile.kind === 'review'
        || profile.kind === 'debug') {
        if (available.has(model_1.PRIMARY_PROVIDER_ID))
            return model_1.PRIMARY_PROVIDER_ID;
        if (available.has(model_1.HAIKU_PROVIDER_ID))
            return model_1.HAIKU_PROVIDER_ID;
    }
    for (const providerId of DEFAULT_PROVIDER_ORDER) {
        if (available.has(providerId))
            return providerId;
    }
    return null;
}
//# sourceMappingURL=providerRouting.js.map