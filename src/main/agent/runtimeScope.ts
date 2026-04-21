import type { AgentToolName } from './AgentTypes';
import type { AgentTaskProfileOverride, TaskPlanMetadata } from '../../shared/types/model';
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

export type OrchestrationPlanSnapshot = {
  latestStage: TaskPlanMetadata['stage'] | null;
  runningSubagents: Array<{ role: string; task: string; subagentId: string }>;
  blockedSubagents: Array<{ role: string; task: string; blockers: string[] }>;
  completedSubagents: Array<{ role: string; task: string }>;
  nextAction: string | null;
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

export function isOrchestrationExecutionReady(
  snapshot: OrchestrationPlanSnapshot | null | undefined,
): boolean {
  if (!snapshot) return false;
  if (snapshot.latestStage && snapshot.latestStage !== 'scaffold') return true;
  if (snapshot.runningSubagents.length > 0) return true;
  if (snapshot.blockedSubagents.length > 0) return true;
  if (snapshot.completedSubagents.length > 0) return true;
  return Boolean(snapshot.nextAction?.trim());
}

export function applyAdaptiveTaskProfileOverride(
  prompt: string,
  overrides?: AgentTaskProfileOverride,
  orchestrationSnapshot?: OrchestrationPlanSnapshot | null,
): AgentTaskProfileOverride | undefined {
  void prompt;
  void orchestrationSnapshot;
  return overrides;
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
