// ═══════════════════════════════════════════════════════════════════════════
// Browser Action Executor — Surface-action adapter onto the authoritative
// browser operation layer.
// ═══════════════════════════════════════════════════════════════════════════

import { BrowserActionKind, SurfaceActionKind } from '../../shared/actions/surfaceActionTypes';
import type { BrowserOperationLedgerSource } from '../../shared/types/browserOperationLedger';
import {
  BrowserOperationInput,
  BrowserOperationResult,
  executeBrowserOperation,
} from '../browser/browserOperations';

export type ActionResult = BrowserOperationResult;

type BrowserActionExecutionContext = {
  taskId?: string | null;
  origin?: 'command-center' | 'system' | 'model';
  contextId?: string | null;
};

function mapOriginToSource(origin?: BrowserActionExecutionContext['origin']): BrowserOperationLedgerSource {
  switch (origin) {
    case 'command-center':
      return 'ui';
    case 'model':
      return 'agent';
    default:
      return 'other';
  }
}

export async function executeBrowserAction(
  kind: SurfaceActionKind,
  payload: Record<string, unknown>,
  context?: BrowserActionExecutionContext,
): Promise<ActionResult> {
  if (!kind.startsWith('browser.')) {
    throw new Error(`Unknown browser action kind: ${kind}`);
  }

  return executeBrowserOperation({
    kind: kind as BrowserActionKind,
    payload,
    context: {
      taskId: context?.taskId ?? null,
      contextId: context?.contextId ?? null,
      source: mapOriginToSource(context?.origin),
    },
  } as BrowserOperationInput);
}
