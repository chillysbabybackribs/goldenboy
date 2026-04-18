import type { AgentTaskKind, ProviderId } from '../../shared/types/model';
export declare const NO_MATERIAL_RESEARCH_UPDATE = "NO_MATERIAL_UPDATE";
export declare function shouldRunBackgroundResearchSynthesis(input: {
    prompt: string;
    taskKind: AgentTaskKind;
    primaryProviderId: ProviderId;
    synthesisProviderAvailable: boolean;
}): boolean;
export declare function looksLikeComplexResearchPrompt(prompt: string): boolean;
export declare function buildBackgroundResearchSynthesisTask(options?: {
    groundedEvidenceReasoning?: boolean;
}): string;
export declare function buildBackgroundResearchSynthesisContext(input: {
    prompt: string;
    fastAnswer: string;
    threadSummary: string | null;
    evidenceTranscript: string;
    groundedResearchContext?: string | null;
}): string;
export declare function formatBackgroundResearchSynthesis(output: string): string;
export declare function backgroundResearchSynthesisProviderId(): ProviderId;
