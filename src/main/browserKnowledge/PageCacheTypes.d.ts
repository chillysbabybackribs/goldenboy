export type CachedPageChunk = {
    id: string;
    pageId: string;
    tabId: string;
    url: string;
    title: string;
    heading: string;
    text: string;
    ordinal: number;
    tokenEstimate: number;
    createdAt: number;
};
export type CachedPageRecord = {
    id: string;
    tabId: string;
    url: string;
    title: string;
    tier: 'semantic' | 'readability';
    contentHash: string;
    chunkIds: string[];
    headings: string[];
    createdAt: number;
    updatedAt: number;
};
export type PageSearchResult = {
    chunkId: string;
    pageId: string;
    tabId: string;
    url: string;
    title: string;
    heading: string;
    snippet: string;
    score: number;
    tokenEstimate: number;
};
export type PageCacheStats = {
    pageCount: number;
    chunkCount: number;
    totalTokenEstimate: number;
    lastCachedPage: {
        id: string;
        tabId: string;
        url: string;
        title: string;
        updatedAt: number;
    } | null;
    searchCount: number;
    searchHitCount: number;
    searchMissCount: number;
    chunkReadCount: number;
};
