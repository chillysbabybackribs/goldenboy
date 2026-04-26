export type EvidenceRef = {
  toolCallId: string;
  quote: string;
};

export type FinalAnswerClaim = {
  text: string;
  evidence: EvidenceRef[];
};

export type FinalAnswerUnresolved = {
  question: string;
  reason: string;
};

export type FinalAnswer = {
  claims: FinalAnswerClaim[];
  unresolved: FinalAnswerUnresolved[];
};

export type GroundingIssue =
  | { kind: 'missing_evidence'; claimIndex: number }
  | { kind: 'unknown_tool_call'; claimIndex: number; toolCallId: string }
  | { kind: 'tool_call_not_valid'; claimIndex: number; toolCallId: string; validationStatus: 'INVALID' | 'INCOMPLETE' }
  | { kind: 'tool_call_failed'; claimIndex: number; toolCallId: string };

export type GroundingVerdict =
  | { status: 'PASS' }
  | { status: 'FAIL'; issues: GroundingIssue[] };
