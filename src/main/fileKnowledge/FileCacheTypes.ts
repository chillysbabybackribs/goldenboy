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

export type FileSymbolSummary = {
  exports: string[];
  imports: string[];
  registrations: string[];
};

export type FileUsageStats = {
  readCount: number;
  searchHitCount: number;
  patchCount: number;
  lastAccessedAt: number | null;
  heatScore: number;
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
  summary: string;
  symbols: FileSymbolSummary;
  usage: FileUsageStats;
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
  summary: string;
  symbols: FileSymbolSummary;
  usage: FileUsageStats;
  contentHash: string;
  freshness: 'fresh' | 'stale';
};

export type FileCacheAnswer = {
  query: string;
  answer: string;
  sources: FileSearchResult[];
  tokenEstimate: number;
};

export type DirectoryHeatRecord = {
  path: string;
  fileCount: number;
  readCount: number;
  searchHitCount: number;
  patchCount: number;
  lastAccessedAt: number | null;
  heatScore: number;
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
  directoryCount: number;
  hottestDirectories: DirectoryHeatRecord[];
  hottestFiles: Array<{
    path: string;
    heatScore: number;
    lastAccessedAt: number | null;
  }>;
};
