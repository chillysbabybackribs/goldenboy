import type { BrowserReplayStrictness, BrowserReplayValidationMode, BrowserTargetDescriptor, BrowserTargetValidationResult } from '../../shared/types/browserDeterministic';
import type { BrowserOperationContextId, BrowserOperationExecutionContext, BrowserOperationKind } from '../../shared/types/browserOperationLedger';
import type { BrowserOperationPayloadMap } from './browserOperations';
export type BrowserOperationExecutionMeta = {
    replayOfOperationId?: string | null;
    targetDescriptor?: BrowserTargetDescriptor | null;
    validationMode?: BrowserReplayValidationMode;
    strictness?: BrowserReplayStrictness;
    preflightValidation?: BrowserTargetValidationResult | null;
};
export type ReplayableBrowserOperationRecord = {
    operationId: string;
    kind: BrowserOperationKind;
    payload: Record<string, unknown>;
    context?: BrowserOperationExecutionContext & BrowserOperationContextId;
    targetDescriptor: BrowserTargetDescriptor | null;
};
type ReplayableBrowserOperationInput<K extends BrowserOperationKind = BrowserOperationKind> = {
    kind: K;
    payload: BrowserOperationPayloadMap[K];
    context?: BrowserOperationExecutionContext & BrowserOperationContextId;
};
export declare class BrowserOperationReplayStore {
    private readonly maxEntries;
    private records;
    constructor(maxEntries?: number);
    save<K extends BrowserOperationKind>(operationId: string, input: ReplayableBrowserOperationInput<K>, targetDescriptor: BrowserTargetDescriptor | null): void;
    get(operationId: string): ReplayableBrowserOperationRecord | null;
    clear(): void;
}
export declare const browserOperationReplayStore: BrowserOperationReplayStore;
export declare function clearBrowserOperationReplayStore(): void;
export {};
