import type {
  BrowserExecutionDecision,
  BrowserExecutionDecisionResult,
  BrowserExecutionMode,
  BrowserNetworkAssessment,
} from '../../shared/types/browserExecution';
import type { BrowserTargetValidationResult } from '../../shared/types/browserDeterministic';
import type { BrowserOperationKind } from '../../shared/types/browserOperationLedger';

type BrowserExecutionDecisionInput = {
  kind: BrowserOperationKind;
  replayOfOperationId?: string | null;
  strictness?: 'strict' | 'best-effort';
  preflightValidation?: BrowserTargetValidationResult | null;
  supportsDeterministicExecution: boolean;
};

function networkAssessmentForOperation(kind: BrowserOperationKind): BrowserNetworkAssessment {
  switch (kind) {
    case 'browser.navigate':
    case 'browser.search-web':
    case 'browser.back':
    case 'browser.forward':
    case 'browser.reload':
    case 'browser.stop':
    case 'browser.download-link':
    case 'browser.download-url':
    case 'browser.wait-for-download':
    case 'browser.open-search-results-tabs':
      return {
        availability: 'observe_only',
        reason: 'Network instrumentation can observe and bound this operation, but the runtime has no safe direct API executor yet.',
      };
    default:
      return {
        availability: 'not_applicable',
        reason: 'This operation currently requires browser-surface interaction or local browser state changes.',
      };
  }
}

function confidenceForMode(mode: BrowserExecutionMode, validation?: BrowserTargetValidationResult | null): BrowserExecutionDecision['confidence'] {
  if (mode === 'abort') return 'low';
  if (mode === 'heuristic_execute') {
    return validation?.status === 'matched' ? 'medium' : 'low';
  }
  return validation?.status === 'matched' ? 'high' : 'medium';
}

export function decideBrowserExecution(input: BrowserExecutionDecisionInput): BrowserExecutionDecision {
  const strictness = input.strictness === 'best-effort' ? 'best-effort' : 'strict';
  const validation = input.preflightValidation || null;
  const network = networkAssessmentForOperation(input.kind);
  const evidence: string[] = [];
  if (input.supportsDeterministicExecution) evidence.push('deterministic-supported');
  else evidence.push('deterministic-unsupported');
  if (input.replayOfOperationId) evidence.push('replay-requested');
  if (validation) evidence.push(`preflight:${validation.status}`);
  evidence.push(`network:${network.availability}`);

  if (input.replayOfOperationId) {
    if (validation?.status === 'matched') {
      return {
        operationKind: input.kind,
        selectedMode: 'deterministic_replay',
        confidence: confidenceForMode('deterministic_replay', validation),
        reasonSummary: 'Replay target validated successfully; deterministic replay is preferred.',
        evidence,
        fallbackMode: strictness === 'best-effort' ? 'heuristic_execute' : null,
        network,
      };
    }

    if (strictness === 'strict') {
      return {
        operationKind: input.kind,
        selectedMode: 'abort',
        confidence: confidenceForMode('abort', validation),
        reasonSummary: validation?.summary || 'Replay preflight did not validate strongly enough for strict replay.',
        evidence,
        fallbackMode: null,
        network,
      };
    }

    return {
      operationKind: input.kind,
      selectedMode: 'heuristic_execute',
      confidence: confidenceForMode('heuristic_execute', validation),
      reasonSummary: validation?.summary
        ? `Replay preflight was weak (${validation.status}); falling back to heuristic execution.`
        : 'Replay request lacked strong target validation; falling back to heuristic execution.',
      evidence,
      fallbackMode: null,
      network,
    };
  }

  if (!input.supportsDeterministicExecution) {
    return {
      operationKind: input.kind,
      selectedMode: 'heuristic_execute',
      confidence: confidenceForMode('heuristic_execute', validation),
      reasonSummary: 'This operation does not have bounded deterministic execution support yet.',
      evidence,
      fallbackMode: null,
      network,
    };
  }

  if (validation?.status === 'matched') {
    return {
      operationKind: input.kind,
      selectedMode: 'deterministic_execute',
      confidence: confidenceForMode('deterministic_execute', validation),
      reasonSummary: 'Deterministic target evidence is strong enough for normal execution with validation.',
      evidence,
      fallbackMode: 'heuristic_execute',
      network,
    };
  }

  return {
    operationKind: input.kind,
    selectedMode: 'heuristic_execute',
    confidence: confidenceForMode('heuristic_execute', validation),
    reasonSummary: validation?.summary
      ? `Deterministic target evidence was weak (${validation.status}); using heuristic execution.`
      : 'Deterministic target evidence was unavailable; using heuristic execution.',
    evidence,
    fallbackMode: null,
    network,
  };
}

export function finalizeBrowserExecutionDecision(
  decision: BrowserExecutionDecision,
  input: {
    finalStatus: BrowserExecutionDecisionResult['finalStatus'];
    preflightValidation?: BrowserTargetValidationResult | null;
  },
): BrowserExecutionDecisionResult {
  const attemptedModes: BrowserExecutionMode[] = [];

  if (decision.selectedMode === 'heuristic_execute' && input.preflightValidation) {
    if (input.preflightValidation.status !== 'matched' && decision.evidence.includes('replay-requested')) {
      attemptedModes.push('deterministic_replay');
    } else if (input.preflightValidation.status !== 'matched' && decision.evidence.includes('deterministic-supported')) {
      attemptedModes.push('deterministic_execute');
    }
  }

  attemptedModes.push(decision.selectedMode);

  return {
    selectedMode: decision.selectedMode,
    attemptedModes,
    fallbackUsed: attemptedModes.length > 1,
    finalStatus: input.finalStatus,
    summary: input.finalStatus === 'completed'
      ? `Executed via ${decision.selectedMode}`
      : input.finalStatus === 'aborted'
        ? `Aborted before execution via ${decision.selectedMode}`
        : `Execution failed via ${decision.selectedMode}`,
  };
}
