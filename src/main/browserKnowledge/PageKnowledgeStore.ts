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

type SearchablePageChunk = CachedPageChunk & {
  searchText: string;
  titleLower: string;
  headingLower: string;
};

const CACHE_FILE = 'browser-knowledge-cache.json';
const MAX_SNIPPET_CHARS = 420;
const MAX_CACHED_PAGES = 500;
const MAX_CACHED_CHUNKS = 5000;
// Upper bound on how many cached pages we keep per tab. Previously the store
// wiped every prior page for a tab whenever a new page was cached, which meant
// navigating inside a single tab from A → B → A collapsed the agent's working
// memory of that tab down to the newest page. A bounded per-tab history lets
// the model fall back to recent pages without unbounded growth.
const MAX_PAGES_PER_TAB = 12;
const SAVE_DEBOUNCE_MS = 250;
// Ranking knobs. Keep modest relative to term-match scores (which can hit
// 10–30 for a well-matched chunk) so boosts bias ordering without drowning out
// genuinely stronger matches elsewhere in the cache.
const ACTIVE_TAB_SCORE_BOOST = 4;
const MAX_RECENCY_BOOST = 3.5;
const RECENCY_BOOST_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// Exact-phrase match bonus applied when the full (normalized) query appears as
// a contiguous substring in the chunk body. Meaningful signal — a page that
// literally contains "gpt-5 pricing" is strictly more relevant than one that
// mentions "gpt" and "pricing" hundreds of tokens apart.
const PHRASE_MATCH_BOOST = 6;
// Floor below which we drop results entirely. Chunks scoring below this almost
// always surface as noise; the agent wastes a `read_cached_chunk` call on them.
// Pass qualityFloor: 0 to disable (audit/debug paths).
const DEFAULT_QUALITY_FLOOR = 3;
// answerFromCache diversity: limit each page's contribution so four suggested
// chunk ids cover multiple pages instead of dumping four excerpts from the
// same page — the model rarely needs that much redundant context.
const MAX_SUGGESTED_CHUNKS = 4;
const MAX_SUGGESTED_CHUNKS_PER_PAGE = 1;

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
  private chunks = new Map<string, SearchablePageChunk>();
  // MRU-ordered list of pageIds per tab. index 0 is the most recently cached
  // page; older pages can still be searched and read until they fall off the
  // per-tab cap or the tab is closed.
  private pagesByTabId = new Map<string, string[]>();
  private searchCount = 0;
  private searchHitCount = 0;
  private searchMissCount = 0;
  private chunkReadCount = 0;
  private pendingSaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.load();
  }

  /**
   * Cache (or refresh) a page for a tab. Preserves prior pages in the same tab
   * up to {@link MAX_PAGES_PER_TAB}, so re-navigating back to an earlier URL
   * still finds its chunks. When the incoming page matches an existing page's
   * content hash we just refresh its `updatedAt` and move it to MRU instead of
   * re-chunking the DOM.
   */
  cachePage(input: {
    tabId: string;
    url: string;
    title: string;
    content: string;
    tier: 'semantic' | 'readability';
    /** Task id that owns this cached page. Used later to scope searches. */
    taskId?: string;
  }): CachedPageRecord {
    const cleaned = cleanPageText(input.content);
    const contentHash = hashContent(cleaned);
    const pageId = pageIdFor(input.tabId, input.url, contentHash);
    const now = Date.now();

    const existing = this.pages.get(pageId);
    if (existing) {
      const refreshed: CachedPageRecord = {
        ...existing,
        title: input.title || existing.title,
        tier: input.tier,
        updatedAt: now,
        taskId: input.taskId ?? existing.taskId,
      };
      this.pages.set(pageId, refreshed);
      if (input.taskId && input.taskId !== existing.taskId) {
        for (const chunkId of refreshed.chunkIds) {
          const chunk = this.chunks.get(chunkId);
          if (chunk) this.chunks.set(chunkId, { ...chunk, taskId: input.taskId });
        }
      }
      this.touchPageForTab(input.tabId, pageId);
      this.scheduleSave();
      return { ...refreshed };
    }

    const chunks = chunkPage({
      pageId,
      tabId: input.tabId,
      url: input.url,
      title: input.title,
      content: cleaned,
      createdAt: now,
    });

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
      taskId: input.taskId,
    };

    this.pages.set(page.id, page);
    for (const chunk of chunks) {
      this.chunks.set(chunk.id, this.toSearchableChunk({ ...chunk, taskId: input.taskId }));
    }
    this.touchPageForTab(input.tabId, pageId);
    this.enforcePerTabLimit(input.tabId);
    this.enforceCacheLimits();
    this.scheduleSave();
    return { ...page };
  }

  clearAll(): { pageCount: number; chunkCount: number } {
    const pageCount = this.pages.size;
    const chunkCount = this.chunks.size;
    this.pages.clear();
    this.chunks.clear();
    this.pagesByTabId.clear();
    this.searchCount = 0;
    this.searchHitCount = 0;
    this.searchMissCount = 0;
    this.chunkReadCount = 0;
    this.flushSave();
    return { pageCount, chunkCount };
  }

  removePagesForTab(tabId: string): { pageCount: number; chunkCount: number } {
    const pageIds = this.pagesByTabId.get(tabId) ?? [];

    let removedChunks = 0;
    for (const pageId of pageIds) {
      const page = this.pages.get(pageId);
      if (!page) continue;
      for (const chunkId of page.chunkIds) {
        if (this.chunks.delete(chunkId)) removedChunks += 1;
      }
      this.pages.delete(pageId);
    }
    this.pagesByTabId.delete(tabId);

    if (pageIds.length > 0) {
      this.flushSave();
    }

    return { pageCount: pageIds.length, chunkCount: removedChunks };
  }

  listPages(): CachedPageRecord[] {
    return Array.from(this.pages.values()).map(page => ({ ...page }));
  }

  /**
   * Returns cached pages for a single tab, MRU first. Useful for rendering the
   * per-tab page history and for cross-tab working memory injection.
   */
  listPagesForTab(tabId: string): CachedPageRecord[] {
    const pageIds = this.pagesByTabId.get(tabId) ?? [];
    const result: CachedPageRecord[] = [];
    for (const pageId of pageIds) {
      const page = this.pages.get(pageId);
      if (page) result.push({ ...page });
    }
    return result;
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

  search(query: string, input?: {
    tabId?: string;
    pageId?: string;
    limit?: number;
    /** When set, restrict results to chunks cached under this task id. */
    taskId?: string;
    /** Active tab id for an active-tab ranking boost. */
    activeTabId?: string;
    /** Override `Date.now()` reference point (tests / deterministic recency). */
    now?: number;
    /**
     * Drop results whose raw score falls below this floor. Defaults to
     * `DEFAULT_QUALITY_FLOOR`; pass 0 to disable filtering (debug/audit).
     */
    qualityFloor?: number;
  }): PageSearchResult[] {
    this.searchCount++;
    const terms = normalizeQuery(query);
    if (terms.length === 0) {
      this.searchMissCount++;
      return [];
    }
    const phrase = normalizePhrase(query);

    const limit = Math.min(input?.limit || 8, 20);
    const now = input?.now ?? Date.now();
    const floor = input?.qualityFloor ?? DEFAULT_QUALITY_FLOOR;
    const chunks = Array.from(this.chunks.values()).filter(chunk => {
      if (input?.tabId && chunk.tabId !== input.tabId) return false;
      if (input?.pageId && chunk.pageId !== input.pageId) return false;
      if (input?.taskId && chunk.taskId !== input.taskId) return false;
      return true;
    });

    const results = chunks
      .map(chunk => {
        let score = 0;
        for (const term of terms) {
          const matches = countOccurrences(chunk.searchText, term);
          score += matches;
          if (chunk.headingLower.includes(term)) score += 3;
          if (chunk.titleLower.includes(term)) score += 2;
        }
        // Exact-phrase bonus: only meaningful once we have ≥2 terms (otherwise
        // the phrase is identical to the lone term and we'd double-count).
        if (phrase && terms.length >= 2 && chunk.searchText.includes(phrase)) {
          score += PHRASE_MATCH_BOOST;
        }
        if (score > 0) {
          if (input?.activeTabId && chunk.tabId === input.activeTabId) {
            score += ACTIVE_TAB_SCORE_BOOST;
          }
          score += recencyBoost(chunk.createdAt, now);
        }
        return { chunk, score };
      })
      .filter(item => item.score >= Math.max(1, floor))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(item => ({
        chunkId: item.chunk.id,
        pageId: item.chunk.pageId,
        tabId: item.chunk.tabId,
        url: item.chunk.url,
        title: item.chunk.title,
        heading: item.chunk.heading,
        snippet: makeSnippet(item.chunk.text, terms, phrase),
        score: Math.round(item.score * 100) / 100,
        confidence: confidenceTier(item.score),
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

  answerFromCache(question: string, input?: {
    tabId?: string;
    pageId?: string;
    limit?: number;
    taskId?: string;
    activeTabId?: string;
    now?: number;
  }): {
    question: string;
    answerable: boolean;
    matches: PageSearchResult[];
    suggestedChunkIds: string[];
    tokenEstimate: number;
  } {
    const matches = this.search(question, input);
    const suggested = diversifyChunks(matches, MAX_SUGGESTED_CHUNKS, MAX_SUGGESTED_CHUNKS_PER_PAGE);
    return {
      question,
      answerable: matches.length > 0,
      matches,
      suggestedChunkIds: suggested.map(match => match.chunkId),
      tokenEstimate: suggested.reduce((sum, match) => sum + Math.min(match.tokenEstimate, 120), 0),
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

  /**
   * Flush any debounced save to disk synchronously. Call from shutdown hooks
   * (and from tests that assert disk state) so the pending write isn't lost.
   */
  flushPendingSaves(): void {
    this.flushSave();
  }

  private resolvePage(pageIdOrTabId: string): CachedPageRecord | null {
    const byId = this.pages.get(pageIdOrTabId);
    if (byId) return byId;
    const pageIds = this.pagesByTabId.get(pageIdOrTabId);
    if (!pageIds || pageIds.length === 0) return null;
    return this.pages.get(pageIds[0]) || null;
  }

  private touchPageForTab(tabId: string, pageId: string): void {
    const existing = this.pagesByTabId.get(tabId) ?? [];
    const filtered = existing.filter(id => id !== pageId);
    filtered.unshift(pageId);
    this.pagesByTabId.set(tabId, filtered);
  }

  private enforcePerTabLimit(tabId: string): void {
    const pageIds = this.pagesByTabId.get(tabId);
    if (!pageIds || pageIds.length <= MAX_PAGES_PER_TAB) return;
    const evicted = pageIds.slice(MAX_PAGES_PER_TAB);
    for (const pageId of evicted) {
      const page = this.pages.get(pageId);
      if (!page) continue;
      for (const chunkId of page.chunkIds) this.chunks.delete(chunkId);
      this.pages.delete(pageId);
    }
    this.pagesByTabId.set(tabId, pageIds.slice(0, MAX_PAGES_PER_TAB));
  }

  private load(): void {
    try {
      const filePath = cachePath();
      if (!fs.existsSync(filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CacheFile;
      for (const page of parsed.pages || []) {
        this.pages.set(page.id, page);
      }
      for (const chunk of parsed.chunks || []) this.chunks.set(chunk.id, this.toSearchableChunk(chunk));
      this.rebuildPagesByTabIndex();
    } catch {
      this.pages.clear();
      this.chunks.clear();
      this.pagesByTabId.clear();
    }
  }

  private rebuildPagesByTabIndex(): void {
    this.pagesByTabId.clear();
    const pages = Array.from(this.pages.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    for (const page of pages) {
      const existing = this.pagesByTabId.get(page.tabId);
      if (existing) existing.push(page.id);
      else this.pagesByTabId.set(page.tabId, [page.id]);
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
      this.evictFromTabIndex(oldest.tabId, oldest.id);
    }
  }

  private evictFromTabIndex(tabId: string, pageId: string): void {
    const pageIds = this.pagesByTabId.get(tabId);
    if (!pageIds) return;
    const filtered = pageIds.filter(id => id !== pageId);
    if (filtered.length === 0) this.pagesByTabId.delete(tabId);
    else this.pagesByTabId.set(tabId, filtered);
  }

  /**
   * Debounce cache persistence so a burst of background extractions (or the
   * upcoming auto-cache-on-did-stop-loading flow) doesn't fsync the whole file
   * on every navigation. Callers that need durability on a specific boundary
   * (clearAll, removePagesForTab) should use {@link flushSave}.
   */
  private scheduleSave(): void {
    if (this.pendingSaveTimer) return;
    this.pendingSaveTimer = setTimeout(() => {
      this.pendingSaveTimer = null;
      this.writeToDisk();
    }, SAVE_DEBOUNCE_MS);
    if (typeof this.pendingSaveTimer === 'object' && this.pendingSaveTimer !== null && typeof (this.pendingSaveTimer as { unref?: () => void }).unref === 'function') {
      (this.pendingSaveTimer as { unref: () => void }).unref();
    }
  }

  private flushSave(): void {
    if (this.pendingSaveTimer) {
      clearTimeout(this.pendingSaveTimer);
      this.pendingSaveTimer = null;
    }
    this.writeToDisk();
  }

  private writeToDisk(): void {
    const filePath = cachePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const payload: CacheFile = {
      pages: Array.from(this.pages.values()),
      chunks: Array.from(this.chunks.values()).map(({ searchText: _searchText, titleLower: _titleLower, headingLower: _headingLower, ...chunk }) => chunk),
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  }

  private toSearchableChunk(chunk: CachedPageChunk): SearchablePageChunk {
    return {
      ...chunk,
      searchText: `${chunk.title} ${chunk.heading} ${chunk.text}`.toLowerCase(),
      titleLower: chunk.title.toLowerCase(),
      headingLower: chunk.heading.toLowerCase(),
    };
  }
}

function recencyBoost(createdAt: number, now: number): number {
  const age = Math.max(0, now - createdAt);
  if (age >= RECENCY_BOOST_WINDOW_MS) return 0;
  const fresh = 1 - age / RECENCY_BOOST_WINDOW_MS;
  return fresh * MAX_RECENCY_BOOST;
}

/**
 * Pick up to `total` results while capping each pageId to `perPage`, preserving
 * the caller's ordering. Used for {@link PageKnowledgeStore.answerFromCache} so
 * the suggested set spans multiple pages instead of dumping several excerpts
 * from the same URL.
 */
function diversifyChunks(
  matches: PageSearchResult[],
  total: number,
  perPage: number,
): PageSearchResult[] {
  if (matches.length === 0) return [];
  const counts = new Map<string, number>();
  const chosen: PageSearchResult[] = [];
  for (const match of matches) {
    const used = counts.get(match.pageId) ?? 0;
    if (used >= perPage) continue;
    chosen.push(match);
    counts.set(match.pageId, used + 1);
    if (chosen.length >= total) break;
  }
  if (chosen.length < total) {
    for (const match of matches) {
      if (chosen.length >= total) break;
      if (chosen.includes(match)) continue;
      chosen.push(match);
    }
  }
  return chosen;
}

/**
 * Pick the {@link MAX_SNIPPET_CHARS}-wide window that covers the densest
 * cluster of query-term matches — distinct terms first, raw hit count as the
 * tiebreak. The naive "window around the first occurrence" misses snippets for
 * queries like "gpt-5 pricing" whose terms land far apart in a chunk.
 */
export function pickBestSnippetWindow(
  text: string,
  terms: string[],
  phrase: string | null,
  windowSize: number,
): { start: number; distinct: number; total: number } {
  const lower = text.toLowerCase();
  if (terms.length === 0 || text.length <= windowSize) {
    return { start: 0, distinct: 0, total: 0 };
  }

  const anchors: number[] = [];
  if (phrase) {
    let i = 0;
    while (i < lower.length) {
      const idx = lower.indexOf(phrase, i);
      if (idx === -1) break;
      anchors.push(idx);
      i = idx + phrase.length;
    }
  }
  for (const term of terms) {
    let i = 0;
    while (i < lower.length) {
      const idx = lower.indexOf(term, i);
      if (idx === -1) break;
      anchors.push(idx);
      i = idx + term.length;
    }
  }
  if (anchors.length === 0) return { start: 0, distinct: 0, total: 0 };

  let best = { start: 0, distinct: -1, total: -1 };
  for (const anchor of anchors) {
    const start = Math.max(0, Math.min(text.length - windowSize, anchor - Math.floor(windowSize / 3)));
    const end = start + windowSize;
    const slice = lower.slice(start, end);
    let distinct = 0;
    let total = 0;
    for (const term of terms) {
      const occurrences = countOccurrencesLocal(slice, term);
      if (occurrences > 0) {
        distinct += 1;
        total += occurrences;
      }
    }
    if (phrase && slice.includes(phrase)) {
      total += 2;
    }
    if (distinct > best.distinct || (distinct === best.distinct && total > best.total)) {
      best = { start, distinct, total };
    }
  }
  return best;
}

function makeSnippet(text: string, terms: string[], phrase: string | null): string {
  if (!text) return '';
  if (text.length <= MAX_SNIPPET_CHARS) {
    return text.replace(/\s+/g, ' ').trim();
  }
  const { start } = pickBestSnippetWindow(text, terms, phrase, MAX_SNIPPET_CHARS);
  const end = Math.min(text.length, start + MAX_SNIPPET_CHARS);
  const snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${snippet}${suffix}`;
}

function countOccurrencesLocal(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while (index < haystack.length) {
    const matchIndex = haystack.indexOf(needle, index);
    if (matchIndex === -1) break;
    count += 1;
    index = matchIndex + needle.length;
  }
  return count;
}

function normalizePhrase(query: string): string | null {
  const collapsed = query.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  // Skip single-token and overly-long queries (>80 chars is almost never a
  // literal phrase match candidate; it becomes a noisy boost).
  if (!collapsed.includes(' ')) return null;
  if (collapsed.length > 80) return null;
  return collapsed;
}

function confidenceTier(score: number): 'high' | 'medium' | 'low' {
  if (score >= 12) return 'high';
  if (score >= 6) return 'medium';
  return 'low';
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while (index < haystack.length) {
    const matchIndex = haystack.indexOf(needle, index);
    if (matchIndex === -1) break;
    count += 1;
    index = matchIndex + needle.length;
  }
  return count;
}

export const pageKnowledgeStore = new PageKnowledgeStore();
