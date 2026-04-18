"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.browserOperationLedger = exports.BrowserOperationLedger = void 0;
exports.getRecentBrowserOperationLedgerEntries = getRecentBrowserOperationLedgerEntries;
exports.clearBrowserOperationLedger = clearBrowserOperationLedger;
const node_path_1 = __importDefault(require("node:path"));
const ids_1 = require("../../shared/utils/ids");
const DEFAULT_MAX_LEDGER_ENTRIES = 250;
const MAX_STRING_VALUE_LENGTH = 160;
const MAX_TEXT_PREVIEW_LENGTH = 80;
const MAX_TEXT_SUMMARY_LENGTH = 240;
const MAX_ARRAY_VALUES = 8;
const MAX_REFERENCE_VALUES = 5;
function compactWhitespace(value) {
    return value.replace(/\s+/g, ' ').trim();
}
function truncate(value, maxLength) {
    const compact = compactWhitespace(value);
    if (compact.length <= maxLength)
        return compact;
    return `${compact.slice(0, Math.max(0, maxLength - 3))}...`;
}
function summarizeValue(value) {
    if (value === null)
        return null;
    if (typeof value === 'boolean' || typeof value === 'number')
        return value;
    if (typeof value === 'string')
        return truncate(value, MAX_STRING_VALUE_LENGTH);
    if (Array.isArray(value)) {
        const items = value
            .slice(0, MAX_ARRAY_VALUES)
            .filter((item) => typeof item === 'string' || typeof item === 'number')
            .map((item) => (typeof item === 'string' ? truncate(item, 60) : item));
        return items.length > 0 ? items : undefined;
    }
    return undefined;
}
function buildSummaryText(fields) {
    const parts = Object.entries(fields).map(([key, value]) => {
        if (Array.isArray(value)) {
            return `${key}=[${value.join(', ')}]`;
        }
        return `${key}=${String(value)}`;
    });
    if (parts.length === 0)
        return 'No payload';
    return truncate(parts.join(', '), MAX_TEXT_SUMMARY_LENGTH);
}
function summarizePayload(kind, payload) {
    const fields = {};
    for (const [key, value] of Object.entries(payload)) {
        if (key === 'text' && typeof value === 'string') {
            fields.textLength = value.length;
            const preview = truncate(value, MAX_TEXT_PREVIEW_LENGTH);
            if (preview)
                fields.textPreview = preview;
            continue;
        }
        if (key === 'filePath' && typeof value === 'string') {
            fields.fileName = node_path_1.default.basename(value);
            continue;
        }
        const summarized = summarizeValue(value);
        if (summarized !== undefined)
            fields[key] = summarized;
    }
    if (kind === 'browser.create-tab' && !('url' in fields)) {
        fields.mode = 'blank-tab';
    }
    return {
        text: buildSummaryText(fields),
        fields,
    };
}
function createEmptyReferences() {
    return {
        snapshotIds: [],
        downloadIds: [],
        dialogIds: [],
        consoleEventIds: [],
        networkEventIds: [],
    };
}
function pushUnique(target, value) {
    if (typeof value !== 'string' || value.trim() === '' || target.includes(value))
        return;
    target.push(value);
}
function pushMany(target, values) {
    if (!Array.isArray(values))
        return;
    for (const value of values.slice(0, MAX_REFERENCE_VALUES)) {
        pushUnique(target, value);
    }
}
function asRecord(value) {
    return typeof value === 'object' && value !== null ? value : null;
}
function extractDownloadIds(downloads) {
    if (!Array.isArray(downloads))
        return [];
    const ids = [];
    for (const item of downloads.slice(0, MAX_REFERENCE_VALUES)) {
        pushUnique(ids, asRecord(item)?.id);
    }
    return ids;
}
function extractRelatedReferences(result) {
    const related = createEmptyReferences();
    const snapshot = asRecord(result.data.snapshot);
    pushUnique(related.snapshotIds, snapshot?.id);
    const resultRecord = asRecord(result.data.result);
    const resultSnapshot = asRecord(resultRecord?.snapshot);
    pushUnique(related.snapshotIds, resultSnapshot?.id);
    const download = asRecord(resultRecord?.download);
    pushUnique(related.downloadIds, download?.id);
    pushMany(related.downloadIds, extractDownloadIds(result.data.downloads));
    const dialog = asRecord(resultRecord?.dialog);
    pushUnique(related.dialogIds, dialog?.id);
    const dialogs = Array.isArray(result.data.dialogs)
        ? result.data.dialogs.map(item => item.id)
        : [];
    pushMany(related.dialogIds, dialogs);
    return related;
}
function mergeReferences(current, next) {
    if (!next)
        return current;
    const merged = createEmptyReferences();
    for (const key of Object.keys(merged)) {
        const values = [...current[key]];
        const additions = next[key] || [];
        for (const value of additions)
            pushUnique(values, value);
        merged[key] = values.slice(0, MAX_REFERENCE_VALUES);
    }
    return merged;
}
function resolveSource(source) {
    return source || 'other';
}
function resolveContext(state, payload, context) {
    const payloadTabId = typeof payload.tabId === 'string' && payload.tabId ? payload.tabId : null;
    const resolvedTabId = context?.tabId ?? payloadTabId ?? state.activeTabId ?? null;
    const navigation = state.navigation || {
        url: '',
        title: '',
    };
    return {
        taskId: context?.taskId ?? null,
        tabId: resolvedTabId,
        source: resolveSource(context?.source ?? null),
        agentId: context?.agentId ?? null,
        runId: context?.runId ?? null,
        activeTabId: state.activeTabId || null,
        activeUrl: navigation.url || null,
        activeTitle: navigation.title || null,
        splitLeftTabId: state.splitLeftTabId ?? null,
        splitRightTabId: state.splitRightTabId ?? null,
    };
}
function cloneEntry(entry) {
    return {
        ...entry,
        context: { ...entry.context },
        inputSummary: {
            text: entry.inputSummary.text,
            fields: { ...entry.inputSummary.fields },
        },
        related: {
            snapshotIds: [...entry.related.snapshotIds],
            downloadIds: [...entry.related.downloadIds],
            dialogIds: [...entry.related.dialogIds],
            consoleEventIds: [...entry.related.consoleEventIds],
            networkEventIds: [...entry.related.networkEventIds],
        },
        network: entry.network
            ? {
                requestCount: entry.network.requestCount,
                failedRequestCount: entry.network.failedRequestCount,
                urls: [...entry.network.urls],
                statusCodes: [...entry.network.statusCodes],
            }
            : null,
        targetDescriptor: entry.targetDescriptor
            ? {
                ...entry.targetDescriptor,
                evidence: { ...entry.targetDescriptor.evidence },
            }
            : null,
        validation: entry.validation
            ? {
                ...entry.validation,
                evidenceUsed: [...entry.validation.evidenceUsed],
                expected: { ...entry.validation.expected },
                observed: { ...entry.validation.observed },
            }
            : null,
        replayOfOperationId: entry.replayOfOperationId,
        decision: entry.decision
            ? {
                ...entry.decision,
                evidence: [...entry.decision.evidence],
                network: { ...entry.decision.network },
            }
            : null,
        decisionResult: entry.decisionResult
            ? {
                ...entry.decisionResult,
                attemptedModes: [...entry.decisionResult.attemptedModes],
            }
            : null,
    };
}
class BrowserOperationLedger {
    maxEntries;
    entries = [];
    constructor(maxEntries = DEFAULT_MAX_LEDGER_ENTRIES) {
        this.maxEntries = maxEntries;
    }
    start(input) {
        const now = Date.now();
        const entry = {
            operationId: (0, ids_1.generateId)('bop'),
            timestamp: now,
            kind: input.kind,
            contextId: input.contextId,
            status: 'running',
            context: resolveContext(input.state, input.payload, input.context),
            inputSummary: summarizePayload(input.kind, input.payload),
            resultSummary: null,
            errorSummary: null,
            durationMs: null,
            completedAt: null,
            related: createEmptyReferences(),
            network: null,
            targetDescriptor: input.targetDescriptor ? {
                ...input.targetDescriptor,
                evidence: { ...input.targetDescriptor.evidence },
            } : null,
            validation: null,
            replayOfOperationId: input.replayOfOperationId ?? null,
            decision: input.decision ? {
                ...input.decision,
                evidence: [...input.decision.evidence],
                network: { ...input.decision.network },
            } : null,
            decisionResult: null,
        };
        this.entries.push(entry);
        if (this.entries.length > this.maxEntries) {
            this.entries = this.entries.slice(this.entries.length - this.maxEntries);
        }
        return cloneEntry(entry);
    }
    complete(operationId, result, networkCapture, validation, decisionResult) {
        this.update(operationId, (entry) => ({
            ...entry,
            status: 'completed',
            resultSummary: truncate(result.summary, MAX_TEXT_SUMMARY_LENGTH),
            errorSummary: null,
            completedAt: Date.now(),
            durationMs: Date.now() - entry.timestamp,
            related: mergeReferences(mergeReferences(entry.related, extractRelatedReferences(result)), networkCapture ? { networkEventIds: networkCapture.eventIds } : undefined),
            network: networkCapture?.summary || entry.network,
            validation: validation ? {
                ...validation,
                evidenceUsed: [...validation.evidenceUsed],
                expected: { ...validation.expected },
                observed: { ...validation.observed },
            } : entry.validation,
            decisionResult: decisionResult ? {
                ...decisionResult,
                attemptedModes: [...decisionResult.attemptedModes],
            } : entry.decisionResult,
        }));
    }
    fail(operationId, error, networkCapture, validation, decisionResult) {
        this.update(operationId, (entry) => ({
            ...entry,
            status: 'failed',
            errorSummary: truncate(error instanceof Error ? error.message : String(error), MAX_TEXT_SUMMARY_LENGTH),
            completedAt: Date.now(),
            durationMs: Date.now() - entry.timestamp,
            related: mergeReferences(entry.related, networkCapture ? { networkEventIds: networkCapture.eventIds } : undefined),
            network: networkCapture?.summary || entry.network,
            validation: validation ? {
                ...validation,
                evidenceUsed: [...validation.evidenceUsed],
                expected: { ...validation.expected },
                observed: { ...validation.observed },
            } : entry.validation,
            decisionResult: decisionResult ? {
                ...decisionResult,
                attemptedModes: [...decisionResult.attemptedModes],
            } : entry.decisionResult,
        }));
    }
    listRecent(limit = 50) {
        const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
        return this.entries.slice(-safeLimit).map(cloneEntry);
    }
    clear() {
        this.entries = [];
    }
    update(operationId, updater) {
        this.entries = this.entries.map((entry) => (entry.operationId === operationId ? updater(entry) : entry));
    }
}
exports.BrowserOperationLedger = BrowserOperationLedger;
exports.browserOperationLedger = new BrowserOperationLedger();
function getRecentBrowserOperationLedgerEntries(limit) {
    return exports.browserOperationLedger.listRecent(limit);
}
function clearBrowserOperationLedger() {
    exports.browserOperationLedger.clear();
}
//# sourceMappingURL=browserOperationLedger.js.map