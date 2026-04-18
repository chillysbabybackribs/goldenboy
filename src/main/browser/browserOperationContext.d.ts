import type { BrowserOperationContextId, BrowserOperationExecutionContext } from '../../shared/types/browserOperationLedger';
type BrowserOperationAsyncContext = BrowserOperationExecutionContext & BrowserOperationContextId;
export declare function runWithBrowserOperationContext<T>(context: BrowserOperationAsyncContext, execute: () => T): T;
export declare function getBrowserOperationContext(): BrowserOperationAsyncContext | undefined;
export {};
