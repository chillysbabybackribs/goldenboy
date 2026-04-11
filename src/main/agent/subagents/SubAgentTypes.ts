import { AgentMode, AgentToolName } from '../AgentTypes';

export type SubAgentStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type SubAgentSpawnInput = {
  task: string;
  taskId?: string;
  role?: string;
  mode?: AgentMode;
  inheritedContext?: 'full' | 'summary' | 'none';
  allowedTools?: 'all' | AgentToolName[];
  canSpawnSubagents?: boolean;
};

export type SubAgentRecord = {
  id: string;
  parentRunId: string;
  runId: string | null;
  role: string;
  task: string;
  mode: AgentMode;
  status: SubAgentStatus;
  createdAt: number;
  completedAt: number | null;
  summary: string | null;
  error: string | null;
};

export type SubAgentResult = {
  id: string;
  status: SubAgentStatus;
  summary: string;
  findings: string[];
  changedFiles: string[];
};

export type SubAgentWaitInput = {
  id: string;
  timeoutMs?: number;
};
