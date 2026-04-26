import type { FinalAnswer, GroundingIssue, GroundingVerdict } from '../../shared/types/finalAnswer';
import type { AgentToolStatus, ResultValidation } from './AgentTypes';

export type GroundingValidationEntry = {
  status: AgentToolStatus;
  validation: ResultValidation | null;
};

export function checkGrounding(
  finalAnswer: FinalAnswer,
  validationByCallId: Map<string, GroundingValidationEntry>,
): GroundingVerdict {
  const issues: GroundingIssue[] = [];

  finalAnswer.claims.forEach((claim, claimIndex) => {
    if (!Array.isArray(claim.evidence) || claim.evidence.length === 0) {
      issues.push({ kind: 'missing_evidence', claimIndex });
      return;
    }

    for (const ref of claim.evidence) {
      const entry = validationByCallId.get(ref.toolCallId);
      if (!entry) {
        issues.push({
          kind: 'unknown_tool_call',
          claimIndex,
          toolCallId: ref.toolCallId,
        });
        continue;
      }
      if (entry.status !== 'completed') {
        issues.push({
          kind: 'tool_call_failed',
          claimIndex,
          toolCallId: ref.toolCallId,
        });
        continue;
      }
      if (entry.validation && entry.validation.status !== 'VALID') {
        issues.push({
          kind: 'tool_call_not_valid',
          claimIndex,
          toolCallId: ref.toolCallId,
          validationStatus: entry.validation.status,
        });
      }
    }
  });

  return issues.length > 0
    ? { status: 'FAIL', issues }
    : { status: 'PASS' };
}
