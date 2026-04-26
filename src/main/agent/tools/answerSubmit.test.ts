import { beforeEach, describe, expect, it } from 'vitest';
import { agentRunStore } from '../AgentRunStore';
import { createAnswerSubmitToolDefinitions } from './answerSubmit';

describe('createAnswerSubmitToolDefinitions', () => {
  beforeEach(() => {
    agentRunStore.prune(Number.POSITIVE_INFINITY);
  });

  it('accepts grounded answers backed by valid tool calls', async () => {
    const run = agentRunStore.createRun({
      parentRunId: null,
      depth: 0,
      role: 'primary',
      task: 'test',
      mode: 'unrestricted-dev',
    });
    const toolCall = agentRunStore.startToolCall({
      runId: run.id,
      agentId: 'codex',
      toolName: 'terminal.exec',
      toolInput: { command: 'echo ok' },
    });
    agentRunStore.finishToolCall(toolCall.id, 'completed', {
      summary: 'Ran echo ok',
      data: { exitCode: 0 },
      validation: { status: 'VALID', constraints: [], summary: 'ok' },
    });

    const tool = createAnswerSubmitToolDefinitions()[0];
    const result = await tool.execute({
      claims: [{ text: 'The command succeeded.', evidence: [{ toolCallId: toolCall.id, quote: 'exitCode: 0' }] }],
      unresolved: [],
    }, {
      runId: run.id,
      agentId: 'codex',
      mode: 'unrestricted-dev',
    });

    expect(result.summary).toBe('answer accepted');
    expect(result.data).toMatchObject({
      verdict: { status: 'PASS' },
      finalAnswer: {
        claims: [{ text: 'The command succeeded.' }],
        unresolved: [],
      },
    });
  });

  it('rejects evidence backed by incomplete validation', async () => {
    const run = agentRunStore.createRun({
      parentRunId: null,
      depth: 0,
      role: 'primary',
      task: 'test',
      mode: 'unrestricted-dev',
    });
    const toolCall = agentRunStore.startToolCall({
      runId: run.id,
      agentId: 'codex',
      toolName: 'terminal.exec',
      toolInput: { command: 'echo maybe' },
    });
    agentRunStore.finishToolCall(toolCall.id, 'completed', {
      summary: 'Ran echo maybe',
      data: { exitCode: 0 },
      validation: { status: 'INCOMPLETE', constraints: [], summary: 'unknown' },
    });

    const tool = createAnswerSubmitToolDefinitions()[0];
    const result = await tool.execute({
      claims: [{ text: 'Maybe succeeded.', evidence: [{ toolCallId: toolCall.id, quote: 'exitCode: 0' }] }],
      unresolved: [],
    }, {
      runId: run.id,
      agentId: 'codex',
      mode: 'unrestricted-dev',
    });

    expect(result.summary).toContain('GROUNDING FAIL');
    expect(result.data).toMatchObject({
      verdict: {
        status: 'FAIL',
        issues: [{ kind: 'tool_call_not_valid', claimIndex: 0, toolCallId: toolCall.id, validationStatus: 'INCOMPLETE' }],
      },
    });
  });

  it('rejects evidence that references an unknown tool call', async () => {
    const run = agentRunStore.createRun({
      parentRunId: null,
      depth: 0,
      role: 'primary',
      task: 'test',
      mode: 'unrestricted-dev',
    });

    const tool = createAnswerSubmitToolDefinitions()[0];
    const result = await tool.execute({
      claims: [{ text: 'Unknown.', evidence: [{ toolCallId: 'tool_missing', quote: 'x' }] }],
      unresolved: [],
    }, {
      runId: run.id,
      agentId: 'codex',
      mode: 'unrestricted-dev',
    });

    expect(result.summary).toContain('GROUNDING FAIL');
    expect(result.data).toMatchObject({
      verdict: {
        status: 'FAIL',
        issues: [{ kind: 'unknown_tool_call', claimIndex: 0, toolCallId: 'tool_missing' }],
      },
    });
  });
});
