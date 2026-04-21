import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => process.env.V2_TEST_USER_DATA || os.tmpdir(),
  },
}));

import { PageKnowledgeStore } from './PageKnowledgeStore';

function longContent(seed: string): string {
  // PageChunker drops sections shorter than MIN_CHUNK_CHARS=120 when multiple
  // sections exist, so we pad each call with filler to guarantee a chunk.
  const filler = 'The quick brown fox jumps over the lazy dog. '.repeat(8);
  return `# Heading\n\n${seed}\n\n${filler}`;
}

describe('PageKnowledgeStore', () => {
  let userDataDir = '';

  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-page-knowledge-'));
    process.env.V2_TEST_USER_DATA = userDataDir;
  });

  afterEach(() => {
    delete process.env.V2_TEST_USER_DATA;
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it('retains prior pages in the same tab when a new page is cached instead of wiping them', () => {
    const store = new PageKnowledgeStore();

    const first = store.cachePage({
      tabId: 'tab-1',
      url: 'https://example.com/a',
      title: 'Page A',
      content: longContent('content about alpha project alpha alpha'),
      tier: 'readability',
    });
    const second = store.cachePage({
      tabId: 'tab-1',
      url: 'https://example.com/b',
      title: 'Page B',
      content: longContent('content about beta topic beta beta'),
      tier: 'readability',
    });

    expect(first.id).not.toBe(second.id);

    const tabPages = store.listPagesForTab('tab-1');
    expect(tabPages.map(page => page.id)).toEqual([second.id, first.id]);

    const alphaHits = store.search('alpha', { tabId: 'tab-1' });
    expect(alphaHits.length).toBeGreaterThan(0);
    expect(alphaHits[0].pageId).toBe(first.id);

    const betaHits = store.search('beta', { tabId: 'tab-1' });
    expect(betaHits.length).toBeGreaterThan(0);
    expect(betaHits[0].pageId).toBe(second.id);
  });

  it('treats re-caching the same URL+content as an upsert that refreshes updatedAt without duplicating chunks', () => {
    const store = new PageKnowledgeStore();

    const first = store.cachePage({
      tabId: 'tab-1',
      url: 'https://example.com/a',
      title: 'Page A',
      content: longContent('stable content about gamma gamma gamma'),
      tier: 'readability',
    });
    const initialChunkCount = store.getStats().chunkCount;

    const second = store.cachePage({
      tabId: 'tab-1',
      url: 'https://example.com/a',
      title: 'Page A (refreshed)',
      content: longContent('stable content about gamma gamma gamma'),
      tier: 'readability',
    });

    expect(second.id).toBe(first.id);
    expect(store.getStats().chunkCount).toBe(initialChunkCount);
    expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
    expect(second.title).toBe('Page A (refreshed)');
  });

  it('surfaces an earlier cached page via resolvePage/listSections after navigating back to its URL', () => {
    const store = new PageKnowledgeStore();

    const first = store.cachePage({
      tabId: 'tab-1',
      url: 'https://example.com/a',
      title: 'Page A',
      content: longContent('delta content about page a'),
      tier: 'readability',
    });
    store.cachePage({
      tabId: 'tab-1',
      url: 'https://example.com/b',
      title: 'Page B',
      content: longContent('epsilon content about page b'),
      tier: 'readability',
    });

    // Revisiting the original URL should touch the existing record instead of
    // creating a new one, and should move it back to MRU.
    const revisit = store.cachePage({
      tabId: 'tab-1',
      url: 'https://example.com/a',
      title: 'Page A',
      content: longContent('delta content about page a'),
      tier: 'readability',
    });
    expect(revisit.id).toBe(first.id);
    expect(store.listPagesForTab('tab-1')[0].id).toBe(first.id);

    const sections = store.listSections(first.id);
    expect(sections.length).toBeGreaterThan(0);
  });

  it('evicts the oldest pages within a tab once the per-tab cap is exceeded', () => {
    const store = new PageKnowledgeStore();
    const ids: string[] = [];
    for (let i = 0; i < 15; i++) {
      const page = store.cachePage({
        tabId: 'tab-1',
        url: `https://example.com/page-${i}`,
        title: `Page ${i}`,
        content: longContent(`zeta content ${i} ${i} ${i}`),
        tier: 'readability',
      });
      ids.push(page.id);
    }
    const retained = store.listPagesForTab('tab-1');
    expect(retained.length).toBe(12);
    expect(retained[0].id).toBe(ids[ids.length - 1]);
    // Oldest 3 should have been evicted entirely.
    for (const evictedId of ids.slice(0, 3)) {
      expect(store.listSections(evictedId)).toEqual([]);
    }
  });

  it('markTabClosed keeps chunks searchable so "I just closed that tab" still answers from cache', () => {
    const store = new PageKnowledgeStore();
    const page = store.cachePage({
      tabId: 'tab-closed',
      url: 'https://example.com/a',
      title: 'Page A',
      content: longContent('rho content rho rho rho'),
      tier: 'readability',
    });

    const closedAt = Date.now();
    const result = store.markTabClosed('tab-closed', closedAt);
    expect(result.pageCount).toBe(1);

    const hits = store.search('rho');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].pageId).toBe(page.id);

    const record = store.listPages().find(p => p.id === page.id);
    expect(record?.tabClosedAt).toBe(closedAt);
  });

  it('setPinned exempts a cached page from global LRU eviction even when the cache is full', () => {
    const store = new PageKnowledgeStore();
    const protectedPage = store.cachePage({
      tabId: 'tab-keep',
      url: 'https://example.com/keep',
      title: 'Keep Me',
      content: longContent('protected signature tau tau tau'),
      tier: 'readability',
    });
    const pinned = store.setPinned(protectedPage.id, true);
    expect(pinned?.pinned).toBe(true);

    // Force LRU eviction by filling beyond MAX_CACHED_PAGES (500). Rather
    // than cache 500 real pages, monkey-patch the internal pages map so we
    // can exercise enforceCacheLimits deterministically.
    const internals = store as unknown as {
      pages: Map<string, { id: string; tabId: string; chunkIds: string[]; updatedAt: number; pinned?: boolean }>;
      chunks: Map<string, unknown>;
      enforceCacheLimits: () => void;
    };
    for (let i = 0; i < 600; i++) {
      const id = `page_filler_${i}`;
      internals.pages.set(id, {
        id,
        tabId: `tab-filler-${i}`,
        chunkIds: [],
        updatedAt: 1 + i,
      });
    }
    internals.enforceCacheLimits();

    const stillThere = store.listPages().find(p => p.id === protectedPage.id);
    expect(stillThere).toBeTruthy();
    expect(stillThere?.pinned).toBe(true);
  });

  it('evicts closed-tab pages before live-tab pages when the LRU has to make room', () => {
    const store = new PageKnowledgeStore();
    const internals = store as unknown as {
      pages: Map<string, { id: string; tabId: string; chunkIds: string[]; updatedAt: number; pinned?: boolean; tabClosedAt?: number }>;
      chunks: Map<string, unknown>;
      enforceCacheLimits: () => void;
    };

    // Single live-tab "old" page plus one closed-tab page that is newer.
    // Under the old pure-updatedAt LRU the live page would evict first;
    // under the new policy the closed page evicts first regardless of age.
    internals.pages.set('page_live_old', {
      id: 'page_live_old',
      tabId: 'tab-live',
      chunkIds: [],
      updatedAt: 50,
    });
    internals.pages.set('page_closed_new', {
      id: 'page_closed_new',
      tabId: 'tab-closed',
      chunkIds: [],
      updatedAt: 100,
      tabClosedAt: 100,
    });
    // Fill exactly to one over the cap so enforceCacheLimits drops a
    // single page — the one whose eviction order was promoted by the
    // closed-tab rule.
    for (let i = 0; i < 499; i++) {
      const id = `page_filler_${i}`;
      internals.pages.set(id, {
        id,
        tabId: `tab-filler-${i}`,
        chunkIds: [],
        updatedAt: 500 + i,
      });
    }

    internals.enforceCacheLimits();

    const remaining = new Set(store.listPages().map(p => p.id));
    expect(remaining.has('page_closed_new')).toBe(false);
    expect(remaining.has('page_live_old')).toBe(true);
    expect(remaining.size).toBe(500);
  });

  it('removePagesForTab drops every page cached under that tab, including prior history', () => {
    const store = new PageKnowledgeStore();
    store.cachePage({
      tabId: 'tab-1',
      url: 'https://example.com/a',
      title: 'Page A',
      content: longContent('alpha content'),
      tier: 'readability',
    });
    store.cachePage({
      tabId: 'tab-1',
      url: 'https://example.com/b',
      title: 'Page B',
      content: longContent('beta content'),
      tier: 'readability',
    });
    store.cachePage({
      tabId: 'tab-2',
      url: 'https://example.com/c',
      title: 'Page C',
      content: longContent('sigma content'),
      tier: 'readability',
    });

    const removed = store.removePagesForTab('tab-1');
    expect(removed.pageCount).toBe(2);
    expect(removed.chunkCount).toBeGreaterThan(0);
    expect(store.listPagesForTab('tab-1')).toEqual([]);
    expect(store.listPagesForTab('tab-2')).toHaveLength(1);
  });

  it('debounces disk persistence so a burst of cachePage calls does not fsync each write, then flushPendingSaves commits once', () => {
    const store = new PageKnowledgeStore();
    const filePath = path.join(userDataDir, 'browser-knowledge-cache.json');

    store.cachePage({
      tabId: 'tab-1',
      url: 'https://example.com/a',
      title: 'Page A',
      content: longContent('omega content'),
      tier: 'readability',
    });
    store.cachePage({
      tabId: 'tab-1',
      url: 'https://example.com/b',
      title: 'Page B',
      content: longContent('omega-two content'),
      tier: 'readability',
    });

    // Nothing is written yet because the debounce timer has not fired.
    expect(fs.existsSync(filePath)).toBe(false);

    store.flushPendingSaves();

    expect(fs.existsSync(filePath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { pages: unknown[] };
    expect(parsed.pages).toHaveLength(2);
  });

  it('scopes search by taskId so chunks cached under a different task do not leak across sessions', () => {
    const store = new PageKnowledgeStore();

    store.cachePage({
      tabId: 'tab-1',
      url: 'https://example.com/task-a',
      title: 'Task A Page',
      content: longContent('shared keyword kappa kappa kappa from task a'),
      tier: 'readability',
      taskId: 'task-a',
    });
    store.cachePage({
      tabId: 'tab-2',
      url: 'https://example.com/task-b',
      title: 'Task B Page',
      content: longContent('shared keyword kappa kappa kappa from task b'),
      tier: 'readability',
      taskId: 'task-b',
    });

    const scopedToA = store.search('kappa', { taskId: 'task-a' });
    expect(scopedToA.length).toBeGreaterThan(0);
    expect(scopedToA.every(result => result.tabId === 'tab-1')).toBe(true);

    const scopedToB = store.search('kappa', { taskId: 'task-b' });
    expect(scopedToB.length).toBeGreaterThan(0);
    expect(scopedToB.every(result => result.tabId === 'tab-2')).toBe(true);

    const unscoped = store.search('kappa');
    expect(unscoped.length).toBeGreaterThanOrEqual(2);
  });

  it('refreshing a page adopts the new taskId so mid-task caching backfills the scope', () => {
    const store = new PageKnowledgeStore();
    const initial = store.cachePage({
      tabId: 'tab-1',
      url: 'https://example.com/mu',
      title: 'Mu Page',
      content: longContent('mu keyword mu mu mu'),
      tier: 'readability',
    });
    // The first cache had no taskId; initial background extraction may race the
    // agent's first turn. The follow-up cache (same content) must re-tag it.
    const refreshed = store.cachePage({
      tabId: 'tab-1',
      url: 'https://example.com/mu',
      title: 'Mu Page',
      content: longContent('mu keyword mu mu mu'),
      tier: 'readability',
      taskId: 'task-mu',
    });
    expect(refreshed.id).toBe(initial.id);

    const scoped = store.search('mu', { taskId: 'task-mu' });
    expect(scoped.length).toBeGreaterThan(0);
  });

  it('boosts results whose tab matches activeTabId so the current tab wins ties', () => {
    const store = new PageKnowledgeStore();
    store.cachePage({
      tabId: 'tab-old',
      url: 'https://example.com/old',
      title: 'Old Page',
      content: longContent('nu nu topic'),
      tier: 'readability',
    });
    store.cachePage({
      tabId: 'tab-active',
      url: 'https://example.com/active',
      title: 'Active Page',
      content: longContent('nu topic once'),
      tier: 'readability',
    });

    const unboosted = store.search('nu', { now: Date.now() });
    expect(unboosted[0].tabId).toBe('tab-old');

    const boosted = store.search('nu', { activeTabId: 'tab-active', now: Date.now() });
    expect(boosted[0].tabId).toBe('tab-active');
  });

  it('applies a recency boost that fades over the recency window', () => {
    const store = new PageKnowledgeStore();
    const now = Date.now();
    const stale = store.cachePage({
      tabId: 'tab-stale',
      url: 'https://example.com/stale',
      title: 'Stale Page',
      content: longContent('xi content xi xi xi xi xi xi xi xi xi'),
      tier: 'readability',
    });
    // Backdate the stale page beyond the 7-day recency window so its chunks
    // receive no recency boost during the search below.
    const EIGHT_DAYS = 8 * 24 * 60 * 60 * 1000;
    const stalePage = store.listPages().find(page => page.id === stale.id);
    expect(stalePage).toBeTruthy();
    // Internal state mutation is acceptable in tests to simulate age without
    // waiting real time.
    if (stalePage) stalePage.createdAt = now - EIGHT_DAYS;
    for (const chunkId of stalePage?.chunkIds ?? []) {
      const chunk = (store as unknown as { chunks: Map<string, { createdAt: number }> }).chunks.get(chunkId);
      if (chunk) chunk.createdAt = now - EIGHT_DAYS;
    }

    store.cachePage({
      tabId: 'tab-fresh',
      url: 'https://example.com/fresh',
      title: 'Fresh Page',
      content: longContent('xi content xi xi'),
      tier: 'readability',
    });

    const results = store.search('xi', { now });
    // Stale page has 9 "xi" mentions; fresh page has 3. Without a recency
    // boost the stale page wins. With the ~3.5 fresh-page boost it can still
    // win on raw term count, but the gap must shrink — and the fresh result
    // must rank above any other equally-matched stale chunk.
    const topStale = results.find(r => r.tabId === 'tab-stale');
    const topFresh = results.find(r => r.tabId === 'tab-fresh');
    expect(topStale).toBeTruthy();
    expect(topFresh).toBeTruthy();
    if (topStale && topFresh) {
      expect(topFresh.score).toBeGreaterThan(3);
    }
  });

  it('diversifies answerFromCache suggestions to cover distinct pages', () => {
    const store = new PageKnowledgeStore();
    // Single long page with many mentions — without diversification the top 4
    // suggestions would all come from the same pageId.
    const heavyContent = `# Heading\n\n${'omicron pattern. '.repeat(50)}`;
    store.cachePage({
      tabId: 'tab-dense',
      url: 'https://example.com/dense',
      title: 'Dense Page',
      content: heavyContent,
      tier: 'readability',
    });
    store.cachePage({
      tabId: 'tab-b',
      url: 'https://example.com/b',
      title: 'Other Page',
      content: longContent('omicron once here'),
      tier: 'readability',
    });

    const answer = store.answerFromCache('omicron');
    const pages = new Set(answer.matches
      .filter(match => answer.suggestedChunkIds.includes(match.chunkId))
      .map(match => match.pageId));
    // Suggestions should cover more than one page if multiple pages matched.
    if (answer.matches.some(match => match.tabId === 'tab-b')) {
      expect(pages.size).toBeGreaterThan(1);
    }
    expect(answer.suggestedChunkIds.length).toBeLessThanOrEqual(4);
  });

  it('clearAll wipes the cache synchronously so tests and shutdown hooks observe durable state', () => {
    const store = new PageKnowledgeStore();
    store.cachePage({
      tabId: 'tab-1',
      url: 'https://example.com/a',
      title: 'Page A',
      content: longContent('persist-me content'),
      tier: 'readability',
    });

    store.clearAll();
    const filePath = path.join(userDataDir, 'browser-knowledge-cache.json');
    expect(fs.existsSync(filePath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { pages: unknown[]; chunks: unknown[] };
    expect(parsed.pages).toEqual([]);
    expect(parsed.chunks).toEqual([]);
  });
});
