import { CachedPageChunk, CachedPageRecord, PageCacheStats, PageSearchResult } from './PageCacheTypes';
export declare class PageKnowledgeStore {
    private pages;
    private chunks;
    private searchCount;
    private searchHitCount;
    private searchMissCount;
    private chunkReadCount;
    constructor();
    cachePage(input: {
        tabId: string;
        url: string;
        title: string;
        content: string;
        tier: 'semantic' | 'readability';
    }): CachedPageRecord;
    clearAll(): {
        pageCount: number;
        chunkCount: number;
    };
    removePagesForTab(tabId: string): {
        pageCount: number;
        chunkCount: number;
    };
    listPages(): CachedPageRecord[];
    listSections(pageIdOrTabId: string): Array<{
        heading: string;
        chunkIds: string[];
        tokenEstimate: number;
    }>;
    search(query: string, input?: {
        tabId?: string;
        pageId?: string;
        limit?: number;
    }): PageSearchResult[];
    readChunk(chunkId: string, maxChars?: number): CachedPageChunk | null;
    answerFromCache(question: string, input?: {
        tabId?: string;
        pageId?: string;
        limit?: number;
    }): {
        question: string;
        answerable: boolean;
        matches: PageSearchResult[];
        suggestedChunkIds: string[];
        tokenEstimate: number;
    };
    getStats(): PageCacheStats;
    private resolvePage;
    private load;
    private enforceCacheLimits;
    private save;
}
export declare const pageKnowledgeStore: PageKnowledgeStore;
