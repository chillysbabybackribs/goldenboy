import { describe, expect, it, vi } from 'vitest';

import type { WorkflowDefinition, WorkflowExecutionInput, WorkflowRunResult } from './types';
import { BrowserWorkflowWorker } from './BrowserWorkflowWorker';

const workflow: WorkflowDefinition = {
  id: 'test-worker-workflow',
  version: '1.0.0',
  description: 'Test deterministic workflow worker',
  allowedTools: ['browser.navigate'],
  inputs: {
    url: 'https://example.com/',
    label: 'DEFAULT',
  },
  heartbeat: {
    intervalMs: 1000,
    include: ['step', 'url', 'retryCount'],
  },
  checkpoint: {
    saveAfterEveryStep: true,
  },
  escalation: {
    maxRetriesPerStep: 1,
    conditions: ['unexpected_layout_change'],
  },
  steps: [
    {
      id: 'open_page',
      kind: 'tool',
      tool: 'browser.navigate',
      input: { url: '{{inputs.url}}' },
      onFailure: 'retry',
    },
  ],
};

describe('BrowserWorkflowWorker', () => {
  it('runs a registered workflow, emits progress, and records plan milestones', async () => {
    const recordPlan = vi.fn();
    const runExecutor = vi.fn(async (_workflow: WorkflowDefinition, executionInput: WorkflowExecutionInput): Promise<WorkflowRunResult> => {
      executionInput.onHeartbeat?.({
        workflowId: workflow.id,
        stepId: 'open_page',
        retryCount: 0,
        timestamp: 1,
      });
      executionInput.onCheckpoint?.({
        workflowId: workflow.id,
        stepId: 'open_page',
        status: 'completed',
        retryCount: 0,
        timestamp: 2,
        toolName: 'browser.navigate',
        summary: 'navigated',
        url: 'https://example.com/',
      });
      return {
        workflowId: workflow.id,
        success: true,
        completedStepIds: ['open_page'],
        failedStepId: null,
        checkpoints: [],
        toolCalls: [],
        lastUrl: 'https://example.com/',
        stepResults: {
          open_page: {
            kind: 'tool',
            toolName: 'browser.navigate',
            summary: 'navigated',
            data: { url: 'https://example.com/' },
          },
        },
      };
    });
    const worker = new BrowserWorkflowWorker({
      getWorkflow: (workflowId) => workflowId === workflow.id ? workflow : null,
      listWorkflows: () => [{
        id: workflow.id,
        description: workflow.description,
        version: workflow.version,
        allowedTools: workflow.allowedTools,
      }],
      createExecutor: () => ({ run: runExecutor } as unknown as import('./BrowserWorkflowExecutor').BrowserWorkflowExecutor),
      recordPlan,
    });
    const onProgress = vi.fn();

    const result = await worker.run({
      workflowId: workflow.id,
      workflowInputs: { label: 'TESTED' },
      context: {
        runId: 'run_worker',
        agentId: 'agent_worker',
        mode: 'unrestricted-dev',
        taskId: 'task_worker',
        onProgress,
      },
    });

    expect(runExecutor).toHaveBeenCalled();
    expect(onProgress).toHaveBeenCalledWith(
      'tool-progress:Browser: run workflow test-worker-workflow -> open_page (retry 0)',
    );
    expect(recordPlan).toHaveBeenCalledWith(
      'task_worker',
      'Workflow test-worker-workflow started',
      expect.objectContaining({
        planId: 'workflow:test-worker-workflow',
        status: 'running',
      }),
    );
    expect(recordPlan).toHaveBeenLastCalledWith(
      'task_worker',
      'Workflow test-worker-workflow completed 1 step',
      expect.objectContaining({
        status: 'completed',
        stage: 'parent-turn-complete',
      }),
    );
    expect(result).toMatchObject({
      summary: 'Workflow test-worker-workflow completed 1 step',
      data: {
        workflowId: workflow.id,
        success: true,
        inputs: { label: 'TESTED' },
        lastUrl: 'https://example.com/',
        stepResults: {
          open_page: {
            kind: 'tool',
            toolName: 'browser.navigate',
            summary: 'navigated',
            data: { url: 'https://example.com/' },
          },
        },
      },
    });
  });

  it('rejects unknown workflow ids with the registered list in the error', async () => {
    const worker = new BrowserWorkflowWorker({
      getWorkflow: () => null,
      listWorkflows: () => [{
        id: workflow.id,
        description: workflow.description,
        version: workflow.version,
        allowedTools: workflow.allowedTools,
      }],
    });

    await expect(worker.run({
      workflowId: 'missing-workflow',
      context: {
        runId: 'run_missing',
        agentId: 'agent_missing',
        mode: 'unrestricted-dev',
      },
    })).rejects.toThrow('Unknown browser workflow "missing-workflow". Available workflows: test-worker-workflow.');
  });
});
