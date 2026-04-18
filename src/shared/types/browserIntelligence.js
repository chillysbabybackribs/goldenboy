"use strict";
// ═══════════════════════════════════════════════════════════════════════════
// Browser Intelligence Types — Semantic page perception, instrumentation,
// branching scaffolding, and task-bound browser memory
// ═══════════════════════════════════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmptyBrowserTaskMemory = createEmptyBrowserTaskMemory;
function createEmptyBrowserTaskMemory(taskId) {
    return {
        taskId,
        lastUpdatedAt: null,
        findings: [],
        tabsTouched: [],
        snapshotIds: [],
    };
}
//# sourceMappingURL=browserIntelligence.js.map