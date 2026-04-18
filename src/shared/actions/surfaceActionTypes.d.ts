import { SurfaceRole } from '../types/windowRoles';
export type SurfaceTarget = SurfaceRole;
export type SurfaceActionStatus = 'queued' | 'running' | 'completed' | 'failed';
export type BrowserActionKind = 'browser.navigate' | 'browser.back' | 'browser.forward' | 'browser.reload' | 'browser.stop' | 'browser.create-tab' | 'browser.close-tab' | 'browser.activate-tab' | 'browser.split-tab' | 'browser.clear-split-view' | 'browser.click' | 'browser.type' | 'browser.dismiss-foreground-ui' | 'browser.return-to-primary-surface' | 'browser.click-ranked-action' | 'browser.wait-for-overlay-state' | 'browser.open-search-results-tabs';
export type TerminalActionKind = 'terminal.execute' | 'terminal.write' | 'terminal.restart' | 'terminal.interrupt';
export type SurfaceActionKind = BrowserActionKind | TerminalActionKind;
export type SurfaceActionOrigin = 'command-center' | 'system' | 'model';
export type BrowserNavigatePayload = {
    url: string;
};
export type BrowserCreateTabPayload = {
    url?: string;
    insertAfterTabId?: string;
};
export type BrowserCloseTabPayload = {
    tabId: string;
};
export type BrowserActivateTabPayload = {
    tabId: string;
};
export type BrowserSplitTabPayload = {
    tabId?: string;
};
export type BrowserEmptyPayload = Record<string, never>;
export type BrowserClickPayload = {
    selector: string;
    tabId?: string;
};
export type BrowserTypePayload = {
    selector: string;
    text: string;
    tabId?: string;
};
export type BrowserSemanticTargetPayload = {
    tabId?: string;
};
export type BrowserClickRankedActionPayload = {
    tabId?: string;
    index?: number;
    actionId?: string;
    preferDismiss?: boolean;
};
export type BrowserWaitForOverlayPayload = {
    tabId?: string;
    state: 'open' | 'closed';
    timeoutMs?: number;
};
export type BrowserOpenSearchResultsTabsPayload = {
    tabId?: string;
    indices?: number[];
    limit?: number;
    activateFirst?: boolean;
};
export type TerminalExecutePayload = {
    command: string;
};
export type TerminalWritePayload = {
    input: string;
};
export type TerminalEmptyPayload = Record<string, never>;
export type SurfaceActionPayloadMap = {
    'browser.navigate': BrowserNavigatePayload;
    'browser.back': BrowserEmptyPayload;
    'browser.forward': BrowserEmptyPayload;
    'browser.reload': BrowserEmptyPayload;
    'browser.stop': BrowserEmptyPayload;
    'browser.create-tab': BrowserCreateTabPayload;
    'browser.close-tab': BrowserCloseTabPayload;
    'browser.activate-tab': BrowserActivateTabPayload;
    'browser.split-tab': BrowserSplitTabPayload;
    'browser.clear-split-view': BrowserEmptyPayload;
    'browser.click': BrowserClickPayload;
    'browser.type': BrowserTypePayload;
    'browser.dismiss-foreground-ui': BrowserSemanticTargetPayload;
    'browser.return-to-primary-surface': BrowserSemanticTargetPayload;
    'browser.click-ranked-action': BrowserClickRankedActionPayload;
    'browser.wait-for-overlay-state': BrowserWaitForOverlayPayload;
    'browser.open-search-results-tabs': BrowserOpenSearchResultsTabsPayload;
    'terminal.execute': TerminalExecutePayload;
    'terminal.write': TerminalWritePayload;
    'terminal.restart': TerminalEmptyPayload;
    'terminal.interrupt': TerminalEmptyPayload;
};
export type SurfaceAction<K extends SurfaceActionKind = SurfaceActionKind> = {
    id: string;
    target: SurfaceTarget;
    kind: K;
    status: SurfaceActionStatus;
    origin: SurfaceActionOrigin;
    payload: SurfaceActionPayloadMap[K];
    createdAt: number;
    updatedAt: number;
    taskId: string | null;
};
export type SurfaceActionRecord = {
    id: string;
    target: SurfaceTarget;
    kind: SurfaceActionKind;
    status: SurfaceActionStatus;
    origin: SurfaceActionOrigin;
    payloadSummary: string;
    resultSummary: string | null;
    resultData: Record<string, unknown> | null;
    error: string | null;
    createdAt: number;
    updatedAt: number;
    taskId: string | null;
};
export type SurfaceActionInput<K extends SurfaceActionKind = SurfaceActionKind> = {
    target: SurfaceTarget;
    kind: K;
    payload: SurfaceActionPayloadMap[K];
    taskId?: string | null;
    origin?: SurfaceActionOrigin;
};
export declare function targetForKind(kind: SurfaceActionKind): SurfaceTarget;
export declare function summarizePayload(kind: SurfaceActionKind, payload: Record<string, unknown>): string;
export declare const BROWSER_ACTION_KINDS: BrowserActionKind[];
export declare const TERMINAL_ACTION_KINDS: TerminalActionKind[];
export declare const ALL_ACTION_KINDS: SurfaceActionKind[];
