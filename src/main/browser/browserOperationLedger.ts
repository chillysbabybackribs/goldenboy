import path from 'node:path';
import type { BrowserState, BrowserJavaScriptDialog } from '../../shared/types/browser';
import type {
  BrowserOperationExecutionContext,
  BrowserOperationKind,
  BrowserOperationLedgerContext,
  BrowserOperationLedgerEntry,
  BrowserOperationLedgerInputSummary,
  BrowserOperationLedgerReferences,
  BrowserOperationLedgerSource,
  BrowserOperationLedgerSummaryValue,
} from '../../shared/types/browserOperationLedger';
import { generateId } from '../../shared/utils/ids';
import type { BrowserOperationNetworkCapture } from './browserNetworkSupport';

const DEFAULT_MAX_LEDGER_ENTRIES = 250;
const MAX_STRING_VALUE_LENGTH = 160;
const MAX_TEXT_PREVIEW_LENGTH = 80;
const MAX_TEXT_SUMMARY_LENGTH = 240;
const MAX_ARRAY_VALUES = 8;
const MAX_REFERENCE_VALUES = 5;

type BrowserOperationResultLike = {
  summary: string;
  data: Record<string, unknown>;
};

type BrowserOperationLedgerStartInput = {
  kind: BrowserOperationKind;
  payload: Record<string, unknown>;
  contextId: string;
  context?: BrowserOperationExecutionContext;
  state: BrowserState;
};

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, maxLength: number): string {
  const compact = compactWhitespace(value);
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 3))}...`;
}

function summarizeValue(value: unknown): BrowserOperationLedgerSummaryValue | undefined {
  if (value === null) return null;
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return truncate(value, MAX_STRING_VALUE_LENGTH);
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_VALUES)
      .filter((item): item is string | number => typeof item === 'string' || typeof item === 'number')
      .map((item) => (typeof item === 'string' ? truncate(item, 60) : item));
    return items.length > 0 ? items : undefined;
  }
  return undefined;
}

function buildSummaryText(fields: Record<string, BrowserOperationLedgerSummaryValue>): string {
  const parts = Object.entries(fields).map(([key, value]) => {
    if (Array.isArray(value)) {
      return `${key}=[${value.join(', ')}]`;
    }
    return `${key}=${String(value)}`;
  });
  if (parts.length === 0) return 'No payload';
  return truncate(parts.join(', '), MAX_TEXT_SUMMARY_LENGTH);
}

function summarizePayload(
  kind: BrowserOperationKind,
  payload: Record<string, unknown>,
): BrowserOperationLedgerInputSummary {
  const fields: Record<string, BrowserOperationLedgerSummaryValue> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (key === 'text' && typeof value === 'string') {
      fields.textLength = value.length;
      const preview = truncate(value, MAX_TEXT_PREVIEW_LENGTH);
      if (preview) fields.textPreview = preview;
      continue;
    }

    if (key === 'filePath' && typeof value === 'string') {
      fields.fileName = path.basename(value);
      continue;
    }

    const summarized = summarizeValue(value);
    if (summarized !== undefined) fields[key] = summarized;
  }

  if (kind === 'browser.create-tab' && !('url' in fields)) {
    fields.mode = 'blank-tab';
  }

  return {
    text: buildSummaryText(fields),
    fields,
  };
}

function createEmptyReferences(): BrowserOperationLedgerReferences {
  return {
    snapshotIds: [],
    downloadIds: [],
    dialogIds: [],
    consoleEventIds: [],
    networkEventIds: [],
  };
}

function pushUnique(target: string[], value: unknown): void {
  if (typeof value !== 'string' || value.trim() === '' || target.includes(value)) return;
  target.push(value);
}

function pushMany(target: string[], values: unknown): void {
  if (!Array.isArray(values)) return;
  for (const value of values.slice(0, MAX_REFERENCE_VALUES)) {
    pushUnique(target, value);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function extractDownloadIds(downloads: unknown): string[] {
  if (!Array.isArray(downloads)) return [];
  const ids: string[] = [];
  for (const item of downloads.slice(0, MAX_REFERENCE_VALUES)) {
    pushUnique(ids, asRecord(item)?.id);
  }
  return ids;
}

function extractRelatedReferences(result: BrowserOperationResultLike): BrowserOperationLedgerReferences {
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
    ? (result.data.dialogs as BrowserJavaScriptDialog[]).map(item => item.id)
    : [];
  pushMany(related.dialogIds, dialogs);

  return related;
}

function mergeReferences(
  current: BrowserOperationLedgerReferences,
  next?: Partial<BrowserOperationLedgerReferences>,
): BrowserOperationLedgerReferences {
  if (!next) return current;
  const merged = createEmptyReferences();
  for (const key of Object.keys(merged) as Array<keyof BrowserOperationLedgerReferences>) {
    const values = [...current[key]];
    const additions = next[key] || [];
    for (const value of additions) pushUnique(values, value);
    merged[key] = values.slice(0, MAX_REFERENCE_VALUES);
  }
  return merged;
}

function resolveSource(source?: BrowserOperationLedgerSource | null): BrowserOperationLedgerSource {
  return source || 'other';
}

function resolveContext(
  state: BrowserState,
  payload: Record<string, unknown>,
  context?: BrowserOperationExecutionContext,
): BrowserOperationLedgerContext {
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

function cloneEntry(entry: BrowserOperationLedgerEntry): BrowserOperationLedgerEntry {
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
  };
}

export class BrowserOperationLedger {
  private entries: BrowserOperationLedgerEntry[] = [];

  constructor(private readonly maxEntries: number = DEFAULT_MAX_LEDGER_ENTRIES) {}

  start(input: BrowserOperationLedgerStartInput): BrowserOperationLedgerEntry {
    const now = Date.now();
    const entry: BrowserOperationLedgerEntry = {
      operationId: generateId('bop'),
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
    };

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(this.entries.length - this.maxEntries);
    }

    return cloneEntry(entry);
  }

  complete(
    operationId: string,
    result: BrowserOperationResultLike,
    networkCapture?: BrowserOperationNetworkCapture,
  ): void {
    this.update(operationId, (entry) => ({
      ...entry,
      status: 'completed',
      resultSummary: truncate(result.summary, MAX_TEXT_SUMMARY_LENGTH),
      errorSummary: null,
      completedAt: Date.now(),
      durationMs: Date.now() - entry.timestamp,
      related: mergeReferences(
        mergeReferences(entry.related, extractRelatedReferences(result)),
        networkCapture ? { networkEventIds: networkCapture.eventIds } : undefined,
      ),
      network: networkCapture?.summary || entry.network,
    }));
  }

  fail(
    operationId: string,
    error: unknown,
    networkCapture?: BrowserOperationNetworkCapture,
  ): void {
    this.update(operationId, (entry) => ({
      ...entry,
      status: 'failed',
      errorSummary: truncate(error instanceof Error ? error.message : String(error), MAX_TEXT_SUMMARY_LENGTH),
      completedAt: Date.now(),
      durationMs: Date.now() - entry.timestamp,
      related: mergeReferences(
        entry.related,
        networkCapture ? { networkEventIds: networkCapture.eventIds } : undefined,
      ),
      network: networkCapture?.summary || entry.network,
    }));
  }

  listRecent(limit: number = 50): BrowserOperationLedgerEntry[] {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
    return this.entries.slice(-safeLimit).map(cloneEntry);
  }

  clear(): void {
    this.entries = [];
  }

  private update(
    operationId: string,
    updater: (entry: BrowserOperationLedgerEntry) => BrowserOperationLedgerEntry,
  ): void {
    this.entries = this.entries.map((entry) => (entry.operationId === operationId ? updater(entry) : entry));
  }
}

export const browserOperationLedger = new BrowserOperationLedger();

export function getRecentBrowserOperationLedgerEntries(limit?: number): BrowserOperationLedgerEntry[] {
  return browserOperationLedger.listRecent(limit);
}

export function clearBrowserOperationLedger(): void {
  browserOperationLedger.clear();
}
