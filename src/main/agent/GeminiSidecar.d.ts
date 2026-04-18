export type SearchRankInput = {
    index: number;
    title: string;
    url: string;
    snippet: string;
};
export type EvidenceJudgeInput = {
    query: string;
    title: string;
    url: string;
    summary: string;
    keyFacts: string[];
    snippets: string[];
};
export type EvidenceJudgeResult = {
    sufficient: boolean;
    score: number;
    reasons: string[];
    compactEvidence: string[];
};
export declare class GeminiSidecar {
    private readonly apiKey;
    private readonly models;
    constructor();
    isConfigured(): boolean;
    rankSearchResults(query: string, results: SearchRankInput[]): Promise<{
        results: SearchRankInput[];
        modelId: string | null;
        reason: string | null;
    }>;
    judgeEvidence(input: EvidenceJudgeInput): Promise<(EvidenceJudgeResult & {
        modelId: string;
    }) | null>;
    private generateJson;
}
export declare const geminiSidecar: GeminiSidecar;
