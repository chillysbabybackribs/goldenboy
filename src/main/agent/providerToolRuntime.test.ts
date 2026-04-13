import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HAIKU_PROVIDER_ID, PRIMARY_PROVIDER_ID } from '../../shared/types/model';

const { executeMock, recordToolMessageMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  recordToolMessageMock: vi.fn(),
}));

vi.mock('./AgentToolExecutor', () => ({
  agentToolExecutor: {
    execute: executeMock,
  },
}));

vi.mock('../chatKnowledge/ChatKnowledgeStore', () => ({
  chatKnowledgeStore: {
    recordToolMessage: recordToolMessageMock,
  },
}));

import {
  executeProviderToolCall,
  executeProviderToolCallWithEvents,
  normalizeProviderMaxToolTurns,
  publishProviderFinalOutput,
} from './providerToolRuntime';

describe('providerToolRuntime', () => {
  beforeEach(() => {
    executeMock.mockReset();
    recordToolMessageMock.mockReset();
  });

  it('normalizes provider max tool turns to runtime bounds', () => {
    expect(normalizeProviderMaxToolTurns()).toBe(20);
    expect(normalizeProviderMaxToolTurns(0)).toBe(1);
    expect(normalizeProviderMaxToolTurns(999)).toBe(40);
  });

  it('formats successful tool results and records tool memory', async () => {
    executeMock.mockResolvedValue({
      summary: 'Listed 3 files',
      data: { entries: ['a.ts', 'b.ts', 'c.ts'] },
      validation: {
        status: 'VALID',
        constraints: [
          {
            name: 'example_constraint',
            status: 'PASS',
            observed: 'ok',
          },
        ],
        summary: 'all constraints passed',
      },
    });

    const result = await executeProviderToolCall({
      providerId: PRIMARY_PROVIDER_ID,
      request: {
        runId: 'run-1',
        agentId: PRIMARY_PROVIDER_ID,
        mode: 'unrestricted-dev',
        taskId: 'task-1',
      },
      toolName: 'filesystem.list',
      toolInput: { path: '.' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected successful tool execution');
    expect(result.resultDescription).toBe('Listed 3 files');
    expect(result.toolContent).toContain('Listed 3 files');
    expect(result.toolContent).toContain('RUNTIME VALIDATION');
    expect(recordToolMessageMock).toHaveBeenCalledWith(
      'task-1',
      expect.stringContaining('"tool": "filesystem.list"'),
      PRIMARY_PROVIDER_ID,
      'run-1',
    );
  });

  it('emits status and item lifecycle events around tool execution', async () => {
    executeMock.mockResolvedValue({
      summary: 'Listed 3 files',
      data: { entries: ['a.ts', 'b.ts', 'c.ts'] },
    });

    const statusUpdates: string[] = [];
    const itemEvents: Array<{ eventType: string; status: string }> = [];

    const result = await executeProviderToolCallWithEvents({
      providerId: HAIKU_PROVIDER_ID,
      request: {
        runId: 'run-3',
        agentId: HAIKU_PROVIDER_ID,
        mode: 'unrestricted-dev',
        taskId: 'task-3',
        systemPrompt: 'system',
        task: 'task',
        tools: [],
        onStatus: (status) => {
          statusUpdates.push(status);
        },
        onItem: ({ item, eventType }) => {
          itemEvents.push({ eventType, status: item.status });
        },
      },
      itemId: 'tool-1',
      toolName: 'filesystem.list',
      toolInput: { path: '.' },
    });

    expect(result.ok).toBe(true);
    expect(statusUpdates).toEqual([
      'tool-start:Files: list .',
      'tool-done:Files: list . -> Listed 3 files',
    ]);
    expect(itemEvents).toEqual([
      { eventType: 'item.started', status: 'in_progress' },
      { eventType: 'item.completed', status: 'completed' },
    ]);
  });

  it('records tool errors for non-chat tools', async () => {
    executeMock.mockRejectedValue(new Error('tool exploded'));

    const result = await executeProviderToolCall({
      providerId: HAIKU_PROVIDER_ID,
      request: {
        runId: 'run-2',
        agentId: HAIKU_PROVIDER_ID,
        mode: 'unrestricted-dev',
        taskId: 'task-2',
      },
      toolName: 'terminal.exec',
      toolInput: { command: 'npm test' },
    });

    expect(result).toEqual({
      ok: false,
      errorMessage: 'tool exploded',
    });
    expect(recordToolMessageMock).toHaveBeenCalledWith(
      'task-2',
      expect.stringContaining('"error": "tool exploded"'),
      HAIKU_PROVIDER_ID,
      'run-2',
    );
  });

  it('publishes normalized final output without duplicating tokens when disabled', () => {
    const tokens: string[] = [];
    const itemEvents: string[] = [];

    const item = publishProviderFinalOutput({
      request: {
        onToken: (text) => {
          tokens.push(text);
        },
        onItem: ({ eventType }) => {
          itemEvents.push(eventType);
        },
      },
      itemId: 'final-1',
      text: '',
      emitToken: false,
    });

    expect(item.text).toContain('The run ended without a text response.');
    expect(tokens).toEqual([]);
    expect(itemEvents).toEqual(['item.completed']);
  });
});
