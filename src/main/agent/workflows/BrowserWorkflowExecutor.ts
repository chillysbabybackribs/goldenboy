import { agentToolExecutor } from '../AgentToolExecutor';
import type { AgentToolName, AgentToolResult } from '../AgentTypes';
import type {
  WorkflowCheckpoint,
  WorkflowDefinition,
  WorkflowEscalation,
  WorkflowExecutionInput,
  WorkflowFailureMode,
  WorkflowRunResult,
  WorkflowStepResult,
  WorkflowStep,
  WorkflowToolCallRecord,
  WorkflowToolExecutor,
  WorkflowInputPrimitive,
} from './types';

const EXACT_TEMPLATE_RE = /^{{\s*([^{}]+?)\s*}}$/;
const TEMPLATE_RE = /{{\s*([^{}]+?)\s*}}/g;

function lookupPath(root: unknown, path: string[]): unknown {
  let current = root;
  for (const segment of path) {
    if (current == null) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function stringifyTemplateValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function resolveTemplateReference(
  reference: string,
  inputs: Record<string, WorkflowInputPrimitive>,
  stepResults: Record<string, WorkflowStepResult>,
): unknown {
  const trimmed = reference.trim();
  if (trimmed.startsWith('inputs.')) {
    return lookupPath(inputs, trimmed.slice('inputs.'.length).split('.'));
  }
  if (trimmed.startsWith('steps.')) {
    const path = trimmed.slice('steps.'.length).split('.');
    const [stepId, ...rest] = path;
    if (!stepId) return undefined;
    return lookupPath(stepResults[stepId], rest);
  }
  return undefined;
}

function renderTemplateString(
  template: string,
  inputs: Record<string, WorkflowInputPrimitive>,
  stepResults: Record<string, WorkflowStepResult>,
): unknown {
  const exactMatch = template.match(EXACT_TEMPLATE_RE);
  if (exactMatch) {
    return resolveTemplateReference(exactMatch[1], inputs, stepResults) ?? null;
  }

  return template.replace(TEMPLATE_RE, (_match, reference: string) => {
    const value = resolveTemplateReference(reference, inputs, stepResults);
    return stringifyTemplateValue(value);
  });
}

function renderValue(
  value: unknown,
  inputs: Record<string, WorkflowInputPrimitive>,
  stepResults: Record<string, WorkflowStepResult>,
): unknown {
  if (typeof value === 'string') return renderTemplateString(value, inputs, stepResults);
  if (Array.isArray(value)) return value.map(item => renderValue(item, inputs, stepResults));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, renderValue(nested, inputs, stepResults)]),
    );
  }
  return value;
}

function findUrl(result: AgentToolResult | undefined): string | undefined {
  const data = result?.data as Record<string, unknown> | undefined;
  if (!data) return undefined;
  const directUrl = data.url;
  if (typeof directUrl === 'string' && directUrl.trim()) return directUrl;
  const navigation = data.navigation;
  if (navigation && typeof navigation === 'object') {
    const navUrl = (navigation as Record<string, unknown>).url;
    if (typeof navUrl === 'string' && navUrl.trim()) return navUrl;
  }
  return undefined;
}

function failureModeForStep(step: WorkflowStep): WorkflowFailureMode {
  return step.onFailure ?? 'escalate';
}

function assertSucceeded(result: AgentToolResult, stepId: string): void {
  const data = result.data as Record<string, unknown> | undefined;
  const error = data?.error;
  if (typeof error === 'string' && error.trim()) {
    throw new Error(`Assertion JavaScript failed for ${stepId}: ${error}`);
  }
  if (!Boolean(data?.result)) {
    throw new Error(`Assertion failed: ${stepId}`);
  }
}

type BrowserWorkflowExecutorOptions = {
  executeTool?: WorkflowToolExecutor;
  now?: () => number;
};

export class BrowserWorkflowExecutor {
  private readonly executeTool: WorkflowToolExecutor;

  private readonly now: () => number;

  constructor(options: BrowserWorkflowExecutorOptions = {}) {
    this.executeTool = options.executeTool ?? ((name, input, context) => agentToolExecutor.execute(name, input, context));
    this.now = options.now ?? (() => Date.now());
  }

  async run(workflow: WorkflowDefinition, input: WorkflowExecutionInput): Promise<WorkflowRunResult> {
    const mergedInputs: Record<string, WorkflowInputPrimitive> = { ...workflow.inputs };
    for (const [key, value] of Object.entries(input.inputs ?? {})) {
      if (value !== undefined) mergedInputs[key] = value;
    }

    if (workflow.allowedTools !== 'all') {
      for (const step of workflow.steps) {
        if (step.kind === 'tool' && !workflow.allowedTools.includes(step.tool)) {
          throw new Error(`Workflow ${workflow.id} step ${step.id} uses disallowed tool ${step.tool}`);
        }
      }
    }

    const completedStepIds: string[] = [];
    const checkpoints: WorkflowCheckpoint[] = [];
    const toolCalls: WorkflowToolCallRecord[] = [];
    const stepResults: Record<string, WorkflowStepResult> = {};
    let lastUrl: string | undefined;

    for (const step of workflow.steps) {
      const failureMode = failureModeForStep(step);
      let retryCount = 0;

      while (true) {
        input.onHeartbeat?.({
          workflowId: workflow.id,
          stepId: step.id,
          retryCount,
          timestamp: this.now(),
          url: lastUrl,
        });

        try {
          if (step.kind === 'tool') {
            const renderedInput = renderValue(step.input, mergedInputs, stepResults);
            const result = await this.executeTool(step.tool, renderedInput, input.context);
            lastUrl = findUrl(result) ?? lastUrl;

            if (result.validation?.status === 'INVALID') {
              throw new Error(`Tool validation failed for ${step.id}: ${result.validation.summary}`);
            }

            stepResults[step.id] = {
              kind: step.kind,
              toolName: step.tool,
              summary: result.summary,
              data: result.data,
              validationStatus: result.validation?.status,
            };

            toolCalls.push({
              stepId: step.id,
              toolName: step.tool,
              summary: result.summary,
              validationStatus: result.validation?.status,
            });

            if (workflow.checkpoint.saveAfterEveryStep) {
              const checkpoint: WorkflowCheckpoint = {
                workflowId: workflow.id,
                stepId: step.id,
                status: 'completed',
                retryCount,
                timestamp: this.now(),
                toolName: step.tool,
                summary: result.summary,
                validationStatus: result.validation?.status,
                url: lastUrl,
              };
              checkpoints.push(checkpoint);
              input.onCheckpoint?.(checkpoint);
            }
          } else {
            const renderedExpression = renderValue(step.expression, mergedInputs, stepResults);
            if (typeof renderedExpression !== 'string') {
              throw new Error(`Rendered assertion expression for ${step.id} must be a string`);
            }
            const result = await this.executeTool(
              'browser.evaluate_js',
              { expression: renderedExpression },
              input.context,
            );
            lastUrl = findUrl(result) ?? lastUrl;
            assertSucceeded(result, step.id);

            stepResults[step.id] = {
              kind: step.kind,
              toolName: 'browser.evaluate_js',
              summary: result.summary,
              data: result.data,
              validationStatus: result.validation?.status,
            };

            toolCalls.push({
              stepId: step.id,
              toolName: 'browser.evaluate_js',
              summary: result.summary,
              validationStatus: result.validation?.status,
            });

            if (workflow.checkpoint.saveAfterEveryStep) {
              const checkpoint: WorkflowCheckpoint = {
                workflowId: workflow.id,
                stepId: step.id,
                status: 'completed',
                retryCount,
                timestamp: this.now(),
                toolName: 'browser.evaluate_js',
                summary: result.summary,
                validationStatus: result.validation?.status,
                url: lastUrl,
              };
              checkpoints.push(checkpoint);
              input.onCheckpoint?.(checkpoint);
            }
          }

          completedStepIds.push(step.id);
          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const failedCheckpoint: WorkflowCheckpoint = {
            workflowId: workflow.id,
            stepId: step.id,
            status: 'failed',
            retryCount,
            timestamp: this.now(),
            error: message,
            url: lastUrl,
          };
          checkpoints.push(failedCheckpoint);
          input.onCheckpoint?.(failedCheckpoint);

          if (failureMode === 'retry' && retryCount < workflow.escalation.maxRetriesPerStep) {
            retryCount += 1;
            continue;
          }

          if (failureMode === 'escalate') {
            const escalation: WorkflowEscalation = {
              workflowId: workflow.id,
              failedStepId: step.id,
              retryCount,
              error: message,
              lastUrl,
              recentToolCalls: toolCalls.slice(-5),
            };
            input.onEscalation?.(escalation);
          }

          return {
            workflowId: workflow.id,
            success: false,
            completedStepIds,
            failedStepId: step.id,
            toolCalls,
            checkpoints,
            lastUrl,
            stepResults,
          };
        }
      }
    }

    return {
      workflowId: workflow.id,
      success: true,
      completedStepIds,
      failedStepId: null,
      toolCalls,
      checkpoints,
      lastUrl,
      stepResults,
    };
  }
}
