import { AsyncLocalStorage } from 'node:async_hooks';
import type { BrowserOperationContextId, BrowserOperationExecutionContext } from '../../shared/types/browserOperationLedger';

type BrowserOperationAsyncContext = BrowserOperationExecutionContext & BrowserOperationContextId;

const browserOperationContextStorage = new AsyncLocalStorage<BrowserOperationAsyncContext>();

export function runWithBrowserOperationContext<T>(
  context: BrowserOperationAsyncContext,
  execute: () => T,
): T {
  return browserOperationContextStorage.run(context, execute);
}

export function getBrowserOperationContext(): BrowserOperationAsyncContext | undefined {
  return browserOperationContextStorage.getStore();
}
