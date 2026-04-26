import { describe, expect, it } from 'vitest';
import { checkGrounding } from './GroundingGate';
import type { FinalAnswer } from '../../shared/types/finalAnswer';

describe('checkGrounding', () => {
  it('passes when every claim references a completed valid tool call', () => {
    const answer: FinalAnswer = {
      claims: [
        {
          text: 'The command succeeded.',
          evidence: [{ toolCallId: 'tool_1', quote: 'exitCode: 0' }],
        },
      ],
      unresolved: [],
    };

    const verdict = checkGrounding(answer, new Map([
      ['tool_1', { status: 'completed', validation: { status: 'VALID', constraints: [], summary: 'ok' } }],
    ]));

    expect(verdict).toEqual({ status: 'PASS' });
  });

  it('fails when a claim has no evidence', () => {
    const verdict = checkGrounding({
      claims: [{ text: 'Ungrounded claim', evidence: [] }],
      unresolved: [],
    }, new Map());

    expect(verdict).toEqual({
      status: 'FAIL',
      issues: [{ kind: 'missing_evidence', claimIndex: 0 }],
    });
  });

  it('fails when evidence references an unknown tool call', () => {
    const verdict = checkGrounding({
      claims: [{ text: 'Unknown evidence', evidence: [{ toolCallId: 'missing', quote: 'x' }] }],
      unresolved: [],
    }, new Map());

    expect(verdict).toEqual({
      status: 'FAIL',
      issues: [{ kind: 'unknown_tool_call', claimIndex: 0, toolCallId: 'missing' }],
    });
  });

  it('fails when evidence points to an incomplete or invalid validation result', () => {
    const verdict = checkGrounding({
      claims: [
        { text: 'Incomplete', evidence: [{ toolCallId: 'tool_incomplete', quote: 'maybe' }] },
        { text: 'Invalid', evidence: [{ toolCallId: 'tool_invalid', quote: 'nope' }] },
      ],
      unresolved: [],
    }, new Map([
      ['tool_incomplete', { status: 'completed', validation: { status: 'INCOMPLETE', constraints: [], summary: 'unknown' } }],
      ['tool_invalid', { status: 'completed', validation: { status: 'INVALID', constraints: [], summary: 'failed' } }],
    ]));

    expect(verdict).toEqual({
      status: 'FAIL',
      issues: [
        { kind: 'tool_call_not_valid', claimIndex: 0, toolCallId: 'tool_incomplete', validationStatus: 'INCOMPLETE' },
        { kind: 'tool_call_not_valid', claimIndex: 1, toolCallId: 'tool_invalid', validationStatus: 'INVALID' },
      ],
    });
  });

  it('passes unresolved-only answers', () => {
    const verdict = checkGrounding({
      claims: [],
      unresolved: [{ question: 'What is the owner?', reason: 'No validated tool result.' }],
    }, new Map());

    expect(verdict).toEqual({ status: 'PASS' });
  });
});
