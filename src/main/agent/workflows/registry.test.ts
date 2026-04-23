import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowDefinition, WorkflowExecutionInput } from './types';

const { runMock } = vi.hoisted(() => ({
  runMock: vi.fn(),
}));
const { recordPlanMock } = vi.hoisted(() => ({
  recordPlanMock: vi.fn(),
}));

vi.mock('./BrowserWorkflowExecutor', () => ({
  BrowserWorkflowExecutor: class {
    async run(workflow: WorkflowDefinition, executionInput: WorkflowExecutionInput) {
      return runMock(workflow, executionInput);
    }
  },
}));

vi.mock('../../models/taskMemoryStore', () => ({
  taskMemoryStore: {
    recordPlan: recordPlanMock,
  },
}));

import { listRegisteredBrowserWorkflows, runRegisteredBrowserWorkflow } from './registry';

describe('workflow registry', () => {
  beforeEach(() => {
    runMock.mockReset();
    recordPlanMock.mockReset();
  });

  it('lists registered browser workflows', () => {
    expect(listRegisteredBrowserWorkflows()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'browser-automation-research',
        version: '1.0.0',
      }),
      expect.objectContaining({
        id: 'yahoo-local-badge',
        version: '1.0.0',
      }),
    ]));
  });

  it('runs a registered workflow and records plan milestones', async () => {
    runMock.mockImplementation(async (_workflow: WorkflowDefinition, executionInput: WorkflowExecutionInput) => {
      executionInput.onHeartbeat?.({
        workflowId: 'yahoo-local-badge',
        stepId: 'open_yahoo',
        retryCount: 0,
        timestamp: 1,
      });
      executionInput.onCheckpoint?.({
        workflowId: 'yahoo-local-badge',
        stepId: 'open_yahoo',
        status: 'completed',
        retryCount: 0,
        timestamp: 1,
        toolName: 'browser.navigate',
        summary: 'navigated',
      });
      return {
        workflowId: 'yahoo-local-badge',
        success: true,
        completedStepIds: ['open_yahoo', 'wait_for_header', 'inject_badge', 'verify_badge'],
        failedStepId: null,
        toolCalls: [],
        checkpoints: [],
        lastUrl: 'https://www.yahoo.com/',
        stepResults: {
          open_yahoo: {
            kind: 'tool',
            toolName: 'browser.navigate',
            summary: 'navigated',
            data: { url: 'https://www.yahoo.com/' },
          },
        },
      };
    });

    const onProgress = vi.fn();
    const result = await runRegisteredBrowserWorkflow({
      workflowId: 'yahoo-local-badge',
      workflowInputs: { badgeText: 'GPU' },
      context: {
        runId: 'run_1',
        agentId: 'agent_1',
        mode: 'unrestricted-dev',
        taskId: 'task_1',
        onProgress,
      },
    });

    expect(result.summary).toBe('Workflow yahoo-local-badge completed 4 steps');
    expect(result.data).toMatchObject({
      workflowId: 'yahoo-local-badge',
      success: true,
      inputs: { badgeText: 'GPU' },
      lastUrl: 'https://www.yahoo.com/',
      stepResults: {
        open_yahoo: {
          summary: 'navigated',
        },
      },
    });
    expect(onProgress).toHaveBeenCalledWith(
      'tool-progress:Browser: run workflow yahoo-local-badge -> open_yahoo (retry 0)',
    );
    expect(recordPlanMock).toHaveBeenCalledWith(
      'task_1',
      'Workflow yahoo-local-badge started',
      expect.objectContaining({
        planId: 'workflow:yahoo-local-badge',
        status: 'running',
      }),
    );
    expect(recordPlanMock).toHaveBeenLastCalledWith(
      'task_1',
      'Workflow yahoo-local-badge completed 4 steps',
      expect.objectContaining({
        status: 'completed',
        stage: 'parent-turn-complete',
      }),
    );
  });

  it('rejects unknown workflow ids', async () => {
    await expect(
      runRegisteredBrowserWorkflow({
        workflowId: 'missing',
        context: {
          runId: 'run_missing',
          agentId: 'agent_missing',
          mode: 'unrestricted-dev',
        },
      }),
    ).rejects.toThrow(/Unknown browser workflow/);
  });
});
