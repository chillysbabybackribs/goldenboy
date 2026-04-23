import type { AgentToolName } from './AgentTypes';
import type { AgentTaskProfileOverride, TaskPlanMetadata } from '../../shared/types/model';
import {
  buildTaskProfile,
  looksLikeBrowserAutomationTask,
  looksLikeDebugTask,
  looksLikeExecutionEscapePrompt,
  looksLikeImplementationTask,
  looksLikeOrchestrationTask,
  looksLikeResearchTask,
  looksLikeReviewTask,
  looksLikeBrowserSearchTask,
  looksLikeDelegationTask,
  looksLikeLocalCodeTask,
  looksLikeLocalPlanningTask,
  looksLikeScopingPrompt,
  withBrowserSearchDirective as applyBrowserSearchDirective,
} from './taskProfile';

export type RuntimeScope = {
  executionMode: ReturnType<typeof buildTaskProfile>['executionMode'];
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
    executionMode: profile.executionMode,
    skillNames: [...profile.skillNames],
    allowedTools: profile.allowedTools,
    canSpawnSubagents: profile.canSpawnSubagents,
    maxToolTurns: profile.maxToolTurns,
  };
}

export function withBrowserSearchDirective(prompt: string, overrides?: AgentTaskProfileOverride): string {
  return applyBrowserSearchDirective(prompt, overrides);
}

export function withExecutionModeDirective(prompt: string, overrides?: AgentTaskProfileOverride): string {
  const profile = buildTaskProfile(prompt, overrides);
  if (profile.executionMode === 'staged') {
    return [
      'Runtime directive: This work is staged, not single-pass. Before the first write, establish a compact file-level plan and execute in bounded slices with verification between slices.',
      '',
      `User request: ${prompt}`,
    ].join('\n');
  }
  return prompt;
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
  previousUserPrompt?: string | null,
): AgentTaskProfileOverride | undefined {
  if (!looksLikeExecutionEscapePrompt(prompt)) return overrides;

  const inheritedPrompt = previousUserPrompt?.trim() || null;
  const inheritedProfile = inheritedPrompt ? buildTaskProfile(inheritedPrompt) : null;

  if (inheritedProfile?.kind === 'orchestration' || isOrchestrationExecutionReady(orchestrationSnapshot)) {
    return {
      ...overrides,
      kind: 'orchestration',
      executionMode: 'orchestration',
    };
  }

  if (inheritedProfile?.kind === 'implementation' || inheritedProfile?.kind === 'debug') {
    return {
      ...overrides,
      kind: inheritedProfile.kind,
      executionMode: inheritedProfile.executionMode === 'staged' ? 'staged' : 'single-pass',
    };
  }

  return {
    ...overrides,
    executionMode: 'single-pass',
  };
}

export {
  looksLikeBrowserAutomationTask,
  looksLikeDebugTask,
  looksLikeExecutionEscapePrompt,
  looksLikeImplementationTask,
  looksLikeOrchestrationTask,
  looksLikeResearchTask,
  looksLikeReviewTask,
  looksLikeBrowserSearchTask,
  looksLikeDelegationTask,
  looksLikeLocalCodeTask,
  looksLikeLocalPlanningTask,
  looksLikeScopingPrompt,
};
