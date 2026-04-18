import { CachedFileChunk, CachedFileRecord, FileCacheAnswer, FileCacheStats, FileSearchResult } from './FileCacheTypes';
type ReadWindowResult = {
    path: string;
    relativePath: string;
    content: string;
    truncated: boolean;
    startLine: number;
    endLine: number;
    totalLines: number;
    chunkCount: number;
};
export declare class FileKnowledgeStore {
    private files;
    private chunks;
    private indexedAt;
    private searchCount;
    private searchHitCount;
    private searchMissCount;
    private chunkReadCount;
    constructor();
    indexWorkspace(root?: string, input?: {
        limit?: number;
    }): {
        indexedFiles: number;
        chunkCount: number;
        skippedFiles: number;
        indexedAt: number;
    };
    listFiles(input?: {
        limit?: number;
    }): CachedFileRecord[];
    search(query: string, input?: {
        pathPrefix?: string;
        language?: string;
        limit?: number;
    }): FileSearchResult[];
    answerFromCache(query: string, input?: {
        pathPrefix?: string;
        language?: string;
        limit?: number;
    }): FileCacheAnswer;
    readChunk(chunkId: string, maxChars?: number): CachedFileChunk | null;
    readWindowForPath(filePath: string, input?: {
        startLine?: number;
        endLine?: number;
        maxChars?: number;
    }): ReadWindowResult | null;
    getFreshChunksForPath(filePath: string): CachedFileChunk[] | null;
    refreshFile(filePath: string, root?: string): {
        record: CachedFileRecord;
        chunks: CachedFileChunk[];
        reused: boolean;
    } | null;
    removeFile(filePath: string): boolean;
    removePathTree(filePath: string): number;
    getStats(): FileCacheStats;
    private load;
    private save;
    private buildRecord;
    private cloneExistingRecord;
    private replaceRecord;
    private deleteRecord;
    private findRecordByPath;
    private findFreshRecordByPath;
    private resolveFreshChunk;
    private findChunkForLine;
    private findChunkByOrdinal;
    private selectChunksForWindow;
    private scoreMatch;
    private runSearch;
    private runRipgrep;
    private fallbackSearchCandidates;
}
export declare const fileKnowledgeStore: FileKnowledgeStore;
export {};
