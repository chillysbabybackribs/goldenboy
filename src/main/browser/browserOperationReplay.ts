import type { BrowserReplayRequest } from '../../shared/types/browserDeterministic';
import type { BrowserTargetValidationResult } from '../../shared/types/browserDeterministic';
import type { BrowserOperationKind } from '../../shared/types/browserOperationLedger';
import { browserContextManager } from './browserContextManager';
import { getRecentBrowserOperationLedgerEntries } from './browserOperationLedger';
import {
  isReplaySupportedOperation,
  resolveReplayStrictness,
  resolveReplayValidationMode,
  validateReplayPreflight,
} from './browserDeterministicExecution';
import { browserOperationReplayStore } from './browserOperationReplayStore';
import { executeBrowserOperation } from './browserOperations';

function coerceReplayKind(kind: BrowserOperationKind): BrowserOperationKind {
  return kind;
}

export async function replayBrowserOperation(request: BrowserReplayRequest): Promise<{
  replayedOperationId: string | null;
  sourceOperationId: string;
  validation: BrowserTargetValidationResult | null;
  result: { summary: string; data: Record<string, unknown> } | null;
}> {
  const source = browserOperationReplayStore.get(request.sourceOperationId);
  if (!source) {
    throw new Error(`Replay source operation not found: ${request.sourceOperationId}`);
  }

  if (!isReplaySupportedOperation(source.kind)) {
    throw new Error(`Replay is not supported for ${source.kind}`);
  }

  const contextId = request.contextId ?? source.context?.contextId ?? null;
  const browserContext = browserContextManager.resolveContext(contextId);
  const validationMode = resolveReplayValidationMode(request.validationMode);
  const strictness = resolveReplayStrictness(request.strictness);
  const preflight = validationMode === 'none'
    ? { validation: null, resolvedSelector: null }
    : await validateReplayPreflight(browserContext.service, source.targetDescriptor);

  const payload = { ...source.payload } as Record<string, unknown>;
  if ((source.kind === 'browser.click' || source.kind === 'browser.type') && preflight.resolvedSelector) {
    payload.selector = preflight.resolvedSelector;
  }

  const result = await executeBrowserOperation({
    kind: coerceReplayKind(source.kind),
    payload: payload as any,
    context: {
      ...(source.context || {}),
      contextId: browserContext.id,
    },
    meta: {
      replayOfOperationId: source.operationId,
      targetDescriptor: source.targetDescriptor,
      validationMode,
      strictness,
      preflightValidation: preflight.validation,
    },
  });

  return {
    replayedOperationId: getRecentBrowserOperationLedgerEntries(1)[0]?.operationId || null,
    sourceOperationId: source.operationId,
    validation: preflight.validation,
    result,
  };
}
