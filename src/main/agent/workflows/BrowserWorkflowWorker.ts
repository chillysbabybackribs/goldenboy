import type { AgentToolContext, AgentToolResult } from '../AgentTypes';
import { taskMemoryStore } from '../../models/taskMemoryStore';
import { BrowserWorkflowExecutor } from './BrowserWorkflowExecutor';
import type { WorkflowDefinition, WorkflowInputPrimitive, WorkflowRunResult } from './types';

type BrowserWorkflowWorkerDependencies = {
  getWorkflow: (workflowId: string) => WorkflowDefinition | null;
  listWorkflows: () => Array<{
    id: string;
    description: string;
    version: string;
    allowedTools: WorkflowDefinition['allowedTools'];
  }>;
  createExecutor?: () => BrowserWorkflowExecutor;
  recordPlan?: (taskId: string, text: string, metadata: Record<string, unknown>) => void;
};

function isWorkflowInputPrimitive(value: unknown): value is WorkflowInputPrimitive {
  return value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function normalizeWorkflowInputs(input: unknown): Record<string, WorkflowInputPrimitive> {
  if (!input || typeof input !== 'object') return {};
  return Object.entries(input as Record<string, unknown>).reduce<Record<string, WorkflowInputPrimitive>>((acc, [key, value]) => {
    if (isWorkflowInputPrimitive(value)) {
      acc[key] = value;
    }
    return acc;
  }, {});
}

function remainingSteps(workflow: WorkflowDefinition, completedStepIds: string[]): string[] {
  const completed = new Set(completedStepIds);
  return workflow.steps
    .map(step => step.id)
    .filter(stepId => !completed.has(stepId));
}

function buildResultSummary(workflowId: string, result: WorkflowRunResult): string {
  if (result.success) {
    return `Workflow ${workflowId} completed ${result.completedStepIds.length} step${result.completedStepIds.length === 1 ? '' : 's'}`;
  }
  return `Workflow ${workflowId} failed at ${result.failedStepId || 'unknown step'}`;
}

function resultLikeCompletedSteps(
  workflow: WorkflowDefinition,
  checkpointStepId: string,
): string[] {
  const ids: string[] = [];
  for (const step of workflow.steps) {
    ids.push(step.id);
    if (step.id === checkpointStepId) break;
  }
  return ids;
}

export class BrowserWorkflowWorker {
  private readonly getWorkflow: BrowserWorkflowWorkerDependencies['getWorkflow'];

  private readonly listWorkflows: BrowserWorkflowWorkerDependencies['listWorkflows'];

  private readonly createExecutor: () => BrowserWorkflowExecutor;

  private readonly recordPlan: BrowserWorkflowWorkerDependencies['recordPlan'];

  constructor(deps: BrowserWorkflowWorkerDependencies) {
    this.getWorkflow = deps.getWorkflow;
    this.listWorkflows = deps.listWorkflows;
    this.createExecutor = deps.createExecutor ?? (() => new BrowserWorkflowExecutor());
    this.recordPlan = deps.recordPlan ?? ((taskId, text, metadata) => {
      taskMemoryStore.recordPlan(taskId, text, metadata);
    });
  }

  async run(input: {
    workflowId: string;
    workflowInputs?: unknown;
    context: AgentToolContext;
  }): Promise<AgentToolResult> {
    const workflow = this.getWorkflow(input.workflowId);
    if (!workflow) {
      const available = this.listWorkflows().map(item => item.id).join(', ');
      throw new Error(`Unknown browser workflow "${input.workflowId}". Available workflows: ${available || 'none'}.`);
    }

    const workflowInputs = normalizeWorkflowInputs(input.workflowInputs);
    const executor = this.createExecutor();

    this.recordWorkflowPlan(
      input.context.taskId,
      `Workflow ${workflow.id} started`,
      {
        category: 'plan',
        planId: `workflow:${workflow.id}`,
        planName: workflow.id,
        stage: 'scaffold',
        objective: workflow.description,
        nextAction: `Execute ${workflow.steps[0]?.id || 'workflow'}`,
        status: 'running',
        tracks: ['Deterministic browser workflow'],
        validation: ['Respect workflow allowlist and runtime validation for each tool step.'],
      },
    );

    const result = await executor.run(workflow, {
      context: input.context,
      inputs: workflowInputs,
      onHeartbeat: (heartbeat) => {
        input.context.onProgress?.(
          `tool-progress:Browser: run workflow ${workflow.id} -> ${heartbeat.stepId} (retry ${heartbeat.retryCount})`,
        );
      },
      onCheckpoint: (checkpoint) => {
        const completedStepIds = checkpoint.status === 'completed'
          ? [...resultLikeCompletedSteps(workflow, checkpoint.stepId)]
          : [];
        const nextAction = checkpoint.status === 'completed'
          ? remainingSteps(workflow, completedStepIds)[0]
          : checkpoint.stepId;
        this.recordWorkflowPlan(
          input.context.taskId,
          `Workflow ${workflow.id} checkpoint | ${checkpoint.stepId}:${checkpoint.status}`,
          {
            category: 'plan',
            planId: `workflow:${workflow.id}`,
            planName: workflow.id,
            stage: 'checklist-updated',
            objective: workflow.description,
            nextAction: nextAction ? `Execute ${nextAction}` : `Finalize workflow ${workflow.id}`,
            status: checkpoint.status === 'failed' ? 'failed' : 'running',
            findings: checkpoint.summary ? [checkpoint.summary] : [],
            blockers: checkpoint.error ? [checkpoint.error] : [],
          },
        );
      },
      onEscalation: (escalation) => {
        this.recordWorkflowPlan(
          input.context.taskId,
          `Workflow ${workflow.id} escalation | ${escalation.failedStepId}`,
          {
            category: 'plan',
            planId: `workflow:${workflow.id}`,
            planName: workflow.id,
            stage: 'parent-turn-failed',
            objective: workflow.description,
            nextAction: `Investigate failed step ${escalation.failedStepId}`,
            status: 'failed',
            blockers: [escalation.error],
          },
        );
      },
    });

    const finalNextAction = result.success
      ? `Review workflow result for ${workflow.id}`
      : `Investigate failed step ${result.failedStepId || 'unknown'}`;
    this.recordWorkflowPlan(
      input.context.taskId,
      buildResultSummary(workflow.id, result),
      {
        category: 'plan',
        planId: `workflow:${workflow.id}`,
        planName: workflow.id,
        stage: result.success ? 'parent-turn-complete' : 'parent-turn-failed',
        objective: workflow.description,
        nextAction: finalNextAction,
        status: result.success ? 'completed' : 'failed',
        findings: result.success ? [`Completed steps: ${result.completedStepIds.join(', ')}`] : [],
        blockers: result.success || !result.failedStepId ? [] : [`Failed step: ${result.failedStepId}`],
        validation: ['Workflow result grounded in deterministic tool calls.'],
      },
    );

    return {
      summary: buildResultSummary(workflow.id, result),
      data: {
        workflowId: workflow.id,
        workflowVersion: workflow.version,
        success: result.success,
        completedStepIds: result.completedStepIds,
        failedStepId: result.failedStepId,
        checkpointCount: result.checkpoints.length,
        checkpoints: result.checkpoints,
        toolCalls: result.toolCalls,
        lastUrl: result.lastUrl || null,
        stepResults: result.stepResults,
        inputs: workflowInputs,
      },
    };
  }

  private recordWorkflowPlan(
    taskId: string | undefined,
    text: string,
    metadata: Record<string, unknown>,
  ): void {
    if (!taskId) return;
    this.recordPlan?.(taskId, text, metadata);
  }
}
