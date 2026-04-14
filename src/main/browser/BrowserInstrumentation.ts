import type {
  BeforeSendResponse,
  CallbackResponse,
  HeadersReceivedResponse,
  OnBeforeRedirectListenerDetails,
  OnBeforeRequestListenerDetails,
  OnBeforeSendHeadersListenerDetails,
  OnCompletedListenerDetails,
  OnErrorOccurredListenerDetails,
  OnHeadersReceivedListenerDetails,
  Session,
  WebContents,
} from 'electron';
import {
  BrowserConsoleEvent,
  BrowserConsoleLevel,
  BrowserNetworkActivitySummary,
  BrowserNetworkEvent,
} from '../../shared/types/browserIntelligence';
import { generateId } from '../../shared/utils/ids';
import type {
  BrowserNetworkInterceptionContext,
  BrowserNetworkInterceptionPolicy,
  BrowserOperationNetworkCapture,
  BrowserOperationNetworkScope,
} from './browserNetworkSupport';

const MAX_CONSOLE_EVENTS = 250;
const MAX_NETWORK_EVENTS = 500;
const MAX_OPERATION_EVENT_IDS = 8;
const MAX_OPERATION_URLS = 5;
const MAX_OPERATION_STATUS_CODES = 6;
const MAX_CAPTURED_HEADERS = 12;
const MAX_HEADER_VALUE_LENGTH = 160;
const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
]);

type RequestMetadata = {
  tabId: string;
  contextId: string;
  operationId: string | null;
  method: string;
  url: string;
  resourceType: string;
  startedAt: number;
  responseStartedAt?: number;
  uploadSize?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
};

type OperationScopeState = BrowserOperationNetworkScope & {
  startedAt: number;
  eventIds: string[];
  urls: string[];
  statusCodes: number[];
  requestCount: number;
  failedRequestCount: number;
};

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

function normalizeHeaderValue(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= MAX_HEADER_VALUE_LENGTH) return compact;
  return `${compact.slice(0, Math.max(0, MAX_HEADER_VALUE_LENGTH - 3))}...`;
}

function normalizeRequestHeaders(headers?: Record<string, string | string[]>): Record<string, string> | undefined {
  if (!headers) return undefined;
  const entries = Object.entries(headers)
    .slice(0, MAX_CAPTURED_HEADERS)
    .map(([key, value]) => {
      const normalizedValue = Array.isArray(value) ? value.join(', ') : value;
      const safeValue = SENSITIVE_HEADER_NAMES.has(key.toLowerCase())
        ? '[redacted]'
        : normalizeHeaderValue(String(normalizedValue ?? ''));
      return [key, safeValue] as const;
    })
    .filter(([, value]) => value.length > 0);

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeResponseHeaders(headers?: Record<string, string[]>): Record<string, string> | undefined {
  if (!headers) return undefined;
  const entries = Object.entries(headers)
    .slice(0, MAX_CAPTURED_HEADERS)
    .map(([key, value]) => {
      const normalizedValue = Array.isArray(value) ? value.join(', ') : String(value ?? '');
      const safeValue = SENSITIVE_HEADER_NAMES.has(key.toLowerCase())
        ? '[redacted]'
        : normalizeHeaderValue(normalizedValue);
      return [key, safeValue] as const;
    })
    .filter(([, value]) => value.length > 0);

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeResponseHeadersForCallback(headers?: Record<string, string[]>): Record<string, string[]> | undefined {
  if (!headers) return undefined;
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.map(item => String(item)) : [String(value)],
    ]),
  );
}

function pushUnique(target: string[], value: string, max: number): void {
  if (!value || target.includes(value)) return;
  target.push(value);
  if (target.length > max) target.splice(0, target.length - max);
}

function calculateUploadSize(uploadData: OnBeforeRequestListenerDetails['uploadData']): number | undefined {
  if (!Array.isArray(uploadData) || uploadData.length === 0) return undefined;
  let size = 0;
  let hasData = false;
  for (const item of uploadData) {
    if (item.bytes) {
      size += item.bytes.byteLength;
      hasData = true;
    } else if (typeof item.file === 'string' && item.file) {
      hasData = true;
    }
  }
  return hasData ? size : undefined;
}

function summarizeScope(scope: OperationScopeState): BrowserOperationNetworkCapture {
  const summary: BrowserNetworkActivitySummary | null = scope.requestCount > 0
    ? {
      requestCount: scope.requestCount,
      failedRequestCount: scope.failedRequestCount,
      urls: [...scope.urls],
      statusCodes: [...scope.statusCodes],
    }
    : null;

  return {
    eventIds: [...scope.eventIds],
    summary,
  };
}

export class BrowserInstrumentation {
  private tabIdByWebContentsId = new Map<number, string>();
  private consoleEventsByTab = new Map<string, BrowserConsoleEvent[]>();
  private networkEventsByTab = new Map<string, BrowserNetworkEvent[]>();
  private requestMetadataById = new Map<string, RequestMetadata>();
  private requestIdsByTab = new Map<string, Set<string>>();
  private operationScopesById = new Map<string, OperationScopeState>();
  private interceptionPolicies = new Map<string, BrowserNetworkInterceptionPolicy>();
  private sessionAttached = false;
  private callbackReturn: CallbackResponse = { cancel: false };

  constructor(private readonly contextId: string) {}

  attachSession(sessionInstance: Session): void {
    if (this.sessionAttached) return;
    this.sessionAttached = true;

    sessionInstance.webRequest.onBeforeRequest((details: OnBeforeRequestListenerDetails, callback: (response: CallbackResponse) => void) => {
      const tabId = this.resolveTabId(details.webContentsId);
      if (!tabId) return callback({ cancel: false });
      const requestId = this.requestKeyFromDetails(details);
      if (!requestId) return callback({ cancel: false });
      const operationId = this.resolveOperationId(tabId);
      const meta: RequestMetadata = {
        tabId,
        contextId: this.contextId,
        operationId,
        method: details.method || 'GET',
        url: details.url || '',
        resourceType: details.resourceType || 'unknown',
        startedAt: Date.now(),
        uploadSize: calculateUploadSize(details.uploadData),
      };

      this.requestMetadataById.set(requestId, meta);
      const byTab = this.requestIdsByTab.get(tabId) || new Set<string>();
      byTab.add(requestId);
      this.requestIdsByTab.set(tabId, byTab);

      const interception = this.applyBeforeRequestPolicies({
        contextId: this.contextId,
        operationId,
        tabId,
        method: meta.method,
        url: meta.url,
        resourceType: meta.resourceType,
      });
      callback(interception || this.callbackReturn);
    });

    sessionInstance.webRequest.onBeforeSendHeaders((details: OnBeforeSendHeadersListenerDetails, callback: (response: BeforeSendResponse) => void) => {
      const requestId = this.requestKeyFromDetails(details);
      const requestMeta = requestId ? this.requestMetadataById.get(requestId) : undefined;
      const tabId = requestMeta?.tabId || this.resolveTabId(details.webContentsId) || null;
      const operationId = requestMeta?.operationId || (tabId ? this.resolveOperationId(tabId) : null);
      const requestHeaders = normalizeRequestHeaders(details.requestHeaders as Record<string, string | string[]>);
      if (requestMeta) {
        requestMeta.requestHeaders = requestHeaders;
      }

      const interception = this.applyBeforeSendHeadersPolicies({
        contextId: this.contextId,
        operationId,
        tabId,
        method: requestMeta?.method || details.method || 'GET',
        url: requestMeta?.url || details.url || '',
        resourceType: requestMeta?.resourceType || details.resourceType || 'unknown',
        requestHeaders,
      }, details.requestHeaders as Record<string, string | string[]>);

      callback(interception || { cancel: false, requestHeaders: details.requestHeaders });
    });

    sessionInstance.webRequest.onHeadersReceived((details: OnHeadersReceivedListenerDetails, callback: (response: HeadersReceivedResponse) => void) => {
      const requestId = this.requestKeyFromDetails(details);
      const requestMeta = requestId ? this.requestMetadataById.get(requestId) : undefined;
      const tabId = requestMeta?.tabId || this.resolveTabId(details.webContentsId) || null;
      const operationId = requestMeta?.operationId || (tabId ? this.resolveOperationId(tabId) : null);
      const responseHeaders = normalizeResponseHeaders(details.responseHeaders);
      if (requestMeta) {
        requestMeta.responseStartedAt = Date.now();
        requestMeta.responseHeaders = responseHeaders;
      }

      const interception = this.applyHeadersReceivedPolicies({
        contextId: this.contextId,
        operationId,
        tabId,
        method: requestMeta?.method || details.method || 'GET',
        url: requestMeta?.url || details.url || '',
        resourceType: requestMeta?.resourceType || details.resourceType || 'unknown',
        statusCode: typeof details.statusCode === 'number' ? details.statusCode : null,
        responseHeaders: details.responseHeaders,
      });

      callback(interception || {});
    });

    sessionInstance.webRequest.onBeforeRedirect((details: OnBeforeRedirectListenerDetails) => {
      const requestId = this.requestKeyFromDetails(details);
      if (!requestId) return;
      const requestMeta = this.requestMetadataById.get(requestId);
      if (!requestMeta) return;
      requestMeta.responseStartedAt = Date.now();
      requestMeta.responseHeaders = normalizeResponseHeaders(details.responseHeaders);
    });

    sessionInstance.webRequest.onCompleted((details: OnCompletedListenerDetails) => {
      const tabId = this.resolveTabId(details.webContentsId);
      const requestId = this.requestKeyFromDetails(details);
      const requestMeta = requestId ? this.requestMetadataById.get(requestId) : undefined;
      const responseStats = details as OnCompletedListenerDetails & {
        responseSize?: number;
        encodedDataLength?: number;
      };
      const completedAt = Date.now();
      const timingMs = requestMeta ? completedAt - requestMeta.startedAt : undefined;
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

      const event: BrowserNetworkEvent = {
        id: generateId('net'),
        requestId: requestId || generateId('req'),
        contextId: requestMeta?.contextId || this.contextId,
        operationId: requestMeta?.operationId ?? null,
        tabId: effectiveTabId,
        method: requestMeta?.method || details.method || 'GET',
        url: requestMeta?.url || details.url || '',
        resourceType: requestMeta?.resourceType || details.resourceType || 'unknown',
        statusCode: typeof details.statusCode === 'number' ? details.statusCode : null,
        status: 'completed',
        timestamp: completedAt,
        durationMs: timingMs,
        startTimestamp: requestMeta?.startedAt,
        responseTimestamp: requestMeta?.responseStartedAt,
        endTimestamp: completedAt,
        fromCache: responseStats.fromCache === true,
        error: typeof details.error === 'string' && details.error ? details.error : undefined,
        responseSize: typeof responseStats.responseSize === 'number' ? responseStats.responseSize : undefined,
        encodedDataLength: typeof responseStats.encodedDataLength === 'number' ? responseStats.encodedDataLength : undefined,
        requestHeaders: requestMeta?.requestHeaders,
        responseHeaders: requestMeta?.responseHeaders,
        requestBodySize: requestMeta?.uploadSize,
      };

      this.pushNetworkEvent(effectiveTabId, event);
      this.recordOperationEvent(event);
    });

    sessionInstance.webRequest.onErrorOccurred((details: OnErrorOccurredListenerDetails) => {
      const tabId = this.resolveTabId(details.webContentsId);
      const requestId = this.requestKeyFromDetails(details);
      const requestMeta = requestId ? this.requestMetadataById.get(requestId) : undefined;
      const completedAt = Date.now();
      const timingMs = requestMeta ? completedAt - requestMeta.startedAt : undefined;
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

      const event: BrowserNetworkEvent = {
        id: generateId('net'),
        requestId: requestId || generateId('req'),
        contextId: requestMeta?.contextId || this.contextId,
        operationId: requestMeta?.operationId ?? null,
        tabId: effectiveTabId,
        method: requestMeta?.method || details.method || 'GET',
        url: requestMeta?.url || details.url || '',
        resourceType: requestMeta?.resourceType || details.resourceType || 'unknown',
        statusCode: null,
        status: 'failed',
        timestamp: completedAt,
        durationMs: timingMs,
        startTimestamp: requestMeta?.startedAt,
        responseTimestamp: requestMeta?.responseStartedAt,
        endTimestamp: completedAt,
        requestHeaders: requestMeta?.requestHeaders,
        responseHeaders: requestMeta?.responseHeaders,
        requestBodySize: requestMeta?.uploadSize,
        error: details.error || 'Request failed',
      };

      this.pushNetworkEvent(effectiveTabId, event);
      this.recordOperationEvent(event);
    });
  }

  registerNetworkInterceptionPolicy(policy: BrowserNetworkInterceptionPolicy): void {
    this.interceptionPolicies.set(policy.id, policy);
  }

  beginOperationNetworkScope(scope: BrowserOperationNetworkScope): void {
    this.operationScopesById.set(scope.operationId, {
      ...scope,
      startedAt: Date.now(),
      eventIds: [],
      urls: [],
      statusCodes: [],
      requestCount: 0,
      failedRequestCount: 0,
    });
  }

  completeOperationNetworkScope(operationId: string): BrowserOperationNetworkCapture | null {
    const scope = this.operationScopesById.get(operationId);
    if (!scope) return null;
    const capture = summarizeScope(scope);
    this.operationScopesById.delete(operationId);
    return capture;
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

  private resolveOperationId(tabId: string): string | null {
    const candidates = Array.from(this.operationScopesById.values())
      .filter(scope => scope.contextId === this.contextId);
    const tabScoped = candidates
      .filter(scope => scope.tabId === tabId)
      .sort((a, b) => b.startedAt - a.startedAt)[0];
    if (tabScoped) return tabScoped.operationId;

    const mostRecent = candidates
      .sort((a, b) => b.startedAt - a.startedAt)[0];
    return mostRecent?.operationId ?? null;
  }

  private recordOperationEvent(event: BrowserNetworkEvent): void {
    if (!event.operationId) return;
    const scope = this.operationScopesById.get(event.operationId);
    if (!scope) return;
    scope.requestCount += 1;
    if (event.status === 'failed' || (typeof event.statusCode === 'number' && event.statusCode >= 400)) {
      scope.failedRequestCount += 1;
    }
    pushUnique(scope.eventIds, event.id, MAX_OPERATION_EVENT_IDS);
    pushUnique(scope.urls, event.url, MAX_OPERATION_URLS);
    if (typeof event.statusCode === 'number') {
      if (!scope.statusCodes.includes(event.statusCode)) {
        scope.statusCodes.push(event.statusCode);
        if (scope.statusCodes.length > MAX_OPERATION_STATUS_CODES) {
          scope.statusCodes.splice(0, scope.statusCodes.length - MAX_OPERATION_STATUS_CODES);
        }
      }
    }
  }

  private buildInterceptionContext(input: BrowserNetworkInterceptionContext): BrowserNetworkInterceptionContext {
    return { ...input };
  }

  private applyBeforeRequestPolicies(
    input: BrowserNetworkInterceptionContext,
  ): CallbackResponse | null {
    let response: CallbackResponse | undefined;
    for (const policy of this.interceptionPolicies.values()) {
      const context = this.buildInterceptionContext(input);
      if (policy.matches && !policy.matches(context)) continue;
      const result = policy.onBeforeRequest?.(context);
      if (!result) continue;
      response = {
        cancel: result.cancel ?? response?.cancel ?? false,
        redirectURL: result.redirectURL ?? response?.redirectURL,
      };
    }
    return response || null;
  }

  private applyBeforeSendHeadersPolicies(
    input: BrowserNetworkInterceptionContext,
    requestHeaders: Record<string, string | string[]>,
  ): BeforeSendResponse | null {
    let nextHeaders = { ...requestHeaders };
    let changed = false;
    for (const policy of this.interceptionPolicies.values()) {
      const context = this.buildInterceptionContext(input);
      if (policy.matches && !policy.matches(context)) continue;
      const result = policy.onBeforeSendHeaders?.(context);
      if (!result?.requestHeaders) continue;
      nextHeaders = { ...nextHeaders, ...result.requestHeaders };
      changed = true;
    }

    return changed ? { cancel: false, requestHeaders: nextHeaders } : null;
  }

  private applyHeadersReceivedPolicies(
    input: BrowserNetworkInterceptionContext,
  ): HeadersReceivedResponse | null {
    let nextHeaders = input.responseHeaders ? { ...input.responseHeaders } : undefined;
    let changed = false;
    for (const policy of this.interceptionPolicies.values()) {
      const context = this.buildInterceptionContext(input);
      if (policy.matches && !policy.matches(context)) continue;
      const result = policy.onHeadersReceived?.(context);
      if (!result?.responseHeaders) continue;
      nextHeaders = {
        ...(nextHeaders || {}),
        ...result.responseHeaders,
      };
      changed = true;
    }

    if (!changed) return null;
    return { responseHeaders: normalizeResponseHeadersForCallback(nextHeaders) };
  }
}
