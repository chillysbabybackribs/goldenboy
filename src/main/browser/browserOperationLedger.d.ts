import type { BrowserState } from '../../shared/types/browser';
import type { BrowserExecutionDecision, BrowserExecutionDecisionResult } from '../../shared/types/browserExecution';
import type { BrowserTargetDescriptor, BrowserTargetValidationResult } from '../../shared/types/browserDeterministic';
import type { BrowserOperationExecutionContext, BrowserOperationKind, BrowserOperationLedgerEntry } from '../../shared/types/browserOperationLedger';
import type { BrowserOperationNetworkCapture } from './browserNetworkSupport';
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
    targetDescriptor?: BrowserTargetDescriptor | null;
    replayOfOperationId?: string | null;
    decision?: BrowserExecutionDecision | null;
};
export declare class BrowserOperationLedger {
    private readonly maxEntries;
    private entries;
    constructor(maxEntries?: number);
    start(input: BrowserOperationLedgerStartInput): BrowserOperationLedgerEntry;
    complete(operationId: string, result: BrowserOperationResultLike, networkCapture?: BrowserOperationNetworkCapture, validation?: BrowserTargetValidationResult | null, decisionResult?: BrowserExecutionDecisionResult | null): void;
    fail(operationId: string, error: unknown, networkCapture?: BrowserOperationNetworkCapture, validation?: BrowserTargetValidationResult | null, decisionResult?: BrowserExecutionDecisionResult | null): void;
    listRecent(limit?: number): BrowserOperationLedgerEntry[];
    clear(): void;
    private update;
}
export declare const browserOperationLedger: BrowserOperationLedger;
export declare function getRecentBrowserOperationLedgerEntries(limit?: number): BrowserOperationLedgerEntry[];
export declare function clearBrowserOperationLedger(): void;
export {};
