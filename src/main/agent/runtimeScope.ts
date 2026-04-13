import type { AgentToolName } from './AgentTypes';
import type { AgentTaskProfileOverride } from '../../shared/types/model';
import {
  buildTaskProfile,
  looksLikeBrowserAutomationTask,
  looksLikeDebugTask,
  looksLikeImplementationTask,
  looksLikeOrchestrationTask,
  looksLikeResearchTask,
  looksLikeReviewTask,
  looksLikeBrowserSearchTask,
  looksLikeDelegationTask,
  looksLikeLocalCodeTask,
  withBrowserSearchDirective as applyBrowserSearchDirective,
} from './taskProfile';

export type RuntimeScope = {
  skillNames: string[];
  allowedTools: 'all' | AgentToolName[];
  canSpawnSubagents: boolean;
  maxToolTurns: number;
};

export function scopeForPrompt(prompt: string, overrides?: AgentTaskProfileOverride): RuntimeScope {
  const profile = buildTaskProfile(prompt, overrides);
  return {
    skillNames: [...profile.skillNames],
    allowedTools: profile.allowedTools,
    canSpawnSubagents: profile.canSpawnSubagents,
    maxToolTurns: profile.maxToolTurns,
  };
}

export function withBrowserSearchDirective(prompt: string, overrides?: AgentTaskProfileOverride): string {
  return applyBrowserSearchDirective(prompt, overrides);
}

export {
  looksLikeBrowserAutomationTask,
  looksLikeDebugTask,
  looksLikeImplementationTask,
  looksLikeOrchestrationTask,
  looksLikeResearchTask,
  looksLikeReviewTask,
  looksLikeBrowserSearchTask,
  looksLikeDelegationTask,
  looksLikeLocalCodeTask,
};
