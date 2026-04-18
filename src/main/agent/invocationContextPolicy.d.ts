import type { AgentTaskKind } from '../../shared/types/model';
export declare function looksLikeContextDependentPrompt(prompt: string): boolean;
export declare function shouldIncludeConversationContext(input: {
    prompt: string;
    hasPriorConversation: boolean;
    isContinuation: boolean;
}): boolean;
export declare function shouldIncludeTaskMemoryContext(input: {
    prompt: string;
    taskKind: AgentTaskKind;
    hasPriorTaskMemory: boolean;
    isContinuation: boolean;
    lastInvocationFailed: boolean;
}): boolean;
export declare function shouldIncludeArtifactContext(input: {
    prompt: string;
    taskKind: AgentTaskKind;
    hasArtifacts: boolean;
}): boolean;
export declare function contextPromptBudgetForTaskKind(taskKind: AgentTaskKind): number;
