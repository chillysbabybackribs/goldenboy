import type { AgentToolName } from '../AgentTypes';

export type ToolPackManifest = {
  id: string;
  description: string;
  tools: AgentToolName[];
  baseline4?: AgentToolName[];
  baseline6?: AgentToolName[];
  relatedPackIds?: string[];
  scope?: 'named' | 'all';
};
