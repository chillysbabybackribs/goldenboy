"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserInstrumentation = void 0;
const ids_1 = require("../../shared/utils/ids");
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
function toConsoleLevel(level) {
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
function trimRecent(items, max) {
    return items.length > max ? items.slice(items.length - max) : items;
}
function normalizeHeaderValue(value) {
    const compact = value.replace(/\s+/g, ' ').trim();
    if (compact.length <= MAX_HEADER_VALUE_LENGTH)
        return compact;
    return `${compact.slice(0, Math.max(0, MAX_HEADER_VALUE_LENGTH - 3))}...`;
}
function normalizeRequestHeaders(headers) {
    if (!headers)
        return undefined;
    const entries = Object.entries(headers)
        .slice(0, MAX_CAPTURED_HEADERS)
        .map(([key, value]) => {
        const normalizedValue = Array.isArray(value) ? value.join(', ') : value;
        const safeValue = SENSITIVE_HEADER_NAMES.has(key.toLowerCase())
            ? '[redacted]'
            : normalizeHeaderValue(String(normalizedValue ?? ''));
        return [key, safeValue];
    })
        .filter(([, value]) => value.length > 0);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
function normalizeResponseHeaders(headers) {
    if (!headers)
        return undefined;
    const entries = Object.entries(headers)
        .slice(0, MAX_CAPTURED_HEADERS)
        .map(([key, value]) => {
        const normalizedValue = Array.isArray(value) ? value.join(', ') : String(value ?? '');
        const safeValue = SENSITIVE_HEADER_NAMES.has(key.toLowerCase())
            ? '[redacted]'
            : normalizeHeaderValue(normalizedValue);
        return [key, safeValue];
    })
        .filter(([, value]) => value.length > 0);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
function normalizeResponseHeadersForCallback(headers) {
    if (!headers)
        return undefined;
    return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.map(item => String(item)) : [String(value)],
    ]));
}
function pushUnique(target, value, max) {
    if (!value || target.includes(value))
        return;
    target.push(value);
    if (target.length > max)
        target.splice(0, target.length - max);
}
function calculateUploadSize(uploadData) {
    if (!Array.isArray(uploadData) || uploadData.length === 0)
        return undefined;
    let size = 0;
    let hasData = false;
    for (const item of uploadData) {
        if (item.bytes) {
            size += item.bytes.byteLength;
            hasData = true;
        }
        else if (typeof item.file === 'string' && item.file) {
            hasData = true;
        }
    }
    return hasData ? size : undefined;
}
function summarizeScope(scope) {
    const summary = scope.requestCount > 0
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
class BrowserInstrumentation {
    contextId;
    tabIdByWebContentsId = new Map();
    consoleEventsByTab = new Map();
    networkEventsByTab = new Map();
    requestMetadataById = new Map();
    requestIdsByTab = new Map();
    operationScopesById = new Map();
    interceptionPolicies = new Map();
    sessionAttached = false;
    callbackReturn = { cancel: false };
    constructor(contextId) {
        this.contextId = contextId;
    }
    attachSession(sessionInstance) {
        if (this.sessionAttached)
            return;
        this.sessionAttached = true;
        sessionInstance.webRequest.onBeforeRequest((details, callback) => {
            const tabId = this.resolveTabId(details.webContentsId);
            if (!tabId)
                return callback({ cancel: false });
            const requestId = this.requestKeyFromDetails(details);
            if (!requestId)
                return callback({ cancel: false });
            const operationId = this.resolveOperationId(tabId);
            const meta = {
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
            const byTab = this.requestIdsByTab.get(tabId) || new Set();
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
        sessionInstance.webRequest.onBeforeSendHeaders((details, callback) => {
            const requestId = this.requestKeyFromDetails(details);
            const requestMeta = requestId ? this.requestMetadataById.get(requestId) : undefined;
            const tabId = requestMeta?.tabId || this.resolveTabId(details.webContentsId) || null;
            const operationId = requestMeta?.operationId || (tabId ? this.resolveOperationId(tabId) : null);
            const requestHeaders = normalizeRequestHeaders(details.requestHeaders);
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
            }, details.requestHeaders);
            callback(interception || { cancel: false, requestHeaders: details.requestHeaders });
        });
        sessionInstance.webRequest.onHeadersReceived((details, callback) => {
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
        sessionInstance.webRequest.onBeforeRedirect((details) => {
            const requestId = this.requestKeyFromDetails(details);
            if (!requestId)
                return;
            const requestMeta = this.requestMetadataById.get(requestId);
            if (!requestMeta)
                return;
            requestMeta.responseStartedAt = Date.now();
            requestMeta.responseHeaders = normalizeResponseHeaders(details.responseHeaders);
        });
        sessionInstance.webRequest.onCompleted((details) => {
            const tabId = this.resolveTabId(details.webContentsId);
            const requestId = this.requestKeyFromDetails(details);
            const requestMeta = requestId ? this.requestMetadataById.get(requestId) : undefined;
            const responseStats = details;
            const completedAt = Date.now();
            const timingMs = requestMeta ? completedAt - requestMeta.startedAt : undefined;
            if (requestId)
                this.requestMetadataById.delete(requestId);
            if (requestMeta && requestId && requestMeta.tabId) {
                const byTab = this.requestIdsByTab.get(requestMeta.tabId);
                if (byTab) {
                    byTab.delete(requestId);
                    if (byTab.size === 0)
                        this.requestIdsByTab.delete(requestMeta.tabId);
                }
            }
            const effectiveTabId = requestMeta?.tabId || tabId;
            if (!effectiveTabId)
                return;
            const event = {
                id: (0, ids_1.generateId)('net'),
                requestId: requestId || (0, ids_1.generateId)('req'),
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
        sessionInstance.webRequest.onErrorOccurred((details) => {
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
                    if (byTab.size === 0)
                        this.requestIdsByTab.delete(requestMeta.tabId);
                }
            }
            const effectiveTabId = requestMeta?.tabId || tabId;
            if (!effectiveTabId)
                return;
            const event = {
                id: (0, ids_1.generateId)('net'),
                requestId: requestId || (0, ids_1.generateId)('req'),
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
    registerNetworkInterceptionPolicy(policy) {
        this.interceptionPolicies.set(policy.id, policy);
    }
    beginOperationNetworkScope(scope) {
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
    completeOperationNetworkScope(operationId) {
        const scope = this.operationScopesById.get(operationId);
        if (!scope)
            return null;
        const capture = summarizeScope(scope);
        this.operationScopesById.delete(operationId);
        return capture;
    }
    attachTab(tabId, webContents) {
        this.tabIdByWebContentsId.set(webContents.id, tabId);
        webContents.on('console-message', (_event, level, message, lineNumber, sourceId) => {
            this.pushConsoleEvent(tabId, {
                id: (0, ids_1.generateId)('console'),
                tabId,
                level: toConsoleLevel(level),
                message,
                sourceId: sourceId,
                lineNumber,
                timestamp: Date.now(),
            });
        });
    }
    detachTab(tabId, webContentsId) {
        const known = this.tabIdByWebContentsId.get(webContentsId);
        if (known === tabId)
            this.tabIdByWebContentsId.delete(webContentsId);
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
    getConsoleEvents(tabId, since) {
        const events = tabId
            ? (this.consoleEventsByTab.get(tabId) || [])
            : Array.from(this.consoleEventsByTab.values()).flat();
        return typeof since === 'number' ? events.filter(e => e.timestamp >= since) : events;
    }
    getNetworkEvents(tabId, since) {
        const events = tabId
            ? (this.networkEventsByTab.get(tabId) || [])
            : Array.from(this.networkEventsByTab.values()).flat();
        return typeof since === 'number' ? events.filter(e => e.timestamp >= since) : events;
    }
    pushConsoleEvent(tabId, event) {
        const current = this.consoleEventsByTab.get(tabId) || [];
        this.consoleEventsByTab.set(tabId, trimRecent([...current, event], MAX_CONSOLE_EVENTS));
    }
    pushNetworkEvent(tabId, event) {
        const current = this.networkEventsByTab.get(tabId) || [];
        this.networkEventsByTab.set(tabId, trimRecent([...current, event], MAX_NETWORK_EVENTS));
    }
    requestKeyFromDetails(details) {
        const requestId = details.id;
        return requestId == null ? null : String(requestId);
    }
    resolveTabId(webContentsId) {
        return webContentsId == null ? undefined : this.tabIdByWebContentsId.get(webContentsId);
    }
    resolveOperationId(tabId) {
        const candidates = Array.from(this.operationScopesById.values())
            .filter(scope => scope.contextId === this.contextId);
        const tabScoped = candidates
            .filter(scope => scope.tabId === tabId)
            .sort((a, b) => b.startedAt - a.startedAt)[0];
        if (tabScoped)
            return tabScoped.operationId;
        const mostRecent = candidates
            .sort((a, b) => b.startedAt - a.startedAt)[0];
        return mostRecent?.operationId ?? null;
    }
    recordOperationEvent(event) {
        if (!event.operationId)
            return;
        const scope = this.operationScopesById.get(event.operationId);
        if (!scope)
            return;
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
    buildInterceptionContext(input) {
        return { ...input };
    }
    applyBeforeRequestPolicies(input) {
        let response;
        for (const policy of this.interceptionPolicies.values()) {
            const context = this.buildInterceptionContext(input);
            if (policy.matches && !policy.matches(context))
                continue;
            const result = policy.onBeforeRequest?.(context);
            if (!result)
                continue;
            response = {
                cancel: result.cancel ?? response?.cancel ?? false,
                redirectURL: result.redirectURL ?? response?.redirectURL,
            };
        }
        return response || null;
    }
    applyBeforeSendHeadersPolicies(input, requestHeaders) {
        let nextHeaders = { ...requestHeaders };
        let changed = false;
        for (const policy of this.interceptionPolicies.values()) {
            const context = this.buildInterceptionContext(input);
            if (policy.matches && !policy.matches(context))
                continue;
            const result = policy.onBeforeSendHeaders?.(context);
            if (!result?.requestHeaders)
                continue;
            nextHeaders = { ...nextHeaders, ...result.requestHeaders };
            changed = true;
        }
        return changed ? { cancel: false, requestHeaders: nextHeaders } : null;
    }
    applyHeadersReceivedPolicies(input) {
        let nextHeaders = input.responseHeaders ? { ...input.responseHeaders } : undefined;
        let changed = false;
        for (const policy of this.interceptionPolicies.values()) {
            const context = this.buildInterceptionContext(input);
            if (policy.matches && !policy.matches(context))
                continue;
            const result = policy.onHeadersReceived?.(context);
            if (!result?.responseHeaders)
                continue;
            nextHeaders = {
                ...(nextHeaders || {}),
                ...result.responseHeaders,
            };
            changed = true;
        }
        if (!changed)
            return null;
        return { responseHeaders: normalizeResponseHeadersForCallback(nextHeaders) };
    }
}
exports.BrowserInstrumentation = BrowserInstrumentation;
//# sourceMappingURL=BrowserInstrumentation.js.map