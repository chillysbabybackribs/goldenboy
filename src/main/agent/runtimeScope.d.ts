import type { AgentToolName } from './AgentTypes';
import type { AgentTaskProfileOverride } from '../../shared/types/model';
import { looksLikeBrowserAutomationTask, looksLikeDebugTask, looksLikeImplementationTask, looksLikeOrchestrationTask, looksLikeResearchTask, looksLikeReviewTask, looksLikeBrowserSearchTask, looksLikeDelegationTask, looksLikeLocalCodeTask } from './taskProfile';
export type RuntimeScope = {
    skillNames: string[];
    allowedTools: 'all' | AgentToolName[];
    canSpawnSubagents: boolean;
    maxToolTurns: number;
};
export declare function scopeForPrompt(prompt: string, overrides?: AgentTaskProfileOverride): RuntimeScope;
export declare function withBrowserSearchDirective(prompt: string, overrides?: AgentTaskProfileOverride): string;
export { looksLikeBrowserAutomationTask, looksLikeDebugTask, looksLikeImplementationTask, looksLikeOrchestrationTask, looksLikeResearchTask, looksLikeReviewTask, looksLikeBrowserSearchTask, looksLikeDelegationTask, looksLikeLocalCodeTask, };
