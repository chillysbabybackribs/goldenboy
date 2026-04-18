"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.taskMemoryStore = exports.TaskMemoryStore = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const electron_1 = require("electron");
const ids_1 = require("../../shared/utils/ids");
const runtimeLedgerStore_1 = require("./runtimeLedgerStore");
const model_1 = require("../../shared/types/model");
const TASK_MEMORY_FILE = 'task-memory.json';
const MAX_ENTRIES_PER_TASK = 200;
const MAX_CONTEXT_ENTRIES = 8;
const MAX_CONTEXT_CHARS = 2000;
const DEFAULT_CONTEXT_ENTRY_CHARS = 420;
const MODEL_RESULT_CONTEXT_CHARS = 700;
const NUMBER_WORDS = new Set([
    'zero', 'one', 'two', 'three', 'four', 'five', 'six',
    'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
]);
function getTaskMemoryPath() {
    return path.join(electron_1.app.getPath('userData'), TASK_MEMORY_FILE);
}
function loadMemory() {
    try {
        const filePath = getTaskMemoryPath();
        if (!fs.existsSync(filePath))
            return [];
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
function saveMemory(records) {
    try {
        fs.writeFileSync(getTaskMemoryPath(), JSON.stringify(records, null, 2), 'utf-8');
    }
    catch (err) {
        console.error('Failed to persist task memory:', err);
    }
}
function truncate(text, maxChars, suffix = '...[truncated]') {
    if (text.length <= maxChars)
        return text;
    return `${text.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`;
}
class TaskMemoryStore {
    memoryByTask = new Map();
    constructor() {
        for (const record of loadMemory()) {
            if (record?.taskId) {
                this.memoryByTask.set(record.taskId, record);
            }
        }
    }
    get(taskId) {
        return this.memoryByTask.get(taskId) || (0, model_1.createEmptyTaskMemoryRecord)(taskId);
    }
    clearTask(taskId) {
        if (!this.memoryByTask.has(taskId))
            return;
        this.memoryByTask.delete(taskId);
        saveMemory(Array.from(this.memoryByTask.values()));
    }
    hasEntries(taskId) {
        const record = this.memoryByTask.get(taskId);
        return !!record && record.entries.length > 0;
    }
    getCategoryCounts(taskId) {
        const memory = this.get(taskId);
        return memory.entries.reduce((counts, entry) => {
            const category = typeof entry.metadata?.category === 'string' ? entry.metadata.category : '';
            if (category === 'claim' || category === 'evidence' || category === 'critique' || category === 'verification') {
                counts[category] += 1;
            }
            return counts;
        }, { claim: 0, evidence: 0, critique: 0, verification: 0 });
    }
    getReasoningTexts(taskId, categories) {
        const allowed = categories ? new Set(categories) : null;
        return this.get(taskId).entries
            .filter((entry) => {
            const category = typeof entry.metadata?.category === 'string' ? entry.metadata.category : '';
            return !!category && (!allowed || allowed.has(category));
        })
            .map(entry => entry.text);
    }
    findEvidenceConsistencyIssues(taskId, output) {
        const supportCorpus = this.getReasoningTexts(taskId, ['claim', 'evidence']).join(' ').toLowerCase();
        if (!supportCorpus.trim() || !output.trim())
            return [];
        const issues = new Set();
        const normalizedOutput = output.toLowerCase();
        const numericTokens = normalizedOutput.match(/\b\d+\b/g) || [];
        for (const token of numericTokens) {
            if (!supportCorpus.includes(token)) {
                issues.add(`Final answer uses unsupported numeric detail "${token}".`);
            }
        }
        const wordTokens = normalizedOutput.match(/\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g) || [];
        for (const token of wordTokens) {
            if (NUMBER_WORDS.has(token) && !supportCorpus.includes(token)) {
                issues.add(`Final answer uses unsupported spelled-out numeric detail "${token}".`);
            }
        }
        return Array.from(issues);
    }
    recordUserPrompt(taskId, text, metadata) {
        return this.append(taskId, {
            id: (0, ids_1.generateId)('mem'),
            taskId,
            kind: 'user_prompt',
            text,
            createdAt: Date.now(),
            metadata,
        });
    }
    recordInvocationResult(result) {
        return this.append(result.taskId, {
            id: (0, ids_1.generateId)('mem'),
            taskId: result.taskId,
            kind: 'model_result',
            text: result.success ? result.output : (result.error || 'Invocation failed'),
            providerId: result.providerId,
            createdAt: Date.now(),
            metadata: {
                success: result.success,
                inputTokens: result.usage.inputTokens,
                outputTokens: result.usage.outputTokens,
                durationMs: result.usage.durationMs,
                runId: result.runId,
                processEntries: result.processEntries,
            },
        });
    }
    recordBrowserFinding(finding) {
        return this.append(finding.taskId, {
            id: (0, ids_1.generateId)('mem'),
            taskId: finding.taskId,
            kind: 'browser_finding',
            text: `${finding.title}: ${finding.summary}`,
            createdAt: Date.now(),
            metadata: {
                tabId: finding.tabId,
                severity: finding.severity,
                snapshotId: finding.snapshotId,
                evidence: finding.evidence,
            },
        });
    }
    recordClaim(taskId, text, metadata) {
        return this.append(taskId, {
            id: (0, ids_1.generateId)('mem'),
            taskId,
            kind: 'system',
            text: `Claim: ${text}`,
            createdAt: Date.now(),
            metadata: { category: 'claim', ...metadata },
        });
    }
    recordEvidence(taskId, text, metadata) {
        return this.append(taskId, {
            id: (0, ids_1.generateId)('mem'),
            taskId,
            kind: 'system',
            text: `Evidence: ${text}`,
            createdAt: Date.now(),
            metadata: { category: 'evidence', ...metadata },
        });
    }
    recordCritique(taskId, text, metadata) {
        return this.append(taskId, {
            id: (0, ids_1.generateId)('mem'),
            taskId,
            kind: 'system',
            text: `Critique: ${text}`,
            createdAt: Date.now(),
            metadata: { category: 'critique', ...metadata },
        });
    }
    recordVerification(taskId, text, metadata) {
        return this.append(taskId, {
            id: (0, ids_1.generateId)('mem'),
            taskId,
            kind: 'system',
            text: `Verification: ${text}`,
            createdAt: Date.now(),
            metadata: { category: 'verification', ...metadata },
        });
    }
    recordHandoff(packet) {
        return this.append(packet.taskId, {
            id: (0, ids_1.generateId)('mem'),
            taskId: packet.taskId,
            kind: 'handoff',
            text: packet.summary,
            providerId: packet.toProvider,
            createdAt: Date.now(),
            metadata: {
                fromProvider: packet.fromProvider,
                toProvider: packet.toProvider,
                artifactCount: packet.artifacts.length,
            },
        });
    }
    buildContext(taskId, input) {
        const memory = this.get(taskId);
        const excluded = new Set(input?.excludeEntryIds || []);
        const recent = memory.entries
            .filter((entry) => !excluded.has(entry.id))
            .slice(-MAX_CONTEXT_ENTRIES);
        if (recent.length === 0) {
            return null;
        }
        // Group structured reasoning entries by category for easier reference
        const claims = [];
        const evidence = [];
        const critiques = [];
        const verifications = [];
        const chronologyEntries = [];
        for (const entry of recent) {
            const category = typeof entry.metadata?.category === 'string' ? entry.metadata.category : '';
            if (category === 'claim') {
                claims.push(entry.text);
            }
            else if (category === 'evidence') {
                evidence.push(entry.text);
            }
            else if (category === 'critique') {
                critiques.push(entry.text);
            }
            else if (category === 'verification') {
                verifications.push(entry.text);
            }
            else {
                chronologyEntries.push(entry);
            }
        }
        const sections = ['## Task Memory'];
        const latestUser = [...recent].reverse().find((entry) => entry.kind === 'user_prompt');
        const latestModel = [...recent].reverse().find((entry) => entry.kind === 'model_result');
        const latestFailure = [...recent].reverse().find((entry) => entry.kind === 'model_result' && entry.metadata?.success === false);
        const latestBrowserFinding = [...recent].reverse().find((entry) => entry.kind === 'browser_finding');
        if (latestUser || latestModel || latestFailure || latestBrowserFinding) {
            sections.push('### Current State');
            if (latestUser)
                sections.push(`Latest user request: ${this.formatContextEntryText(latestUser)}`);
            if (latestModel)
                sections.push(`Latest model result: ${this.formatContextEntryText(latestModel)}`);
            if (latestFailure && latestFailure.id !== latestModel?.id) {
                sections.push(`Last failure: ${this.formatContextEntryText(latestFailure)}`);
            }
            if (latestBrowserFinding) {
                sections.push(`Latest browser finding: ${this.formatContextEntryText(latestBrowserFinding)}`);
            }
        }
        if (claims.length > 0 || evidence.length > 0 || critiques.length > 0 || verifications.length > 0) {
            sections.push('### Reasoning State');
            if (claims.length > 0)
                sections.push('**Claims:** ' + claims.slice(-2).join(' | '));
            if (evidence.length > 0)
                sections.push('**Evidence:** ' + evidence.slice(-2).join(' | '));
            if (critiques.length > 0)
                sections.push('**Critiques:** ' + critiques.slice(-2).join(' | '));
            if (verifications.length > 0)
                sections.push('**Verifications:** ' + verifications.slice(-2).join(' | '));
        }
        const recentHistory = chronologyEntries.slice(-4).map((entry) => {
            const prefix = (() => {
                switch (entry.kind) {
                    case 'user_prompt': return 'User';
                    case 'model_result': return entry.providerId ? `Model(${entry.providerId})` : 'Model';
                    case 'browser_finding': return 'Browser';
                    case 'handoff': return 'Handoff';
                    default: return 'System';
                }
            })();
            return `${prefix}: ${this.formatContextEntryText(entry)}`;
        });
        if (recentHistory.length > 0) {
            sections.push('### Recent History');
            sections.push(...recentHistory);
        }
        const maxChars = Math.min(Math.max(input?.maxChars || MAX_CONTEXT_CHARS, 300), 12_000);
        let context = sections.join('\n');
        if (context.length > maxChars) {
            context = truncate(context, maxChars, '\n…[context truncated]');
        }
        return context;
    }
    append(taskId, entry) {
        const current = this.memoryByTask.get(taskId) || (0, model_1.createEmptyTaskMemoryRecord)(taskId);
        const next = {
            taskId,
            lastUpdatedAt: entry.createdAt,
            entries: [...current.entries, entry].slice(-MAX_ENTRIES_PER_TASK),
        };
        this.memoryByTask.set(taskId, next);
        saveMemory(Array.from(this.memoryByTask.values()));
        runtimeLedgerStore_1.runtimeLedgerStore.recordTaskMemoryEntry(entry);
        return next;
    }
    formatEntryText(entry) {
        const attachmentSummary = typeof entry.metadata?.attachmentSummary === 'string'
            ? entry.metadata.attachmentSummary.trim()
            : '';
        const text = entry.text.trim();
        if (text && attachmentSummary)
            return `${text} ${attachmentSummary}`;
        if (text)
            return text;
        if (attachmentSummary)
            return attachmentSummary;
        return entry.text;
    }
    formatContextEntryText(entry) {
        const raw = this.formatEntryText(entry);
        const maxChars = entry.kind === 'model_result' ? MODEL_RESULT_CONTEXT_CHARS : DEFAULT_CONTEXT_ENTRY_CHARS;
        return truncate(raw, maxChars, '\n...[memory entry truncated]');
    }
}
exports.TaskMemoryStore = TaskMemoryStore;
exports.taskMemoryStore = new TaskMemoryStore();
//# sourceMappingURL=taskMemoryStore.js.map