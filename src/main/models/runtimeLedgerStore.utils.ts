import { AppState } from '../../shared/types/appState';
import type {
  ProviderId,
  RuntimeArtifactSnapshot,
  RuntimeBrowserTabSnapshot,
  RuntimeDecisionSnapshot,
  RuntimeEvidenceSnapshot,
  RuntimeLedgerEvent,
  RuntimeRunSnapshot,
  RuntimeTaskAwareness,
  TaskMemoryEntryKind,
} from '../../shared/types/model';

export const RUNTIME_LEDGER_FILE = 'runtime-ledger.json';
export const MAX_EVENTS = 5_000;
export const MAX_TASK_EVENTS = 40;
export const MAX_CONTEXT_CHARS = 2_400;
export const MAX_TASK_SWITCH_CONTEXT_CHARS = 1_600;

const CONTINUATION_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'then', 'than', 'have', 'what',
  'when', 'where', 'which', 'should', 'could', 'would', 'there', 'their', 'about', 'after',
  'before', 'while', 'your', 'you', 'just', 'task', 'work', 'continue', 'resume', 'switch',
  'same', 'previous', 'prior', 'last', 'chat', 'thread', 'conversation', 'model',
]);

export function getRuntimeLedgerPath(userDataDir: string): string {
  const path = require('path');
  return path.join(userDataDir, RUNTIME_LEDGER_FILE);
}

export function getDefaultRuntimeLedgerPath(): string {
  const electron = require('electron');
  const userDataDir = electron?.app?.getPath?.('userData')
    || process.env.V2_TEST_USER_DATA
    || process.cwd();
  return getRuntimeLedgerPath(userDataDir);
}

export function loadLedger(loadPath = getDefaultRuntimeLedgerPath()): RuntimeLedgerEvent[] {
  const fs = require('fs');
  try {
    if (!fs.existsSync(loadPath)) return [];
    const parsed = JSON.parse(fs.readFileSync(loadPath, 'utf-8')) as RuntimeLedgerEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLedger(events: RuntimeLedgerEvent[], savePath = getDefaultRuntimeLedgerPath()): void {
  const fs = require('fs');
  try {
    fs.writeFileSync(savePath, JSON.stringify(events, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to persist runtime ledger:', err);
  }
}

export function truncateText(text: string, maxChars: number, suffix = '...[truncated]'): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`;
}

export function compactText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function limitUnique(items: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const value = compactText(item);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

export function extractKeywords(text: string): string[] {
  return Array.from(new Set(
    text
      .toLowerCase()
      .match(/[a-z0-9]{4,}/g)
      ?.filter((token) => !CONTINUATION_STOP_WORDS.has(token)) || [],
  ));
}

export function formatTimestamp(timestamp: number | null): string | null {
  return timestamp ? new Date(timestamp).toISOString() : null;
}

export function looksLikeCrossTaskContinuation(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return /\b(previous|prior|earlier|last)\s+task\b/.test(lower)
    || /\b(switch|switched|handoff|pick up|continue|resume|carry on|same work)\b/.test(lower)
    || /\bfrom before\b/.test(lower)
    || /\bwhat were we\b/.test(lower);
}

export function mapTaskMemoryKind(kind: TaskMemoryEntryKind, metadata?: Record<string, unknown>): RuntimeLedgerEvent['kind'] {
  if (kind === 'user_prompt') return 'user_prompt';
  if (kind === 'model_result') return 'model_result';
  if (kind === 'browser_finding') return 'browser_finding';
  if (kind === 'handoff') return 'handoff';

  const category = typeof metadata?.category === 'string' ? metadata.category : '';
  if (category === 'claim') return 'claim';
  if (category === 'evidence') return 'evidence';
  if (category === 'critique') return 'critique';
  if (category === 'verification') return 'verification';
  return 'verification';
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function findRelevantPriorTaskAwareness(params: {
  currentTaskId: string;
  prompt: string;
  tasks: AppState['tasks'];
  getTaskAwareness: (taskId: string) => RuntimeTaskAwareness | null;
}): RuntimeTaskAwareness | null {
  const tasks = params.tasks
    .filter((task) => task.id !== params.currentTaskId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  if (tasks.length === 0) return null;

  const promptKeywords = extractKeywords(params.prompt);
  let best: { score: number; awareness: RuntimeTaskAwareness } | null = null;

  for (const [index, task] of tasks.entries()) {
    const awareness = params.getTaskAwareness(task.id);
    if (!awareness?.lastUpdatedAt) continue;

    const searchableText = [
      awareness.taskTitle,
      awareness.latestUserPrompt,
      awareness.latestModelResult,
      awareness.latestBrowserFinding,
      ...awareness.openIssues,
      ...awareness.evidence,
      ...awareness.decisions,
    ].filter(Boolean).join(' ').toLowerCase();
    const matches = promptKeywords.filter((keyword) => searchableText.includes(keyword)).length;
    const recencyScore = Math.max(0, 8 - index);
    const activeWorkBonus = awareness.taskStatus === 'running' ? 3 : 0;
    const score = (matches * 10) + recencyScore + activeWorkBonus;

    if (!best || score > best.score) {
      best = { score, awareness };
    }
  }

  if (!best) return null;
  if (best.score <= 0 && !looksLikeCrossTaskContinuation(params.prompt)) return null;
  return best.awareness;
}

export function deriveCurrentRunSnapshot(taskEvents: RuntimeLedgerEvent[]): RuntimeRunSnapshot | null {
  const runs = new Map<string, RuntimeRunSnapshot>();
  for (const event of taskEvents) {
    const runId = asString(event.runId);
    if (!runId) continue;
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
    if (!existing.providerId && event.providerId) existing.providerId = event.providerId;
    if (event.kind === 'task_status') {
      const status = asString(event.metadata?.status) as RuntimeRunSnapshot['status'];
      existing.status = status ?? existing.status;
      if (status === 'running') existing.startedAt = event.timestamp;
      if (status === 'completed' || status === 'failed') existing.completedAt = event.timestamp;
    }
    if (event.kind === 'tool') {
      existing.latestToolCallLabel = asString(event.metadata?.toolName) ?? existing.latestToolCallLabel;
      existing.latestToolStatus = asString(event.metadata?.status) as RuntimeRunSnapshot['latestToolStatus'] ?? existing.latestToolStatus;
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

export function deriveArtifactSnapshots(state: Pick<AppState, 'artifacts' | 'activeArtifactId'>, taskId: string, taskEvents: RuntimeLedgerEvent[]): RuntimeArtifactSnapshot[] {
  const artifacts = state.artifacts
    .filter((artifact) => artifact.linkedTaskIds.includes(taskId) || state.activeArtifactId === artifact.id);
  const latestArtifactEventById = new Map<string, RuntimeLedgerEvent>();

  for (const event of taskEvents) {
    if (event.kind !== 'artifact') continue;
    const artifactId = asString(event.metadata?.artifactId);
    if (!artifactId) continue;
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
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return b.lastUpdatedAt - a.lastUpdatedAt;
    });
}

export function deriveBrowserTabSnapshots(
  state: Pick<AppState, 'browserRuntime' | 'activeTaskId'>,
  taskEvents: RuntimeLedgerEvent[],
  taskId: string,
): RuntimeBrowserTabSnapshot[] {
  const runtimeTabs = state.browserRuntime.tabs;
  const latestBrowserEventById = new Map<string, RuntimeLedgerEvent>();

  for (const event of taskEvents) {
    if (event.kind !== 'browser') continue;
    const tabId = asString(event.metadata?.tabId);
    if (!tabId) continue;
    latestBrowserEventById.set(tabId, event);
  }

  const tabIds = new Set<string>([
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
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return b.lastUpdatedAt - a.lastUpdatedAt;
    });
}

export function deriveDecisionSnapshots(taskEvents: RuntimeLedgerEvent[]): RuntimeDecisionSnapshot[] {
  return taskEvents
    .filter((event): event is RuntimeLedgerEvent & { kind: 'verification' | 'handoff' } => event.kind === 'verification' || event.kind === 'handoff')
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

export function deriveEvidenceSnapshots(taskEvents: RuntimeLedgerEvent[]): RuntimeEvidenceSnapshot[] {
  return taskEvents
    .filter((event): event is RuntimeLedgerEvent & { kind: 'evidence' | 'browser_finding' } => event.kind === 'evidence' || event.kind === 'browser_finding')
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
