import type { BrowserExecutionDecision, BrowserExecutionDecisionResult } from '../../shared/types/browserExecution';
import type { BrowserTargetValidationResult } from '../../shared/types/browserDeterministic';
import type { BrowserOperationKind } from '../../shared/types/browserOperationLedger';
type BrowserExecutionDecisionInput = {
    kind: BrowserOperationKind;
    replayOfOperationId?: string | null;
    strictness?: 'strict' | 'best-effort';
    preflightValidation?: BrowserTargetValidationResult | null;
    supportsDeterministicExecution: boolean;
};
export declare function decideBrowserExecution(input: BrowserExecutionDecisionInput): BrowserExecutionDecision;
export declare function finalizeBrowserExecutionDecision(decision: BrowserExecutionDecision, input: {
    finalStatus: BrowserExecutionDecisionResult['finalStatus'];
    preflightValidation?: BrowserTargetValidationResult | null;
}): BrowserExecutionDecisionResult;
export {};
