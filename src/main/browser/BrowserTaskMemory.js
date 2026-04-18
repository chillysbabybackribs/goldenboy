"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserTaskMemoryStore = void 0;
const browserIntelligence_1 = require("../../shared/types/browserIntelligence");
const MAX_TASK_MEMORY_RECORDS = 200;
const TASK_MEMORY_TTL_MS = 6 * 60 * 60 * 1000;
class BrowserTaskMemoryStore {
    memoryByTask = new Map();
    recordFinding(finding) {
        const current = this.memoryByTask.get(finding.taskId) || (0, browserIntelligence_1.createEmptyBrowserTaskMemory)(finding.taskId);
        const next = {
            ...current,
            lastUpdatedAt: finding.createdAt,
            findings: [...current.findings, finding],
            tabsTouched: current.tabsTouched.includes(finding.tabId)
                ? current.tabsTouched
                : [...current.tabsTouched, finding.tabId],
            snapshotIds: finding.snapshotId && !current.snapshotIds.includes(finding.snapshotId)
                ? [...current.snapshotIds, finding.snapshotId]
                : current.snapshotIds,
        };
        this.memoryByTask.set(finding.taskId, next);
        this.prune();
        return next;
    }
    getTaskMemory(taskId) {
        return this.memoryByTask.get(taskId) || (0, browserIntelligence_1.createEmptyBrowserTaskMemory)(taskId);
    }
    clearTask(taskId) {
        this.memoryByTask.delete(taskId);
    }
    prune(now = Date.now()) {
        for (const [taskId, memory] of this.memoryByTask.entries()) {
            if ((memory.lastUpdatedAt ?? 0) <= now - TASK_MEMORY_TTL_MS) {
                this.memoryByTask.delete(taskId);
            }
        }
        if (this.memoryByTask.size <= MAX_TASK_MEMORY_RECORDS)
            return;
        const oldest = Array.from(this.memoryByTask.entries())
            .sort(([, a], [, b]) => (a.lastUpdatedAt ?? 0) - (b.lastUpdatedAt ?? 0));
        for (const [taskId] of oldest) {
            if (this.memoryByTask.size <= MAX_TASK_MEMORY_RECORDS)
                break;
            this.memoryByTask.delete(taskId);
        }
    }
}
exports.BrowserTaskMemoryStore = BrowserTaskMemoryStore;
//# sourceMappingURL=BrowserTaskMemory.js.map