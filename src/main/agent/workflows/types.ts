import type { AgentToolContext, AgentToolName, AgentToolResult, ValidationStatus } from '../AgentTypes';

export type WorkflowInputPrimitive = string | number | boolean | null;

export type WorkflowFailureMode = 'retry' | 'escalate' | 'stop';

export type WorkflowToolStep = {
  id: string;
  kind: 'tool';
  tool: AgentToolName;
  input: Record<string, unknown>;
  onFailure?: WorkflowFailureMode;
};

export type WorkflowAssertStep = {
  id: string;
  kind: 'assert';
  expression: string;
  onFailure?: WorkflowFailureMode;
};

export type WorkflowStep = WorkflowToolStep | WorkflowAssertStep;

export type WorkflowDefinition = {
  id: string;
  version: string;
  description: string;
  allowedTools: 'all' | AgentToolName[];
  inputs: Record<string, WorkflowInputPrimitive>;
  heartbeat: {
    intervalMs: number;
    include: Array<'step' | 'url' | 'retryCount' | 'lastError'>;
  };
  checkpoint: {
    saveAfterEveryStep: boolean;
  };
  escalation: {
    maxRetriesPerStep: number;
    conditions: string[];
  };
  steps: WorkflowStep[];
};

export type WorkflowExecutionInput = {
  context: AgentToolContext;
  inputs?: Partial<Record<string, WorkflowInputPrimitive>>;
  onHeartbeat?: (heartbeat: WorkflowHeartbeat) => void;
  onCheckpoint?: (checkpoint: WorkflowCheckpoint) => void;
  onEscalation?: (escalation: WorkflowEscalation) => void;
};

export type WorkflowHeartbeat = {
  workflowId: string;
  stepId: string;
  retryCount: number;
  timestamp: number;
  url?: string;
  lastError?: string;
};

export type WorkflowCheckpoint = {
  workflowId: string;
  stepId: string;
  status: 'completed' | 'failed';
  retryCount: number;
  timestamp: number;
  toolName?: AgentToolName;
  summary?: string;
  validationStatus?: ValidationStatus;
  error?: string;
  url?: string;
};

export type WorkflowEscalation = {
  workflowId: string;
  failedStepId: string;
  retryCount: number;
  error: string;
  lastUrl?: string;
  recentToolCalls: WorkflowToolCallRecord[];
};

export type WorkflowToolCallRecord = {
  stepId: string;
  toolName: AgentToolName;
  summary: string;
  validationStatus?: ValidationStatus;
};

export type WorkflowStepResult = {
  kind: WorkflowStep['kind'];
  toolName: AgentToolName;
  summary: string;
  data: Record<string, unknown>;
  validationStatus?: ValidationStatus;
};

export type WorkflowRunResult = {
  workflowId: string;
  success: boolean;
  completedStepIds: string[];
  failedStepId: string | null;
  toolCalls: WorkflowToolCallRecord[];
  checkpoints: WorkflowCheckpoint[];
  lastUrl?: string;
  stepResults: Record<string, WorkflowStepResult>;
};

export type WorkflowToolExecutor = (
  name: AgentToolName,
  input: unknown,
  context: AgentToolContext,
) => Promise<AgentToolResult>;
