import type { SearchResultCandidate, PageEvidence } from '../browser/BrowserPageAnalysis';
import type { AgentTaskKind } from '../../shared/types/model';
import type { AgentToolName } from './AgentTypes';
import type { ArtifactRoutingDecision } from './artifactRouting';
export declare const MIN_RESEARCH_DOMAINS = 3;
export type GroundedResearchSource = {
    url: string;
    domain: string;
    title: string;
};
export type ExtractedResearchData = {
    source: GroundedResearchSource;
    claims: string[];
    metrics: string[];
    definitions: string[];
    timestamps: string[];
};
export type ValidatedResearchClaim = {
    claim: string;
    support: GroundedResearchSource[];
    metrics: string[];
    timestamps: string[];
    verification: 'single-source' | 'multi-source';
    confidenceScore: number;
    confidenceLabel: 'low' | 'medium' | 'high';
    agreementLevel: 'multi_source' | 'single_source' | 'conflicted';
    conflictIds?: string[];
};
export type ResearchConflict = {
    id: string;
    skeleton: string;
    claims: Array<{
        claim: string;
        source: GroundedResearchSource;
    }>;
};
export type ResearchContext = {
    query: string;
    minimumDomainCount: number;
    sources: GroundedResearchSource[];
    extractedData: ExtractedResearchData[];
    validatedClaims: ValidatedResearchClaim[];
    conflicts: ResearchConflict[];
    discardedSources: GroundedResearchSource[];
    verificationLevel: 'generated' | 'grounded' | 'multi-source-verified';
    domainCount: number;
    isSufficient: boolean;
    failureReason: string | null;
};
export type ResearchBrowserAdapter = {
    searchWeb(query: string): Promise<{
        searchTabId: string;
        results: SearchResultCandidate[];
    }>;
    openPage(url: string): Promise<{
        evidence: PageEvidence | null;
    }>;
    restoreSearchTab(tabId: string): Promise<void>;
};
export declare function buildExtractedResearchData(source: GroundedResearchSource, evidence: Pick<PageEvidence, 'summary' | 'keyFacts' | 'dates'>): ExtractedResearchData;
export declare function validateExtractedResearchData(extractedData: ExtractedResearchData[]): {
    validatedClaims: ValidatedResearchClaim[];
    conflicts: ResearchConflict[];
    discardedSources: GroundedResearchSource[];
    verificationLevel: ResearchContext['verificationLevel'];
};
export declare function shouldUseGroundedResearchPipeline(input: {
    prompt: string;
    taskKind: AgentTaskKind;
    artifactDecision: ArtifactRoutingDecision | null;
}): boolean;
export declare function runGroundedResearchPipeline(input: {
    prompt: string;
    taskId?: string;
    minDomains?: number;
    browserAdapter?: ResearchBrowserAdapter;
}): Promise<ResearchContext>;
export declare function buildResearchContextPrompt(context: ResearchContext): string;
export declare function withGroundedResearchAllowedTools(allowedTools: 'all' | AgentToolName[], context: ResearchContext | null, fullToolCatalogNames?: AgentToolName[]): 'all' | AgentToolName[];
export declare function buildGroundedResearchSystemInstructions(context: ResearchContext | null): string | null;
