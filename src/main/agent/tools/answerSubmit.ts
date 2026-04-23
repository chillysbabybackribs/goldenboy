import type { FinalAnswer, GroundingIssue } from '../../../shared/types/finalAnswer';
import type { AgentToolDefinition, AgentToolResult } from '../AgentTypes';
import { agentRunStore } from '../AgentRunStore';
import { checkGrounding } from '../GroundingGate';

const FINAL_ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                toolCallId: { type: 'string' },
                quote: { type: 'string' },
              },
              required: ['toolCallId', 'quote'],
            },
          },
        },
        required: ['text', 'evidence'],
      },
    },
    unresolved: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          question: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['question', 'reason'],
      },
    },
  },
  required: ['claims', 'unresolved'],
} as const;

function formatIssue(issue: GroundingIssue): string {
  switch (issue.kind) {
    case 'missing_evidence':
      return `claim ${issue.claimIndex + 1} has no evidence`;
    case 'unknown_tool_call':
      return `claim ${issue.claimIndex + 1} references unknown tool call ${issue.toolCallId}`;
    case 'tool_call_not_valid':
      return `claim ${issue.claimIndex + 1} references ${issue.toolCallId} with ${issue.validationStatus} validation`;
    case 'tool_call_failed':
      return `claim ${issue.claimIndex + 1} references unfinished or failed tool call ${issue.toolCallId}`;
  }
}

function buildFailureResult(issues: GroundingIssue[]): AgentToolResult {
  return {
    summary: `GROUNDING FAIL - revise: ${issues.map(formatIssue).join('; ')}`,
    data: {
      verdict: {
        status: 'FAIL',
        issues,
      },
    },
  };
}

export function createAnswerSubmitToolDefinitions(): AgentToolDefinition[] {
  return [{
    name: 'answer.submit',
    description: 'Submit a structured final answer grounded in prior validated tool calls.',
    inputSchema: FINAL_ANSWER_SCHEMA,
    async execute(input, context) {
      const finalAnswer = input as FinalAnswer;
      const validationByCallId = new Map(
        agentRunStore
          .listToolCalls(context.runId)
          .filter((call) => call.toolName !== 'answer.submit')
          .map((call) => [
            call.id,
            {
              status: call.status,
              validation: (call.output && typeof call.output === 'object' && 'validation' in (call.output as Record<string, unknown>))
                ? ((call.output as { validation?: AgentToolResult['validation'] }).validation ?? null)
                : null,
            },
          ]),
      );
      const verdict = checkGrounding(finalAnswer, validationByCallId);

      if (verdict.status === 'FAIL') {
        return buildFailureResult(verdict.issues);
      }

      return {
        summary: 'answer accepted',
        data: {
          verdict,
          finalAnswer,
        },
      };
    },
  }];
}
