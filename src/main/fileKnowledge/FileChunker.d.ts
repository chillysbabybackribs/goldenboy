import { CachedFileChunk } from './FileCacheTypes';
export declare function estimateTokens(text: string): number;
export declare function languageForPath(filePath: string): string;
export declare function chunkFile(input: {
    fileId: string;
    path: string;
    relativePath: string;
    language: string;
    content: string;
    contentHash: string;
    indexedAt: number;
}): CachedFileChunk[];
