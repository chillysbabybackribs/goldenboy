"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.browserOperationReplayStore = exports.BrowserOperationReplayStore = void 0;
exports.clearBrowserOperationReplayStore = clearBrowserOperationReplayStore;
const DEFAULT_MAX_REPLAYABLE_OPERATIONS = 250;
class BrowserOperationReplayStore {
    maxEntries;
    records = new Map();
    constructor(maxEntries = DEFAULT_MAX_REPLAYABLE_OPERATIONS) {
        this.maxEntries = maxEntries;
    }
    save(operationId, input, targetDescriptor) {
        this.records.set(operationId, {
            operationId,
            kind: input.kind,
            payload: { ...input.payload },
            context: input.context ? { ...input.context } : undefined,
            targetDescriptor: targetDescriptor ? {
                ...targetDescriptor,
                evidence: { ...targetDescriptor.evidence },
            } : null,
        });
        if (this.records.size > this.maxEntries) {
            const staleOperationIds = Array.from(this.records.keys()).slice(0, this.records.size - this.maxEntries);
            for (const staleOperationId of staleOperationIds) {
                this.records.delete(staleOperationId);
            }
        }
    }
    get(operationId) {
        const record = this.records.get(operationId);
        if (!record)
            return null;
        return {
            ...record,
            payload: { ...record.payload },
            context: record.context ? { ...record.context } : undefined,
            targetDescriptor: record.targetDescriptor ? {
                ...record.targetDescriptor,
                evidence: { ...record.targetDescriptor.evidence },
            } : null,
        };
    }
    clear() {
        this.records.clear();
    }
}
exports.BrowserOperationReplayStore = BrowserOperationReplayStore;
exports.browserOperationReplayStore = new BrowserOperationReplayStore();
function clearBrowserOperationReplayStore() {
    exports.browserOperationReplayStore.clear();
}
//# sourceMappingURL=browserOperationReplayStore.js.map