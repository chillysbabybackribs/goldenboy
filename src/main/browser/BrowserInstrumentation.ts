import type { WebContents, Session } from 'electron';
import {
  BrowserConsoleEvent,
  BrowserConsoleLevel,
  BrowserNetworkEvent,
} from '../../shared/types/browserIntelligence';
import { generateId } from '../../shared/utils/ids';

const MAX_CONSOLE_EVENTS = 250;
const MAX_NETWORK_EVENTS = 500;

function toConsoleLevel(level: number): BrowserConsoleLevel {
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
  private sessionAttached = false;

  attachSession(sessionInstance: Session): void {
    if (this.sessionAttached) return;
    this.sessionAttached = true;

    sessionInstance.webRequest.onCompleted((details: any) => {
      const tabId = this.tabIdByWebContentsId.get(details.webContentsId);
      if (!tabId) return;
      this.pushNetworkEvent(tabId, {
        id: generateId('net'),
        tabId,
        method: details.method || 'GET',
        url: details.url || '',
        resourceType: details.resourceType || 'unknown',
        statusCode: typeof details.statusCode === 'number' ? details.statusCode : null,
        status: 'completed',
        timestamp: Date.now(),
      });
    });

    sessionInstance.webRequest.onErrorOccurred((details: any) => {
      const tabId = this.tabIdByWebContentsId.get(details.webContentsId);
      if (!tabId) return;
      this.pushNetworkEvent(tabId, {
        id: generateId('net'),
        tabId,
        method: details.method || 'GET',
        url: details.url || '',
        resourceType: details.resourceType || 'unknown',
        statusCode: null,
        status: 'failed',
        timestamp: Date.now(),
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
        sourceId,
        lineNumber,
        timestamp: Date.now(),
      });
    });
  }

  detachTab(tabId: string, webContentsId: number): void {
    const known = this.tabIdByWebContentsId.get(webContentsId);
    if (known === tabId) this.tabIdByWebContentsId.delete(webContentsId);
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
}
