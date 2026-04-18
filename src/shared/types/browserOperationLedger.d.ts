import type { BrowserActionKind } from '../actions/surfaceActionTypes';
import type { BrowserExecutionDecision, BrowserExecutionDecisionResult } from './browserExecution';
import type { BrowserTargetDescriptor, BrowserTargetValidationResult } from './browserDeterministic';
import type { BrowserNetworkActivitySummary } from './browserIntelligence';
export type BrowserOperationKind = BrowserActionKind | 'browser.get-state' | 'browser.get-tabs' | 'browser.search-web' | 'browser.upload-file' | 'browser.download-link' | 'browser.download-url' | 'browser.get-downloads' | 'browser.wait-for-download' | 'browser.drag' | 'browser.hover' | 'browser.hit-test' | 'browser.inspect-page' | 'browser.get-dialogs' | 'browser.accept-dialog' | 'browser.dismiss-dialog' | 'browser.get-actionable-elements' | 'browser.capture-snapshot';
export type BrowserOperationLedgerSource = 'ui' | 'agent' | 'other';
export type BrowserOperationLedgerStatus = 'running' | 'completed' | 'failed';
export type BrowserOperationLedgerSummaryValue = string | number | boolean | null | Array<string | number>;
export type BrowserOperationLedgerInputSummary = {
    text: string;
    fields: Record<string, BrowserOperationLedgerSummaryValue>;
};
export type BrowserOperationLedgerContext = {
    taskId: string | null;
    tabId: string | null;
    source: BrowserOperationLedgerSource;
    agentId: string | null;
    runId: string | null;
    activeTabId: string | null;
    activeUrl: string | null;
    activeTitle: string | null;
    splitLeftTabId: string | null;
    splitRightTabId: string | null;
};
export type BrowserOperationLedgerReferences = {
    snapshotIds: string[];
    downloadIds: string[];
    dialogIds: string[];
    consoleEventIds: string[];
    networkEventIds: string[];
};
export type BrowserOperationLedgerEntry = {
    operationId: string;
    timestamp: number;
    kind: BrowserOperationKind;
    contextId: string;
    status: BrowserOperationLedgerStatus;
    context: BrowserOperationLedgerContext;
    inputSummary: BrowserOperationLedgerInputSummary;
    resultSummary: string | null;
    errorSummary: string | null;
    durationMs: number | null;
    completedAt: number | null;
    related: BrowserOperationLedgerReferences;
    network: BrowserNetworkActivitySummary | null;
    targetDescriptor: BrowserTargetDescriptor | null;
    validation: BrowserTargetValidationResult | null;
    replayOfOperationId: string | null;
    decision: BrowserExecutionDecision | null;
    decisionResult: BrowserExecutionDecisionResult | null;
};
export type BrowserOperationExecutionContext = Partial<Pick<BrowserOperationLedgerContext, 'taskId' | 'tabId' | 'source' | 'agentId' | 'runId'>>;
export type BrowserOperationContextId = {
    contextId?: string | null;
};
