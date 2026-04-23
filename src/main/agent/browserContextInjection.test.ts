import { describe, it, expect } from 'vitest';
import { buildBrowserContextBlock, type BrowserContextSources } from './browserContextInjection';
import type { TabInfo } from '../../shared/types/browser';
import type { CachedPageRecord } from '../browserKnowledge/PageCacheTypes';

function makeTab(input: Partial<TabInfo> & { id: string; url?: string; title?: string; loading?: boolean; lastNavigationAt?: number }): TabInfo {
  return {
    id: input.id,
    navigation: {
      url: input.url ?? '',
      title: input.title ?? '',
      canGoBack: false,
      canGoForward: false,
      isLoading: input.loading ?? false,
      loadingProgress: null,
      favicon: '',
      lastNavigationAt: input.lastNavigationAt ?? null,
    },
    status: 'ready',
    zoomLevel: 0,
    muted: false,
    isAudible: false,
    createdAt: input.createdAt ?? 1,
  };
}

function makeCachedPage(input: Partial<CachedPageRecord> & { id: string; tabId: string; url: string }): CachedPageRecord {
  return {
    id: input.id,
    tabId: input.tabId,
    url: input.url,
    title: input.title ?? '',
    tier: input.tier ?? 'readability',
    contentHash: input.contentHash ?? 'hash',
    chunkIds: input.chunkIds ?? [],
    headings: input.headings ?? [],
    createdAt: input.createdAt ?? 1,
    updatedAt: input.updatedAt ?? 1,
    taskId: input.taskId,
  };
}

function makeSources(overrides: Partial<BrowserContextSources>): BrowserContextSources {
  return {
    isBrowserReady: () => true,
    getActiveTabId: () => '',
    getTabs: () => [],
    listCachedPages: () => [],
    ...overrides,
  };
}

describe('buildBrowserContextBlock', () => {
  it('returns null when the browser surface is not initialised', () => {
    const sources = makeSources({ isBrowserReady: () => false });
    expect(buildBrowserContextBlock(sources)).toBeNull();
  });

  it('returns null when the browser has zero tabs', () => {
    const sources = makeSources({ isBrowserReady: () => true, getTabs: () => [] });
    expect(buildBrowserContextBlock(sources)).toBeNull();
  });

  it('lists open tabs with the active tab first and marks it explicitly', () => {
    const tabs: TabInfo[] = [
      makeTab({ id: 'tab-old', url: 'https://example.com/old', title: 'Old tab', lastNavigationAt: 100 }),
      makeTab({ id: 'tab-active', url: 'https://example.com/active', title: 'Active tab', lastNavigationAt: 500 }),
      makeTab({ id: 'tab-fresh', url: 'https://example.com/fresh', title: 'Fresh tab', lastNavigationAt: 900 }),
    ];
    const sources = makeSources({
      getActiveTabId: () => 'tab-active',
      getTabs: () => tabs,
    });

    const block = buildBrowserContextBlock(sources);
    expect(block).not.toBeNull();
    expect(block).toContain('## Browser Overview');
    expect(block).toContain('active tab is tab-active');

    const activeIndex = block!.indexOf('tab-active');
    const freshIndex = block!.indexOf('tab-fresh');
    const oldIndex = block!.indexOf('tab-old');
    expect(activeIndex).toBeGreaterThan(-1);
    expect(activeIndex).toBeLessThan(freshIndex);
    expect(freshIndex).toBeLessThan(oldIndex);
    expect(block).toContain('(active) tab-active');
  });

  it('marks loading tabs and truncates long urls / titles', () => {
    const longTitle = 'x'.repeat(200);
    const longUrl = `https://example.com/${'y'.repeat(300)}`;
    const tabs: TabInfo[] = [
      makeTab({ id: 'tab-1', url: longUrl, title: longTitle, loading: true }),
    ];
    const sources = makeSources({
      getActiveTabId: () => 'tab-1',
      getTabs: () => tabs,
    });

    const block = buildBrowserContextBlock(sources, { maxLabelChars: 20 });
    expect(block).toContain('[loading]');
    expect(block).not.toContain(longTitle);
    expect(block).not.toContain(longUrl);
    expect(block).toMatch(/…/);
  });

  it('elides tabs past the maxTabs cap with an informational footer', () => {
    const tabs = Array.from({ length: 10 }, (_, idx) => makeTab({
      id: `tab-${idx}`,
      url: `https://example.com/${idx}`,
      title: `Tab ${idx}`,
      lastNavigationAt: idx,
    }));
    const sources = makeSources({
      getActiveTabId: () => 'tab-9',
      getTabs: () => tabs,
    });

    const block = buildBrowserContextBlock(sources, { maxTabs: 3 });
    expect(block).toContain('tab-9');
    expect(block).toContain('...and 7 more tabs');
    expect(block).not.toContain('tab-0');
  });

  it('lists recently visited pages by updatedAt desc up to the cap', () => {
    const tabs = [makeTab({ id: 'tab-1' })];
    const pages: CachedPageRecord[] = [
      makeCachedPage({ id: 'page-a', tabId: 'tab-1', url: 'https://a.example/', title: 'Page A', updatedAt: 100 }),
      makeCachedPage({ id: 'page-b', tabId: 'tab-1', url: 'https://b.example/', title: 'Page B', updatedAt: 300 }),
      makeCachedPage({ id: 'page-c', tabId: 'tab-1', url: 'https://c.example/', title: 'Page C', updatedAt: 200 }),
    ];
    const sources = makeSources({
      getActiveTabId: () => 'tab-1',
      getTabs: () => tabs,
      listCachedPages: () => pages,
    });

    const block = buildBrowserContextBlock(sources, { maxCachedPages: 2 });
    expect(block).toContain('Recently cached pages (3 total)');
    expect(block).toContain('page-b');
    expect(block).toContain('page-c');
    expect(block).not.toContain('page-a');
  });

  it('forwards the active taskId to listCachedPages so the source can scope results', () => {
    const tabs = [makeTab({ id: 'tab-1' })];
    const capturedFilters: Array<{ taskId?: string } | undefined> = [];
    const sources = makeSources({
      getActiveTabId: () => 'tab-1',
      getTabs: () => tabs,
      listCachedPages: (filter) => {
        capturedFilters.push(filter);
        return [];
      },
    });

    buildBrowserContextBlock(sources, { taskId: 'task-active' });
    expect(capturedFilters).toEqual([{ taskId: 'task-active' }]);

    buildBrowserContextBlock(sources, {});
    expect(capturedFilters[1]).toBeUndefined();
  });

  it('omits the cached-pages section entirely when there are none', () => {
    const tabs = [makeTab({ id: 'tab-1', url: 'https://example.com/', title: 'Example' })];
    const sources = makeSources({
      getActiveTabId: () => 'tab-1',
      getTabs: () => tabs,
      listCachedPages: () => [],
    });

    const block = buildBrowserContextBlock(sources);
    expect(block).not.toContain('Recently visited pages');
  });
});
