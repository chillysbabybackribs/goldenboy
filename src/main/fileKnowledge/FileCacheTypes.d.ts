export type CachedFileChunk = {
    id: string;
    fileId: string;
    path: string;
    relativePath: string;
    language: string;
    startLine: number;
    endLine: number;
    ordinal: number;
    charCount: number;
    tokenEstimate: number;
    contentHash: string;
    indexedAt: number;
    text?: string;
};
export type CachedFileRecord = {
    id: string;
    path: string;
    relativePath: string;
    language: string;
    contentHash: string;
    sizeBytes: number;
    mtimeMs: number;
    chunkIds: string[];
    indexedAt: number;
};
export type FileSearchResult = {
    chunkId: string;
    fileId: string;
    path: string;
    relativePath: string;
    language: string;
    startLine: number;
    endLine: number;
    snippet: string;
    score: number;
    tokenEstimate: number;
};
export type FileCacheAnswer = {
    query: string;
    answer: string;
    sources: FileSearchResult[];
    tokenEstimate: number;
};
export type FileCacheStats = {
    fileCount: number;
    chunkCount: number;
    totalTokenEstimate: number;
    indexedAt: number | null;
    searchCount: number;
    searchHitCount: number;
    searchMissCount: number;
    chunkReadCount: number;
};
