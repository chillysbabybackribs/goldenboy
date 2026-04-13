import type {
  CallbackResponse,
  OnBeforeRequestListenerDetails,
  OnCompletedListenerDetails,
  OnErrorOccurredListenerDetails,
  WebContents,
  Session,
} from 'electron';
import {
  BrowserConsoleEvent,
  BrowserConsoleLevel,
  BrowserNetworkEvent,
} from '../../shared/types/browserIntelligence';
import { generateId } from '../../shared/utils/ids';

const MAX_CONSOLE_EVENTS = 250;
const MAX_NETWORK_EVENTS = 500;

function toConsoleLevel(level: number | 'info' | 'warning' | 'error' | 'debug'): BrowserConsoleLevel {
  if (typeof level === 'string') {
    switch (level) {
      case 'warning': return 'warn';
      case 'info':
      case 'error':
      case 'debug':
        return level;
      default:
        return 'log';
    }
  }

  switch (level) {
    case 0: return 'info';
    case 1: return 'error';
    case 2: return 'warn';
    case 3: return 'info';
    case 4: return 'debug';
    default: return 'log';
  }
}

function trimRecent<T>(items: T[], max: number): T[] {
  return items.length > max ? items.slice(items.length - max) : items;
}

export class BrowserInstrumentation {
  private tabIdByWebContentsId = new Map<number, string>();
  private consoleEventsByTab = new Map<string, BrowserConsoleEvent[]>();
  private networkEventsByTab = new Map<string, BrowserNetworkEvent[]>();
  private requestMetadataById = new Map<string, {
    tabId: string;
    method: string;
    url: string;
    resourceType: string;
    startedAt: number;
    uploadSize?: number;
  }>();
  private requestIdsByTab = new Map<string, Set<string>>();
  private sessionAttached = false;
  private callbackReturn: CallbackResponse = { cancel: false };

  attachSession(sessionInstance: Session): void {
    if (this.sessionAttached) return;
    this.sessionAttached = true;

    sessionInstance.webRequest.onBeforeRequest((details: OnBeforeRequestListenerDetails, callback: (response: CallbackResponse) => void) => {
      const tabId = this.resolveTabId(details.webContentsId);
      if (!tabId) return callback({ cancel: false });
      const requestId = String(details.id);

      this.requestMetadataById.set(requestId, {
        tabId,
        method: details.method || 'GET',
        url: details.url || '',
        resourceType: details.resourceType || 'unknown',
        startedAt: Date.now(),
        uploadSize: Array.isArray(details.uploadData) ? details.uploadData.length : undefined,
      });
      const byTab = this.requestIdsByTab.get(tabId) || new Set<string>();
      byTab.add(requestId);
      this.requestIdsByTab.set(tabId, byTab);
      callback(this.callbackReturn);
    });

    sessionInstance.webRequest.onCompleted((details: OnCompletedListenerDetails) => {
      const tabId = this.resolveTabId(details.webContentsId);
      const requestId = this.requestKeyFromDetails(details);
      const requestMeta = requestId ? this.requestMetadataById.get(requestId) : undefined;
      const responseStats = details as OnCompletedListenerDetails & {
        responseSize?: number;
        encodedDataLength?: number;
      };
      const timingMs = requestMeta ? Date.now() - requestMeta.startedAt : undefined;
      if (requestId) this.requestMetadataById.delete(requestId);
      if (requestMeta && requestId && requestMeta.tabId) {
        const byTab = this.requestIdsByTab.get(requestMeta.tabId);
        if (byTab) {
          byTab.delete(requestId);
          if (byTab.size === 0) this.requestIdsByTab.delete(requestMeta.tabId);
        }
      }
      const effectiveTabId = requestMeta?.tabId || tabId;
      if (!effectiveTabId) return;

      this.pushNetworkEvent(effectiveTabId, {
        id: generateId('net'),
        tabId: effectiveTabId,
        method: requestMeta?.method || details.method || 'GET',
        url: requestMeta?.url || details.url || '',
        resourceType: requestMeta?.resourceType || details.resourceType || 'unknown',
        statusCode: typeof details.statusCode === 'number' ? details.statusCode : null,
        status: 'completed',
        timestamp: Date.now(),
        durationMs: timingMs,
        startTimestamp: requestMeta?.startedAt,
        endTimestamp: Date.now(),
        fromCache: responseStats.fromCache === true,
        error: typeof details.error === 'string' && details.error ? details.error : undefined,
        responseSize: typeof responseStats.responseSize === 'number' ? responseStats.responseSize : undefined,
        encodedDataLength: typeof responseStats.encodedDataLength === 'number' ? responseStats.encodedDataLength : undefined,
      });
    });

    sessionInstance.webRequest.onErrorOccurred((details: OnErrorOccurredListenerDetails) => {
      const tabId = this.resolveTabId(details.webContentsId);
      const requestId = this.requestKeyFromDetails(details);
      const requestMeta = requestId ? this.requestMetadataById.get(requestId) : undefined;
      const timingMs = requestMeta ? Date.now() - requestMeta.startedAt : undefined;
      if (requestMeta && requestId) {
        this.requestMetadataById.delete(requestId);
        const byTab = this.requestIdsByTab.get(requestMeta.tabId);
        if (byTab) {
          byTab.delete(requestId);
          if (byTab.size === 0) this.requestIdsByTab.delete(requestMeta.tabId);
        }
      }

      const effectiveTabId = requestMeta?.tabId || tabId;
      if (!effectiveTabId) return;

      this.pushNetworkEvent(effectiveTabId, {
        id: generateId('net'),
        tabId: effectiveTabId,
        method: requestMeta?.method || details.method || 'GET',
        url: requestMeta?.url || details.url || '',
        resourceType: requestMeta?.resourceType || details.resourceType || 'unknown',
        statusCode: null,
        status: 'failed',
        timestamp: Date.now(),
        durationMs: timingMs,
        startTimestamp: requestMeta?.startedAt,
        endTimestamp: Date.now(),
        error: details.error || 'Request failed',
      });
    });
  }

  attachTab(tabId: string, webContents: WebContents): void {
    this.tabIdByWebContentsId.set(webContents.id, tabId);
    webContents.on('console-message', (_event, level, message, lineNumber, sourceId) => {
      this.pushConsoleEvent(tabId, {
        id: generateId('console'),
        tabId,
        level: toConsoleLevel(level),
        message,
        sourceId: sourceId,
        lineNumber,
        timestamp: Date.now(),
      });
    });
  }

  detachTab(tabId: string, webContentsId: number): void {
    const known = this.tabIdByWebContentsId.get(webContentsId);
    if (known === tabId) this.tabIdByWebContentsId.delete(webContentsId);
    this.consoleEventsByTab.delete(tabId);
    this.networkEventsByTab.delete(tabId);
    const inFlight = this.requestIdsByTab.get(tabId);
    if (inFlight) {
      for (const requestId of inFlight) {
        this.requestMetadataById.delete(requestId);
      }
      this.requestIdsByTab.delete(tabId);
    }
  }

  getConsoleEvents(tabId?: string, since?: number): BrowserConsoleEvent[] {
    const events = tabId
      ? (this.consoleEventsByTab.get(tabId) || [])
      : Array.from(this.consoleEventsByTab.values()).flat();
    return typeof since === 'number' ? events.filter(e => e.timestamp >= since) : events;
  }

  getNetworkEvents(tabId?: string, since?: number): BrowserNetworkEvent[] {
    const events = tabId
      ? (this.networkEventsByTab.get(tabId) || [])
      : Array.from(this.networkEventsByTab.values()).flat();
    return typeof since === 'number' ? events.filter(e => e.timestamp >= since) : events;
  }

  private pushConsoleEvent(tabId: string, event: BrowserConsoleEvent): void {
    const current = this.consoleEventsByTab.get(tabId) || [];
    this.consoleEventsByTab.set(tabId, trimRecent([...current, event], MAX_CONSOLE_EVENTS));
  }

  private pushNetworkEvent(tabId: string, event: BrowserNetworkEvent): void {
    const current = this.networkEventsByTab.get(tabId) || [];
    this.networkEventsByTab.set(tabId, trimRecent([...current, event], MAX_NETWORK_EVENTS));
  }

  private requestKeyFromDetails(details: { id: number }): string | null {
    const requestId = details.id;
    return requestId == null ? null : String(requestId);
  }

  private resolveTabId(webContentsId?: number): string | undefined {
    return webContentsId == null ? undefined : this.tabIdByWebContentsId.get(webContentsId);
  }
}
