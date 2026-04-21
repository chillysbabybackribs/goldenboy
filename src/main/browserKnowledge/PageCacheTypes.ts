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
  /**
   * Task id the cached chunk belongs to. Missing on pre-v2 entries loaded from
   * disk, in which case the chunk is only returned by untyped/legacy searches
   * (task-scoped search filters it out to avoid cross-task leakage).
   */
  taskId?: string;
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
  /** See {@link CachedPageChunk.taskId}. */
  taskId?: string;
  /**
   * Pinned pages are exempt from LRU eviction so the model can protect the
   * 2–3 pages a task actually relies on. Set via `browser.pin_page` or the
   * store's {@link PageKnowledgeStore.setPinned} helper.
   */
  pinned?: boolean;
  /**
   * Timestamp stamped on pages whose owning tab has been closed. The page
   * stays searchable ("I just closed that tab, look it up again") but is
   * preferred for eviction ahead of live-tab pages once the LRU cap is hit.
   */
  tabClosedAt?: number;
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
