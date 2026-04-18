import { CachedPageChunk } from './PageCacheTypes';
export declare function chunkPage(input: {
    pageId: string;
    tabId: string;
    url: string;
    title: string;
    content: string;
    createdAt: number;
}): CachedPageChunk[];
