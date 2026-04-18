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
exports.runtimeLedgerStore = exports.RuntimeLedgerStore = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const electron_1 = require("electron");
const ids_1 = require("../../shared/utils/ids");
const appStateStore_1 = require("../state/appStateStore");
const eventBus_1 = require("../events/eventBus");
const events_1 = require("../../shared/types/events");
const RUNTIME_LEDGER_FILE = 'runtime-ledger.json';
const MAX_EVENTS = 5_000;
const MAX_TASK_EVENTS = 40;
const MAX_CONTEXT_CHARS = 2_400;
const MAX_TASK_SWITCH_CONTEXT_CHARS = 1_600;
const CONTINUATION_STOP_WORDS = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'then', 'than', 'have', 'what',
    'when', 'where', 'which', 'should', 'could', 'would', 'there', 'their', 'about', 'after',
    'before', 'while', 'your', 'you', 'just', 'task', 'work', 'continue', 'resume', 'switch',
    'same', 'previous', 'prior', 'last', 'chat', 'thread', 'conversation', 'model',
]);
function ledgerPath() {
    return path.join(electron_1.app.getPath('userData'), RUNTIME_LEDGER_FILE);
}
function loadLedger() {
    try {
        const filePath = ledgerPath();
        if (!fs.existsSync(filePath))
            return [];
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
function saveLedger(events) {
    try {
        fs.writeFileSync(ledgerPath(), JSON.stringify(events, null, 2), 'utf-8');
    }
    catch (err) {
        console.error('Failed to persist runtime ledger:', err);
    }
}
function truncate(text, maxChars, suffix = '...[truncated]') {
    if (text.length <= maxChars)
        return text;
    return `${text.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`;
}
function compact(text) {
    return text.replace(/\s+/g, ' ').trim();
}
function limitUnique(items, limit) {
    const seen = new Set();
    const out = [];
    for (const item of items) {
        const value = compact(item);
        if (!value || seen.has(value))
            continue;
        seen.add(value);
        out.push(value);
        if (out.length >= limit)
            break;
    }
    return out;
}
function extractKeywords(text) {
    return Array.from(new Set(text
        .toLowerCase()
        .match(/[a-z0-9]{4,}/g)
        ?.filter((token) => !CONTINUATION_STOP_WORDS.has(token)) || []));
}
function formatTimestamp(timestamp) {
    return timestamp ? new Date(timestamp).toISOString() : null;
}
function looksLikeCrossTaskContinuation(prompt) {
    const lower = prompt.toLowerCase();
    return /\b(previous|prior|earlier|last)\s+task\b/.test(lower)
        || /\b(switch|switched|handoff|pick up|continue|resume|carry on|same work)\b/.test(lower)
        || /\bfrom before\b/.test(lower)
        || /\bwhat were we\b/.test(lower);
}
function mapTaskMemoryKind(kind, metadata) {
    if (kind === 'user_prompt')
        return 'user_prompt';
    if (kind === 'model_result')
        return 'model_result';
    if (kind === 'browser_finding')
        return 'browser_finding';
    if (kind === 'handoff')
        return 'handoff';
    const category = typeof metadata?.category === 'string' ? metadata.category : '';
    if (category === 'claim')
        return 'claim';
    if (category === 'evidence')
        return 'evidence';
    if (category === 'critique')
        return 'critique';
    if (category === 'verification')
        return 'verification';
    return 'verification';
}
function asString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function asBoolean(value) {
    return typeof value === 'boolean' ? value : null;
}
class RuntimeLedgerStore {
    events = loadLedger();
    constructor() {
        this.attachBrowserEventListeners();
    }
    listRecent(taskId, limit = 20) {
        const filtered = taskId
            ? this.events.filter((event) => event.taskId === taskId)
            : this.events;
        return filtered.slice(-Math.max(1, limit)).map((event) => ({ ...event }));
    }
    append(event) {
        const record = {
            ...event,
            id: (0, ids_1.generateId)('ledger'),
        };
        this.events = [...this.events, record].slice(-MAX_EVENTS);
        saveLedger(this.events);
        return { ...record };
    }
    recordTaskStatus(input) {
        return this.append({
            taskId: input.taskId,
            runId: input.runId,
            providerId: input.providerId,
            timestamp: Date.now(),
            kind: 'task_status',
            scope: 'task',
            source: 'agent-service',
            summary: input.summary,
            metadata: {
                status: input.status,
                ...input.metadata,
            },
        });
    }
    recordProviderSwitch(taskId, fromProviderId, toProviderId) {
        return this.append({
            taskId,
            timestamp: Date.now(),
            kind: 'provider_switch',
            scope: 'task',
            source: 'agent-service',
            providerId: toProviderId,
            summary: `Provider handoff: ${fromProviderId} -> ${toProviderId}`,
            metadata: {
                fromProviderId,
                toProviderId,
            },
        });
    }
    recordArtifactEvent(input) {
        return this.append({
            taskId: input.taskId ?? null,
            providerId: input.providerId,
            timestamp: Date.now(),
            kind: 'artifact',
            scope: input.taskId ? 'task' : 'global',
            source: 'system',
            summary: input.summary,
            metadata: input.metadata,
        });
    }
    recordToolEvent(input) {
        return this.append({
            taskId: input.taskId ?? null,
            providerId: input.providerId,
            runId: input.runId,
            timestamp: Date.now(),
            kind: 'tool',
            scope: input.taskId ? 'task' : 'global',
            source: 'agent-service',
            summary: input.summary,
            metadata: input.metadata,
        });
    }
    recordBrowserEvent(input) {
        return this.append({
            taskId: input.taskId ?? null,
            timestamp: Date.now(),
            kind: 'browser',
            scope: input.taskId ? 'task' : 'global',
            source: 'browser',
            summary: input.summary,
            metadata: input.metadata,
        });
    }
    recordSubagentEvent(input) {
        return this.append({
            taskId: input.taskId ?? null,
            providerId: input.providerId,
            runId: input.runId,
            timestamp: Date.now(),
            kind: 'subagent',
            scope: input.taskId ? 'task' : 'global',
            source: 'subagent',
            summary: input.summary,
            metadata: input.metadata,
        });
    }
    recordTaskMemoryEntry(entry) {
        return this.append({
            taskId: entry.taskId,
            runId: typeof entry.metadata?.runId === 'string' ? entry.metadata.runId : undefined,
            providerId: entry.providerId,
            timestamp: entry.createdAt,
            kind: mapTaskMemoryKind(entry.kind, entry.metadata),
            scope: 'task',
            source: 'task-memory',
            summary: truncate(compact(entry.text), 500),
            metadata: entry.metadata,
        });
    }
    getTaskAwareness(taskId) {
        const recentEvents = this.events.filter((event) => event.taskId === taskId).slice(-MAX_TASK_EVENTS);
        const latestOf = (kind) => [...recentEvents].reverse().find((event) => event.kind === kind) || null;
        const state = appStateStore_1.appStateStore.getState();
        const task = state.tasks.find((item) => item.id === taskId) || null;
        const activeArtifact = state.activeArtifactId
            ? state.artifacts.find((artifact) => artifact.id === state.activeArtifactId) || null
            : null;
        const activeTab = state.browserRuntime.tabs.find((tab) => tab.id === state.browserRuntime.activeTabId) || null;
        const latestTaskStatus = latestOf('task_status');
        const latestUserPrompt = latestOf('user_prompt');
        const latestModelResult = latestOf('model_result');
        const latestBrowserFinding = latestOf('browser_finding');
        const latestBrowserEvent = latestOf('browser');
        const latestProviderSwitch = latestOf('provider_switch');
        const evidence = limitUnique([...recentEvents]
            .reverse()
            .filter((event) => event.kind === 'evidence')
            .map((event) => event.summary), 3);
        const decisions = limitUnique([...recentEvents]
            .reverse()
            .filter((event) => event.kind === 'verification' || event.kind === 'handoff')
            .map((event) => event.summary), 3);
        const openIssues = limitUnique([...recentEvents]
            .reverse()
            .filter((event) => event.kind === 'critique' || event.kind === 'subagent' || (event.kind === 'task_status' && event.metadata?.status === 'failed'))
            .map((event) => event.summary), 4);
        const latestSubagentById = new Map();
        for (const event of recentEvents) {
            if (event.kind !== 'subagent')
                continue;
            const subagentId = typeof event.metadata?.subagentId === 'string' ? event.metadata.subagentId : '';
            if (!subagentId)
                continue;
            latestSubagentById.set(subagentId, event);
        }
        const activeSubagentLabels = limitUnique(Array.from(latestSubagentById.values())
            .filter((event) => event.metadata?.status === 'running')
            .map((event) => event.summary), 4);
        const activeProviderId = (latestTaskStatus?.providerId || latestProviderSwitch?.providerId || latestModelResult?.providerId) ?? null;
        const entities = this.getTaskEntitySnapshot(taskId);
        return {
            taskId,
            taskTitle: task?.title ?? null,
            lastUpdatedAt: recentEvents.at(-1)?.timestamp ?? null,
            activeProviderId,
            taskStatus: task?.status ?? (typeof latestTaskStatus?.metadata?.status === 'string'
                ? latestTaskStatus.metadata.status
                : null),
            latestUserPrompt: latestUserPrompt?.summary ?? null,
            latestModelResult: latestModelResult?.summary ?? null,
            latestBrowserFinding: latestBrowserFinding?.summary ?? latestBrowserEvent?.summary ?? null,
            activeArtifactLabel: entities.artifacts.find((item) => item.isActive)?.title
                ? `${entities.artifacts.find((item) => item.isActive)?.title} (${entities.artifacts.find((item) => item.isActive)?.format})`
                : activeArtifact ? `${activeArtifact.title} (${activeArtifact.format})` : null,
            activeBrowserTabLabel: entities.browserTabs.find((item) => item.isActive)?.title
                || entities.browserTabs.find((item) => item.isActive)?.url
                || (activeTab ? `${activeTab.navigation.title || activeTab.navigation.url || activeTab.id}` : null),
            activeSubagentLabels,
            openIssues,
            evidence: entities.evidence.map((item) => item.summary),
            decisions: entities.decisions.map((item) => item.summary),
            recentEvents: recentEvents.map((event) => ({ ...event })),
        };
    }
    getTaskEntitySnapshot(taskId) {
        const taskEvents = this.events.filter((event) => event.taskId === taskId);
        return {
            taskId,
            currentRun: this.deriveCurrentRunSnapshot(taskEvents),
            artifacts: this.deriveArtifactSnapshots(taskId, taskEvents),
            browserTabs: this.deriveBrowserTabSnapshots(taskId, taskEvents),
            decisions: this.deriveDecisionSnapshots(taskEvents),
            evidence: this.deriveEvidenceSnapshots(taskEvents),
        };
    }
    buildTaskSwitchContext(input) {
        const currentAwareness = this.getTaskAwareness(input.taskId);
        const currentEvents = currentAwareness.recentEvents.length;
        const shouldOfferPriorTaskContext = looksLikeCrossTaskContinuation(input.prompt)
            || currentEvents <= 3
            || (!currentAwareness.latestModelResult && !currentAwareness.latestBrowserFinding);
        if (!shouldOfferPriorTaskContext)
            return null;
        const priorAwareness = this.findRelevantPriorTaskAwareness(input.taskId, input.prompt);
        if (!priorAwareness)
            return null;
        const sections = [
            '## Prior Task Continuity',
            'The current task appears to be a continuation or handoff. Use the prior task state below when it helps resolve references like "that", "the previous work", or a recent task switch.',
        ];
        const title = priorAwareness.taskTitle || priorAwareness.taskId;
        const timestamp = formatTimestamp(priorAwareness.lastUpdatedAt);
        sections.push('', `Prior task: ${title}${priorAwareness.taskStatus ? ` (${priorAwareness.taskStatus})` : ''}${timestamp ? ` • updated ${timestamp}` : ''}`);
        if (priorAwareness.activeProviderId) {
            sections.push(`Prior active provider: ${priorAwareness.activeProviderId}`);
        }
        if (priorAwareness.latestUserPrompt) {
            sections.push(`Latest prior user request: ${priorAwareness.latestUserPrompt}`);
        }
        if (priorAwareness.latestModelResult) {
            sections.push(`Latest prior model result: ${priorAwareness.latestModelResult}`);
        }
        if (priorAwareness.activeArtifactLabel || priorAwareness.activeBrowserTabLabel) {
            sections.push('', '### Prior Active Surfaces');
            if (priorAwareness.activeArtifactLabel)
                sections.push(`- Artifact: ${priorAwareness.activeArtifactLabel}`);
            if (priorAwareness.activeBrowserTabLabel)
                sections.push(`- Browser tab: ${priorAwareness.activeBrowserTabLabel}`);
        }
        if (priorAwareness.evidence.length > 0) {
            sections.push('', '### Prior Evidence');
            sections.push(...priorAwareness.evidence.map((item) => `- ${item}`));
        }
        if (priorAwareness.openIssues.length > 0) {
            sections.push('', '### Prior Open Issues');
            sections.push(...priorAwareness.openIssues.map((item) => `- ${item}`));
        }
        if (priorAwareness.decisions.length > 0) {
            sections.push('', '### Prior Decisions');
            sections.push(...priorAwareness.decisions.map((item) => `- ${item}`));
        }
        const recentHistory = priorAwareness.recentEvents
            .slice(-4)
            .map((event) => `- ${event.kind.replace(/_/g, ' ')}: ${event.summary}`);
        if (recentHistory.length > 0) {
            sections.push('', '### Prior Timeline');
            sections.push(...recentHistory);
        }
        return truncate(sections.join('\n'), MAX_TASK_SWITCH_CONTEXT_CHARS, '\n...[prior task context truncated]');
    }
    buildHydrationContext(input) {
        const awareness = this.getTaskAwareness(input.taskId);
        const entities = this.getTaskEntitySnapshot(input.taskId);
        if (!awareness.lastUpdatedAt)
            return null;
        const sections = ['## Shared Runtime Ledger'];
        if (input.providerSwitched) {
            sections.push(`Provider continuity is shared at the app layer. Continue from the resolved task state below instead of restarting because the active model changed to ${input.currentProviderId}.`);
        }
        else {
            sections.push('Use the shared app ledger below as the task continuity source of truth.');
        }
        if (awareness.latestUserPrompt)
            sections.push('', `Latest user request: ${awareness.latestUserPrompt}`);
        if (awareness.latestModelResult)
            sections.push(`Latest model result: ${awareness.latestModelResult}`);
        if (awareness.latestBrowserFinding)
            sections.push(`Latest browser finding: ${awareness.latestBrowserFinding}`);
        if (awareness.taskStatus || awareness.activeProviderId) {
            sections.push('', `Task status: ${awareness.taskStatus || 'unknown'}${awareness.activeProviderId ? ` | Active provider: ${awareness.activeProviderId}` : ''}`);
        }
        if (entities.currentRun) {
            const currentRun = entities.currentRun;
            sections.push('', '### Current Run');
            sections.push(`- Run: ${currentRun.runId}`);
            sections.push(`- Status: ${currentRun.status || 'unknown'}${currentRun.providerId ? ` | Provider: ${currentRun.providerId}` : ''}`);
            if (currentRun.latestToolSummary) {
                sections.push(`- Latest tool activity: ${currentRun.latestToolSummary}`);
            }
        }
        if (awareness.activeArtifactLabel || awareness.activeBrowserTabLabel || awareness.activeSubagentLabels.length > 0) {
            sections.push('', '### Active Surfaces');
            if (awareness.activeArtifactLabel)
                sections.push(`- Active artifact: ${awareness.activeArtifactLabel}`);
            if (awareness.activeBrowserTabLabel)
                sections.push(`- Active browser tab: ${awareness.activeBrowserTabLabel}`);
            if (awareness.activeSubagentLabels.length > 0) {
                sections.push(...awareness.activeSubagentLabels.map((item) => `- Active sub-agent: ${item}`));
            }
        }
        if (entities.artifacts.length > 0 || entities.browserTabs.length > 0) {
            sections.push('', '### Entity Snapshots');
            for (const artifact of entities.artifacts.slice(0, 2)) {
                sections.push(`- Artifact ${artifact.title} (${artifact.format}, status=${artifact.status}${artifact.isActive ? ', active' : ''})`);
            }
            for (const tab of entities.browserTabs.slice(0, 2)) {
                sections.push(`- Browser tab ${tab.title || tab.url || tab.tabId}${tab.isActive ? ' (active)' : ''}`);
            }
        }
        if (awareness.evidence.length > 0) {
            sections.push('', '### Evidence');
            sections.push(...entities.evidence.slice(0, 3).map((item) => `- ${item.summary}`));
        }
        if (awareness.openIssues.length > 0) {
            sections.push('', '### Open Issues');
            sections.push(...awareness.openIssues.map((item) => `- ${item}`));
        }
        if (awareness.decisions.length > 0) {
            sections.push('', '### Decisions And Verifications');
            sections.push(...entities.decisions.slice(0, 3).map((item) => `- ${item.summary}`));
        }
        const recentHistory = awareness.recentEvents
            .slice(-6)
            .map((event) => {
            const label = event.kind.replace(/_/g, ' ');
            const provider = event.providerId ? ` [${event.providerId}]` : '';
            return `- ${label}${provider}: ${event.summary}`;
        });
        if (recentHistory.length > 0) {
            sections.push('', '### Recent Timeline');
            sections.push(...recentHistory);
        }
        return truncate(sections.join('\n'), MAX_CONTEXT_CHARS, '\n...[ledger context truncated]');
    }
    attachBrowserEventListeners() {
        eventBus_1.eventBus.on(events_1.AppEventType.BROWSER_TAB_CREATED, (event) => {
            this.recordBrowserEvent({
                taskId: appStateStore_1.appStateStore.getState().activeTaskId,
                summary: `Created browser tab ${event.payload.tab.navigation.title || event.payload.tab.navigation.url || event.payload.tab.id}`,
                metadata: { tabId: event.payload.tab.id, action: 'tab-created' },
            });
        });
        eventBus_1.eventBus.on(events_1.AppEventType.BROWSER_TAB_ACTIVATED, (event) => {
            const tab = appStateStore_1.appStateStore.getState().browserRuntime.tabs.find((item) => item.id === event.payload.tabId) || null;
            this.recordBrowserEvent({
                taskId: appStateStore_1.appStateStore.getState().activeTaskId,
                summary: `Activated browser tab ${tab?.navigation.title || tab?.navigation.url || event.payload.tabId}`,
                metadata: { tabId: event.payload.tabId, action: 'tab-activated' },
            });
        });
        eventBus_1.eventBus.on(events_1.AppEventType.BROWSER_TAB_CLOSED, (event) => {
            this.recordBrowserEvent({
                taskId: appStateStore_1.appStateStore.getState().activeTaskId,
                summary: `Closed browser tab ${event.payload.tabId}`,
                metadata: { tabId: event.payload.tabId, action: 'tab-closed' },
            });
        });
        eventBus_1.eventBus.on(events_1.AppEventType.BROWSER_NAVIGATION_UPDATED, (event) => {
            const activeTaskId = appStateStore_1.appStateStore.getState().activeTaskId;
            const url = event.payload.navigation.url || '';
            const title = event.payload.navigation.title || '';
            if (!activeTaskId || (!url && !title))
                return;
            this.recordBrowserEvent({
                taskId: activeTaskId,
                summary: `Browser navigation: ${title || url}`,
                metadata: {
                    action: 'navigation-updated',
                    url,
                    title,
                    isLoading: event.payload.navigation.isLoading,
                },
            });
        });
    }
    findRelevantPriorTaskAwareness(currentTaskId, prompt) {
        const tasks = appStateStore_1.appStateStore.getState().tasks
            .filter((task) => task.id !== currentTaskId)
            .sort((a, b) => b.updatedAt - a.updatedAt);
        if (tasks.length === 0)
            return null;
        const promptKeywords = extractKeywords(prompt);
        let best = null;
        for (const [index, task] of tasks.entries()) {
            const awareness = this.getTaskAwareness(task.id);
            if (!awareness.lastUpdatedAt)
                continue;
            const searchableText = [
                awareness.taskTitle,
                awareness.latestUserPrompt,
                awareness.latestModelResult,
                awareness.latestBrowserFinding,
                ...awareness.openIssues,
                ...awareness.evidence,
                ...awareness.decisions,
            ].filter(Boolean).join(' ');
            const matches = promptKeywords.filter((keyword) => searchableText.toLowerCase().includes(keyword)).length;
            const recencyScore = Math.max(0, 8 - index);
            const activeWorkBonus = awareness.taskStatus === 'running' ? 3 : 0;
            const score = (matches * 10) + recencyScore + activeWorkBonus;
            if (!best || score > best.score) {
                best = { score, awareness };
            }
        }
        if (!best)
            return null;
        if (best.score <= 0 && !looksLikeCrossTaskContinuation(prompt))
            return null;
        return best.awareness;
    }
    deriveCurrentRunSnapshot(taskEvents) {
        const runs = new Map();
        for (const event of taskEvents) {
            const runId = asString(event.runId);
            if (!runId)
                continue;
            const existing = runs.get(runId) || {
                runId,
                taskId: event.taskId ?? null,
                providerId: event.providerId ?? null,
                status: null,
                startedAt: null,
                completedAt: null,
                latestToolCallLabel: null,
                latestToolStatus: null,
                latestToolSummary: null,
            };
            if (!existing.providerId && event.providerId)
                existing.providerId = event.providerId;
            if (event.kind === 'task_status') {
                const status = asString(event.metadata?.status);
                existing.status = status ?? existing.status;
                if (status === 'running')
                    existing.startedAt = event.timestamp;
                if (status === 'completed' || status === 'failed')
                    existing.completedAt = event.timestamp;
            }
            if (event.kind === 'tool') {
                existing.latestToolCallLabel = asString(event.metadata?.toolName) ?? existing.latestToolCallLabel;
                existing.latestToolStatus = asString(event.metadata?.status) ?? existing.latestToolStatus;
                existing.latestToolSummary = event.summary;
            }
            runs.set(runId, existing);
        }
        return Array.from(runs.values())
            .sort((a, b) => {
            const aTime = a.completedAt ?? a.startedAt ?? 0;
            const bTime = b.completedAt ?? b.startedAt ?? 0;
            return bTime - aTime;
        })[0] || null;
    }
    deriveArtifactSnapshots(taskId, taskEvents) {
        const state = appStateStore_1.appStateStore.getState();
        const artifacts = state.artifacts
            .filter((artifact) => artifact.linkedTaskIds.includes(taskId) || state.activeArtifactId === artifact.id);
        const latestArtifactEventById = new Map();
        for (const event of taskEvents) {
            if (event.kind !== 'artifact')
                continue;
            const artifactId = asString(event.metadata?.artifactId);
            if (!artifactId)
                continue;
            latestArtifactEventById.set(artifactId, event);
        }
        return artifacts
            .map((artifact) => {
            const latestEvent = latestArtifactEventById.get(artifact.id) || null;
            return {
                artifactId: artifact.id,
                taskId,
                title: artifact.title,
                format: artifact.format,
                status: artifact.status,
                isActive: state.activeArtifactId === artifact.id,
                lastUpdatedAt: artifact.updatedAt,
                lastAction: asString(latestEvent?.metadata?.action),
                lastSummary: latestEvent?.summary ?? null,
            };
        })
            .sort((a, b) => {
            if (a.isActive !== b.isActive)
                return a.isActive ? -1 : 1;
            return b.lastUpdatedAt - a.lastUpdatedAt;
        });
    }
    deriveBrowserTabSnapshots(taskId, taskEvents) {
        const state = appStateStore_1.appStateStore.getState();
        const runtimeTabs = state.browserRuntime.tabs;
        const latestBrowserEventById = new Map();
        for (const event of taskEvents) {
            if (event.kind !== 'browser')
                continue;
            const tabId = asString(event.metadata?.tabId);
            if (!tabId)
                continue;
            latestBrowserEventById.set(tabId, event);
        }
        const tabIds = new Set([
            ...runtimeTabs.map((tab) => tab.id),
            ...latestBrowserEventById.keys(),
        ]);
        return Array.from(tabIds)
            .map((tabId) => {
            const tab = runtimeTabs.find((item) => item.id === tabId) || null;
            const latestEvent = latestBrowserEventById.get(tabId) || null;
            const title = tab?.navigation.title || asString(latestEvent?.metadata?.title);
            const url = tab?.navigation.url || asString(latestEvent?.metadata?.url);
            return {
                tabId,
                taskId,
                title,
                url,
                isActive: state.browserRuntime.activeTabId === tabId,
                isLoading: tab?.navigation.isLoading ?? asBoolean(latestEvent?.metadata?.isLoading),
                lastUpdatedAt: latestEvent?.timestamp ?? Date.now(),
                lastAction: asString(latestEvent?.metadata?.action),
                lastSummary: latestEvent?.summary ?? null,
            };
        })
            .filter((tab) => Boolean(tab.title || tab.url || tab.lastSummary))
            .sort((a, b) => {
            if (a.isActive !== b.isActive)
                return a.isActive ? -1 : 1;
            return b.lastUpdatedAt - a.lastUpdatedAt;
        });
    }
    deriveDecisionSnapshots(taskEvents) {
        return taskEvents
            .filter((event) => event.kind === 'verification' || event.kind === 'handoff')
            .slice(-5)
            .reverse()
            .map((event) => ({
            taskId: event.taskId ?? null,
            summary: event.summary,
            sourceKind: event.kind,
            timestamp: event.timestamp,
            providerId: event.providerId ?? null,
        }));
    }
    deriveEvidenceSnapshots(taskEvents) {
        return taskEvents
            .filter((event) => event.kind === 'evidence' || event.kind === 'browser_finding')
            .slice(-5)
            .reverse()
            .map((event) => ({
            taskId: event.taskId ?? null,
            summary: event.summary,
            sourceKind: event.kind,
            timestamp: event.timestamp,
            providerId: event.providerId ?? null,
        }));
    }
}
exports.RuntimeLedgerStore = RuntimeLedgerStore;
exports.runtimeLedgerStore = new RuntimeLedgerStore();
//# sourceMappingURL=runtimeLedgerStore.js.map