import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { cleanPageText } from './PageCleaner';
import { chunkPage } from './PageChunker';
import { CachedPageChunk, CachedPageRecord, PageCacheStats, PageSearchResult } from './PageCacheTypes';

type CacheFile = {
  pages: CachedPageRecord[];
  chunks: CachedPageChunk[];
};

const CACHE_FILE = 'browser-knowledge-cache.json';
const MAX_SNIPPET_CHARS = 420;
const MAX_CACHED_PAGES = 500;
const MAX_CACHED_CHUNKS = 5000;

function cachePath(): string {
  return path.join(app.getPath('userData'), CACHE_FILE);
}

function hashContent(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 16);
}

function normalizeQuery(query: string): string[] {
  return query.toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length >= 2);
}

function pageIdFor(tabId: string, url: string, contentHash: string): string {
  return `page_${hashContent(`${tabId}:${url}:${contentHash}`)}`;
}

export class PageKnowledgeStore {
  private pages = new Map<string, CachedPageRecord>();
  private chunks = new Map<string, CachedPageChunk>();
  private searchCount = 0;
  private searchHitCount = 0;
  private searchMissCount = 0;
  private chunkReadCount = 0;

  constructor() {
    this.load();
  }

  cachePage(input: {
    tabId: string;
    url: string;
    title: string;
    content: string;
    tier: 'semantic' | 'readability';
  }): CachedPageRecord {
    const cleaned = cleanPageText(input.content);
    const contentHash = hashContent(cleaned);
    const pageId = pageIdFor(input.tabId, input.url, contentHash);
    const now = Date.now();

    const chunks = chunkPage({
      pageId,
      tabId: input.tabId,
      url: input.url,
      title: input.title,
      content: cleaned,
      createdAt: now,
    });

    const existingForTab = Array.from(this.pages.values()).filter(page => page.tabId === input.tabId);
    for (const page of existingForTab) {
      for (const chunkId of page.chunkIds) this.chunks.delete(chunkId);
      this.pages.delete(page.id);
    }

    const page: CachedPageRecord = {
      id: pageId,
      tabId: input.tabId,
      url: input.url,
      title: input.title,
      tier: input.tier,
      contentHash,
      chunkIds: chunks.map(chunk => chunk.id),
      headings: Array.from(new Set(chunks.map(chunk => chunk.heading).filter(Boolean))),
      createdAt: now,
      updatedAt: now,
    };

    this.pages.set(page.id, page);
    for (const chunk of chunks) this.chunks.set(chunk.id, chunk);
    this.enforceCacheLimits();
    this.save();
    return { ...page };
  }

  clearAll(): { pageCount: number; chunkCount: number } {
    const pageCount = this.pages.size;
    const chunkCount = this.chunks.size;
    this.pages.clear();
    this.chunks.clear();
    this.searchCount = 0;
    this.searchHitCount = 0;
    this.searchMissCount = 0;
    this.chunkReadCount = 0;
    this.save();
    return { pageCount, chunkCount };
  }

  removePagesForTab(tabId: string): { pageCount: number; chunkCount: number } {
    const pageIds = Array.from(this.pages.values())
      .filter(page => page.tabId === tabId)
      .map(page => page.id);

    let removedChunks = 0;
    for (const pageId of pageIds) {
      const page = this.pages.get(pageId);
      if (!page) continue;
      for (const chunkId of page.chunkIds) {
        if (this.chunks.delete(chunkId)) removedChunks += 1;
      }
      this.pages.delete(pageId);
    }

    if (pageIds.length > 0) {
      this.save();
    }

    return { pageCount: pageIds.length, chunkCount: removedChunks };
  }

  listPages(): CachedPageRecord[] {
    return Array.from(this.pages.values()).map(page => ({ ...page }));
  }

  listSections(pageIdOrTabId: string): Array<{ heading: string; chunkIds: string[]; tokenEstimate: number }> {
    const page = this.resolvePage(pageIdOrTabId);
    if (!page) return [];
    const byHeading = new Map<string, { heading: string; chunkIds: string[]; tokenEstimate: number }>();
    for (const chunkId of page.chunkIds) {
      const chunk = this.chunks.get(chunkId);
      if (!chunk) continue;
      const key = chunk.heading || '(no heading)';
      const entry = byHeading.get(key) || { heading: key, chunkIds: [], tokenEstimate: 0 };
      entry.chunkIds.push(chunk.id);
      entry.tokenEstimate += chunk.tokenEstimate;
      byHeading.set(key, entry);
    }
    return Array.from(byHeading.values());
  }

  search(query: string, input?: { tabId?: string; pageId?: string; limit?: number }): PageSearchResult[] {
    this.searchCount++;
    const terms = normalizeQuery(query);
    if (terms.length === 0) {
      this.searchMissCount++;
      return [];
    }

    const limit = Math.min(input?.limit || 8, 20);
    const chunks = Array.from(this.chunks.values()).filter(chunk => {
      if (input?.tabId && chunk.tabId !== input.tabId) return false;
      if (input?.pageId && chunk.pageId !== input.pageId) return false;
      return true;
    });

    const results = chunks
      .map(chunk => {
        const haystack = `${chunk.title} ${chunk.heading} ${chunk.text}`.toLowerCase();
        let score = 0;
        for (const term of terms) {
          const matches = haystack.split(term).length - 1;
          score += matches;
          if (chunk.heading.toLowerCase().includes(term)) score += 3;
          if (chunk.title.toLowerCase().includes(term)) score += 2;
        }
        return { chunk, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(item => ({
        chunkId: item.chunk.id,
        pageId: item.chunk.pageId,
        tabId: item.chunk.tabId,
        url: item.chunk.url,
        title: item.chunk.title,
        heading: item.chunk.heading,
        snippet: makeSnippet(item.chunk.text, terms),
        score: item.score,
        tokenEstimate: item.chunk.tokenEstimate,
      }));
    if (results.length > 0) this.searchHitCount++;
    else this.searchMissCount++;
    return results;
  }

  readChunk(chunkId: string, maxChars = 2400): CachedPageChunk | null {
    const chunk = this.chunks.get(chunkId);
    if (!chunk) return null;
    this.chunkReadCount++;
    return {
      ...chunk,
      text: chunk.text.length > maxChars ? `${chunk.text.slice(0, maxChars)}\n...[chunk truncated]` : chunk.text,
    };
  }

  answerFromCache(question: string, input?: { tabId?: string; pageId?: string; limit?: number }): {
    question: string;
    answerable: boolean;
    matches: PageSearchResult[];
    suggestedChunkIds: string[];
    tokenEstimate: number;
  } {
    const matches = this.search(question, input);
    return {
      question,
      answerable: matches.length > 0,
      matches,
      suggestedChunkIds: matches.slice(0, 4).map(match => match.chunkId),
      tokenEstimate: matches.reduce((sum, match) => sum + Math.min(match.tokenEstimate, 120), 0),
    };
  }

  getStats(): PageCacheStats {
    const pages = Array.from(this.pages.values());
    const chunks = Array.from(this.chunks.values());
    const lastCached = pages.sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
    return {
      pageCount: pages.length,
      chunkCount: chunks.length,
      totalTokenEstimate: chunks.reduce((sum, chunk) => sum + chunk.tokenEstimate, 0),
      lastCachedPage: lastCached ? {
        id: lastCached.id,
        tabId: lastCached.tabId,
        url: lastCached.url,
        title: lastCached.title,
        updatedAt: lastCached.updatedAt,
      } : null,
      searchCount: this.searchCount,
      searchHitCount: this.searchHitCount,
      searchMissCount: this.searchMissCount,
      chunkReadCount: this.chunkReadCount,
    };
  }

  private resolvePage(pageIdOrTabId: string): CachedPageRecord | null {
    const byId = this.pages.get(pageIdOrTabId);
    if (byId) return byId;
    return Array.from(this.pages.values()).find(page => page.tabId === pageIdOrTabId) || null;
  }

  private load(): void {
    try {
      const filePath = cachePath();
      if (!fs.existsSync(filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CacheFile;
      for (const page of parsed.pages || []) this.pages.set(page.id, page);
      for (const chunk of parsed.chunks || []) this.chunks.set(chunk.id, chunk);
    } catch {
      this.pages.clear();
      this.chunks.clear();
    }
  }

  private enforceCacheLimits(): void {
    let pages = Array.from(this.pages.values());
    if (pages.length <= MAX_CACHED_PAGES && this.chunks.size <= MAX_CACHED_CHUNKS) return;

    pages = pages.sort((a, b) => a.updatedAt - b.updatedAt);
    while (pages.length > MAX_CACHED_PAGES || this.chunks.size > MAX_CACHED_CHUNKS) {
      const oldest = pages.shift();
      if (!oldest) break;
      for (const chunkId of oldest.chunkIds) {
        this.chunks.delete(chunkId);
      }
      this.pages.delete(oldest.id);
    }
  }

  private save(): void {
    const filePath = cachePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const payload: CacheFile = {
      pages: Array.from(this.pages.values()),
      chunks: Array.from(this.chunks.values()),
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  }
}

function makeSnippet(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  const positions = terms
    .map(term => lower.indexOf(term))
    .filter(index => index >= 0);
  const first = positions.length > 0 ? Math.min(...positions) : 0;
  const start = Math.max(0, first - 140);
  const snippet = text.slice(start, start + MAX_SNIPPET_CHARS).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '...' : ''}${snippet}${start + MAX_SNIPPET_CHARS < text.length ? '...' : ''}`;
}

export const pageKnowledgeStore = new PageKnowledgeStore();
