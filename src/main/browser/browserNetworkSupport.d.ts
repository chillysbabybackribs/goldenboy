import type { BrowserOperationKind } from '../../shared/types/browserOperationLedger';
import type { BrowserNetworkActivitySummary } from '../../shared/types/browserIntelligence';
export type BrowserOperationNetworkScope = {
    operationId: string;
    contextId: string;
    kind: BrowserOperationKind;
    tabId: string | null;
};
export type BrowserOperationNetworkCapture = {
    eventIds: string[];
    summary: BrowserNetworkActivitySummary | null;
};
export type BrowserNetworkInterceptionContext = {
    contextId: string;
    operationId: string | null;
    tabId: string | null;
    method: string;
    url: string;
    resourceType: string;
    requestHeaders?: Record<string, string>;
    responseHeaders?: Record<string, string[]>;
    statusCode?: number | null;
};
export type BrowserNetworkInterceptionPolicy = {
    id: string;
    matches?: (input: BrowserNetworkInterceptionContext) => boolean;
    onBeforeRequest?: (input: BrowserNetworkInterceptionContext) => {
        cancel?: boolean;
        redirectURL?: string;
    } | void;
    onBeforeSendHeaders?: (input: BrowserNetworkInterceptionContext) => {
        requestHeaders?: Record<string, string>;
    } | void;
    onHeadersReceived?: (input: BrowserNetworkInterceptionContext) => {
        responseHeaders?: Record<string, string[]>;
    } | void;
};
