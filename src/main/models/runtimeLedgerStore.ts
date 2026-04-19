import { generateId } from '../../shared/utils/ids';
import { appStateStore } from '../state/appStateStore';
import { eventBus } from '../events/eventBus';
import { AppEventType } from '../../shared/types/events';
import type {
  ProviderId,
  RuntimeLedgerEvent,
  RuntimeTaskEntitySnapshot,
  RuntimeTaskAwareness,
  TaskMemoryEntry,
} from '../../shared/types/model';
import {
  asBoolean,
  asString,
  compactText,
  deriveArtifactSnapshots,
  deriveBrowserTabSnapshots,
  deriveCurrentRunSnapshot,
  deriveDecisionSnapshots,
  deriveEvidenceSnapshots,
  findRelevantPriorTaskAwareness,
  formatTimestamp,
  limitUnique,
  loadLedger,
  looksLikeCrossTaskContinuation,
  mapTaskMemoryKind,
  MAX_CONTEXT_CHARS,
  MAX_EVENTS,
  MAX_TASK_EVENTS,
  MAX_TASK_SWITCH_CONTEXT_CHARS,
  saveLedger,
  truncateText,
} from './runtimeLedgerStore.utils';

export class RuntimeLedgerStore {
  private events: RuntimeLedgerEvent[] = loadLedger();

  constructor() {
    this.attachBrowserEventListeners();
  }

  listRecent(taskId?: string, limit = 20): RuntimeLedgerEvent[] {
    const filtered = taskId
      ? this.events.filter((event) => event.taskId === taskId)
      : this.events;
    return filtered.slice(-Math.max(1, limit)).map((event) => ({ ...event }));
  }

  append(event: Omit<RuntimeLedgerEvent, 'id'>): RuntimeLedgerEvent {
    const record: RuntimeLedgerEvent = {
      ...event,
      id: generateId('ledger'),
    };
    this.events = [...this.events, record].slice(-MAX_EVENTS);
    saveLedger(this.events);
    return { ...record };
  }

  recordTaskStatus(input: {
    taskId: string;
    providerId?: ProviderId;
    runId?: string;
    status: 'running' | 'completed' | 'failed';
    summary: string;
    metadata?: Record<string, unknown>;
  }): RuntimeLedgerEvent {
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

  recordProviderSwitch(taskId: string, fromProviderId: ProviderId, toProviderId: ProviderId): RuntimeLedgerEvent {
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

  recordArtifactEvent(input: {
    taskId?: string | null;
    providerId?: ProviderId;
    summary: string;
    metadata?: Record<string, unknown>;
  }): RuntimeLedgerEvent {
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

  recordToolEvent(input: {
    taskId?: string | null;
    providerId?: ProviderId;
    runId?: string;
    summary: string;
    metadata?: Record<string, unknown>;
  }): RuntimeLedgerEvent {
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

  recordBrowserEvent(input: {
    taskId?: string | null;
    summary: string;
    metadata?: Record<string, unknown>;
  }): RuntimeLedgerEvent {
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

  recordSubagentEvent(input: {
    taskId?: string | null;
    providerId?: ProviderId;
    runId?: string;
    summary: string;
    metadata?: Record<string, unknown>;
  }): RuntimeLedgerEvent {
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

  recordTaskMemoryEntry(entry: TaskMemoryEntry): RuntimeLedgerEvent {
    return this.append({
      taskId: entry.taskId,
      runId: typeof entry.metadata?.runId === 'string' ? entry.metadata.runId : undefined,
      providerId: entry.providerId,
      timestamp: entry.createdAt,
      kind: mapTaskMemoryKind(entry.kind, entry.metadata),
      scope: 'task',
      source: 'task-memory',
      summary: truncateText(compactText(entry.text), 500),
      metadata: entry.metadata,
    });
  }

  getTaskAwareness(taskId: string): RuntimeTaskAwareness {
    const recentEvents = this.events.filter((event) => event.taskId === taskId).slice(-MAX_TASK_EVENTS);
    const latestOf = (kind: RuntimeLedgerEvent['kind']) => [...recentEvents].reverse().find((event) => event.kind === kind) || null;
    const state = appStateStore.getState();
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

    const evidence = limitUnique(
      [...recentEvents]
        .reverse()
        .filter((event) => event.kind === 'evidence')
        .map((event) => event.summary),
      3,
    );
    const decisions = limitUnique(
      [...recentEvents]
        .reverse()
        .filter((event) => event.kind === 'verification' || event.kind === 'handoff')
        .map((event) => event.summary),
      3,
    );
    const openIssues = limitUnique(
      [...recentEvents]
        .reverse()
        .filter((event) => event.kind === 'critique' || event.kind === 'subagent' || (event.kind === 'task_status' && event.metadata?.status === 'failed'))
        .map((event) => event.summary),
      4,
    );
    const latestSubagentById = new Map<string, RuntimeLedgerEvent>();
    for (const event of recentEvents) {
      if (event.kind !== 'subagent') continue;
      const subagentId = typeof event.metadata?.subagentId === 'string' ? event.metadata.subagentId : '';
      if (!subagentId) continue;
      latestSubagentById.set(subagentId, event);
    }
    const activeSubagentLabels = limitUnique(
      Array.from(latestSubagentById.values())
        .filter((event) => event.metadata?.status === 'running')
        .map((event) => event.summary),
      4,
    );

    const activeProviderId = (latestTaskStatus?.providerId || latestProviderSwitch?.providerId || latestModelResult?.providerId) ?? null;
    const entities = this.getTaskEntitySnapshot(taskId);

    return {
      taskId,
      taskTitle: task?.title ?? null,
      lastUpdatedAt: recentEvents.at(-1)?.timestamp ?? null,
      activeProviderId,
      taskStatus: task?.status ?? (typeof latestTaskStatus?.metadata?.status === 'string'
        ? latestTaskStatus.metadata.status as RuntimeTaskAwareness['taskStatus']
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

  getTaskEntitySnapshot(taskId: string): RuntimeTaskEntitySnapshot {
    const state = appStateStore.getState();
    const taskEvents = this.events.filter((event) => event.taskId === taskId);
    return {
      taskId,
      currentRun: deriveCurrentRunSnapshot(taskEvents),
      artifacts: deriveArtifactSnapshots(state, taskId, taskEvents),
      browserTabs: deriveBrowserTabSnapshots(
        {
          browserRuntime: state.browserRuntime,
          activeTaskId: state.activeTaskId,
        },
        taskEvents,
        taskId,
      ),
      decisions: deriveDecisionSnapshots(taskEvents),
      evidence: deriveEvidenceSnapshots(taskEvents),
    };
  }

  buildTaskSwitchContext(input: {
    taskId: string;
    prompt: string;
  }): string | null {
    const currentAwareness = this.getTaskAwareness(input.taskId);
    const currentEvents = currentAwareness.recentEvents.length;
    const shouldOfferPriorTaskContext = looksLikeCrossTaskContinuation(input.prompt)
      || currentEvents <= 3
      || (!currentAwareness.latestModelResult && !currentAwareness.latestBrowserFinding);
    if (!shouldOfferPriorTaskContext) return null;

    const state = appStateStore.getState();
    const priorAwareness = findRelevantPriorTaskAwareness({
      currentTaskId: input.taskId,
      prompt: input.prompt,
      tasks: state.tasks,
      getTaskAwareness: (taskId: string) => this.getTaskAwareness(taskId),
    });
    if (!priorAwareness) return null;

    const sections: string[] = [
      '## Prior Task Continuity',
      'The current task appears to be a continuation or handoff. Use the prior task state below when it helps resolve references like "that", "the previous work", or a recent task switch.',
    ];

    const title = priorAwareness.taskTitle || priorAwareness.taskId;
    const timestamp = formatTimestamp(priorAwareness.lastUpdatedAt);
    sections.push(
      '',
      `Prior task: ${title}${priorAwareness.taskStatus ? ` (${priorAwareness.taskStatus})` : ''}${timestamp ? ` • updated ${timestamp}` : ''}`,
    );
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
      if (priorAwareness.activeArtifactLabel) sections.push(`- Artifact: ${priorAwareness.activeArtifactLabel}`);
      if (priorAwareness.activeBrowserTabLabel) sections.push(`- Browser tab: ${priorAwareness.activeBrowserTabLabel}`);
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

    return truncateText(sections.join('\n'), MAX_TASK_SWITCH_CONTEXT_CHARS, '\n...[prior task context truncated]');
  }

  buildHydrationContext(input: {
    taskId: string;
    currentProviderId: ProviderId;
    providerSwitched?: boolean;
  }): string | null {
    const awareness = this.getTaskAwareness(input.taskId);
    const entities = this.getTaskEntitySnapshot(input.taskId);
    if (!awareness.lastUpdatedAt) return null;

    const sections: string[] = ['## Shared Runtime Ledger'];
    if (input.providerSwitched) {
      sections.push(
        `Provider continuity is shared at the app layer. Continue from the resolved task state below instead of restarting because the active model changed to ${input.currentProviderId}.`,
      );
    } else {
      sections.push('Use the shared app ledger below as the task continuity source of truth.');
    }

    if (awareness.latestUserPrompt) sections.push('', `Latest user request: ${awareness.latestUserPrompt}`);
    if (awareness.latestModelResult) sections.push(`Latest model result: ${awareness.latestModelResult}`);
    if (awareness.latestBrowserFinding) sections.push(`Latest browser finding: ${awareness.latestBrowserFinding}`);
    if (awareness.taskStatus || awareness.activeProviderId) {
      sections.push(
        '',
        `Task status: ${awareness.taskStatus || 'unknown'}${awareness.activeProviderId ? ` | Active provider: ${awareness.activeProviderId}` : ''}`,
      );
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
      if (awareness.activeArtifactLabel) sections.push(`- Active artifact: ${awareness.activeArtifactLabel}`);
      if (awareness.activeBrowserTabLabel) sections.push(`- Active browser tab: ${awareness.activeBrowserTabLabel}`);
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

    return truncateText(sections.join('\n'), MAX_CONTEXT_CHARS, '\n...[ledger context truncated]');
  }

  private attachBrowserEventListeners(): void {
    eventBus.on(AppEventType.BROWSER_TAB_CREATED, (event) => {
      this.recordBrowserEvent({
        taskId: appStateStore.getState().activeTaskId,
        summary: `Created browser tab ${event.payload.tab.navigation.title || event.payload.tab.navigation.url || event.payload.tab.id}`,
        metadata: { tabId: event.payload.tab.id, action: 'tab-created' },
      });
    });
    eventBus.on(AppEventType.BROWSER_TAB_ACTIVATED, (event) => {
      const tab = appStateStore.getState().browserRuntime.tabs.find((item) => item.id === event.payload.tabId) || null;
      this.recordBrowserEvent({
        taskId: appStateStore.getState().activeTaskId,
        summary: `Activated browser tab ${tab?.navigation.title || tab?.navigation.url || event.payload.tabId}`,
        metadata: { tabId: event.payload.tabId, action: 'tab-activated' },
      });
    });
    eventBus.on(AppEventType.BROWSER_TAB_CLOSED, (event) => {
      this.recordBrowserEvent({
        taskId: appStateStore.getState().activeTaskId,
        summary: `Closed browser tab ${event.payload.tabId}`,
        metadata: { tabId: event.payload.tabId, action: 'tab-closed' },
      });
    });
    eventBus.on(AppEventType.BROWSER_NAVIGATION_UPDATED, (event) => {
      const activeTaskId = appStateStore.getState().activeTaskId;
      const url = event.payload.navigation.url || '';
      const title = event.payload.navigation.title || '';
      if (!activeTaskId || (!url && !title)) return;
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

}

export const runtimeLedgerStore = new RuntimeLedgerStore();
