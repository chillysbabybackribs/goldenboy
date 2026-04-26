import type { WorkflowDefinition } from './types';
import type { AgentToolContext, AgentToolResult } from '../AgentTypes';
import { BrowserWorkflowWorker } from './BrowserWorkflowWorker';
import { browserAutomationResearchWorkflow } from './examples/browserAutomationResearchWorkflow';
import { yahooLocalBadgeWorkflow } from './examples/yahooLocalBadgeWorkflow';

const REGISTERED_BROWSER_WORKFLOWS = new Map<string, WorkflowDefinition>([
  [browserAutomationResearchWorkflow.id, browserAutomationResearchWorkflow],
  [yahooLocalBadgeWorkflow.id, yahooLocalBadgeWorkflow],
]);

export function listRegisteredBrowserWorkflows(): Array<{
  id: string;
  description: string;
  version: string;
  allowedTools: WorkflowDefinition['allowedTools'];
}> {
  return Array.from(REGISTERED_BROWSER_WORKFLOWS.values()).map((workflow) => ({
    id: workflow.id,
    description: workflow.description,
    version: workflow.version,
    allowedTools: workflow.allowedTools,
  }));
}

export function getRegisteredBrowserWorkflow(workflowId: string): WorkflowDefinition | null {
  return REGISTERED_BROWSER_WORKFLOWS.get(workflowId) || null;
}

const browserWorkflowWorker = new BrowserWorkflowWorker({
  getWorkflow: getRegisteredBrowserWorkflow,
  listWorkflows: listRegisteredBrowserWorkflows,
});

export async function runRegisteredBrowserWorkflow(input: {
  workflowId: string;
  workflowInputs?: unknown;
  context: AgentToolContext;
}): Promise<AgentToolResult> {
  return browserWorkflowWorker.run(input);
}
