"use strict";
// ═══════════════════════════════════════════════════════════════════════════
// Model Layer Types — Provider registry, routing, handoff, Codex events
// ═══════════════════════════════════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_HAIKU_CONFIG = exports.DEFAULT_CODEX_CONFIG = exports.AGENT_TOOL_PACK_PRESETS = exports.PROVIDER_IDS = exports.HAIKU_PROVIDER_ID = exports.PRIMARY_PROVIDER_ID = void 0;
exports.createDefaultProviderRuntime = createDefaultProviderRuntime;
exports.isProviderId = isProviderId;
exports.isLegacyProviderId = isLegacyProviderId;
exports.createEmptyTaskMemoryRecord = createEmptyTaskMemoryRecord;
// ─── Provider Identity ────────────────────────────────────────────────────
exports.PRIMARY_PROVIDER_ID = 'gpt-5.4';
exports.HAIKU_PROVIDER_ID = 'haiku';
exports.PROVIDER_IDS = [exports.PRIMARY_PROVIDER_ID, exports.HAIKU_PROVIDER_ID];
function createDefaultProviderRuntime(id) {
    return {
        id,
        status: 'unavailable',
        activeTaskId: null,
        lastActivityAt: null,
        errorDetail: null,
    };
}
function isProviderId(value) {
    return value === exports.PRIMARY_PROVIDER_ID || value === exports.HAIKU_PROVIDER_ID;
}
function isLegacyProviderId(value) {
    return value === 'codex';
}
exports.AGENT_TOOL_PACK_PRESETS = ['all', 'mode-6', 'mode-4'];
function createEmptyTaskMemoryRecord(taskId) {
    return {
        taskId,
        lastUpdatedAt: null,
        entries: [],
    };
}
exports.DEFAULT_CODEX_CONFIG = {
    approvalMode: 'dangerously-bypass',
    sandbox: null,
    timeoutMs: 300_000,
    ephemeral: false,
};
exports.DEFAULT_HAIKU_CONFIG = {
    modelId: 'claude-haiku-4-5-20251001',
    maxTokens: 4096,
    streaming: true,
};
//# sourceMappingURL=model.js.map