// ═══════════════════════════════════════════════════════════════════════════
// Browser Context Injection — builds a compact per-turn summary of the
// browser surface so the model starts every turn with accurate cross-tab
// working memory instead of having to re-discover tab ids and cached pages
// through tool calls.
// ═══════════════════════════════════════════════════════════════════════════

import type { TabInfo } from '../../shared/types/browser';
import type { CachedPageRecord } from '../browserKnowledge/PageCacheTypes';

export interface BrowserContextSources {
  isBrowserReady: () => boolean;
  getActiveTabId: () => string;
  getTabs: () => TabInfo[];
  listCachedPages: () => CachedPageRecord[];
}

export interface BrowserContextOptions {
  /** Cap on the number of tabs listed (oldest tabs are elided). Default 8. */
  maxTabs?: number;
  /** Cap on the number of recently cached pages listed. Default 6. */
  maxCachedPages?: number;
  /** Per-tab URL/title truncation length. Default 80. */
  maxLabelChars?: number;
}

const DEFAULT_MAX_TABS = 8;
const DEFAULT_MAX_CACHED_PAGES = 6;
const DEFAULT_MAX_LABEL_CHARS = 80;

/**
 * Build a compact `## Browser Overview` markdown section reflecting the
 * live browser surface at the start of a turn. Returns null when the
 * browser is not initialised so we do not pollute text-only tasks.
 *
 * Intentionally small (few hundred chars): the full cache inventory
 * remains available through `browser.cache_inventory` when the model
 * needs more. Tab state is covered by this block plus the
 * `{ activeTabId, tabs }` echo on mutating browser tool responses, so
 * there is no dedicated `browser.tabs` tool.
 */
export function buildBrowserContextBlock(
  sources: BrowserContextSources,
  options: BrowserContextOptions = {},
): string | null {
  if (!sources.isBrowserReady()) return null;

  const maxTabs = options.maxTabs ?? DEFAULT_MAX_TABS;
  const maxCachedPages = options.maxCachedPages ?? DEFAULT_MAX_CACHED_PAGES;
  const maxLabelChars = options.maxLabelChars ?? DEFAULT_MAX_LABEL_CHARS;

  const tabs = sources.getTabs();
  if (tabs.length === 0) return null;

  const activeTabId = sources.getActiveTabId();
  const sortedTabs = [...tabs].sort((a, b) => {
    if (a.id === activeTabId) return -1;
    if (b.id === activeTabId) return 1;
    return (b.navigation.lastNavigationAt ?? b.createdAt) - (a.navigation.lastNavigationAt ?? a.createdAt);
  });
  const visibleTabs = sortedTabs.slice(0, maxTabs);
  const hiddenTabCount = Math.max(0, sortedTabs.length - visibleTabs.length);

  const tabLines = visibleTabs.map((tab) => formatTabLine(tab, activeTabId, maxLabelChars));

  const cachedPages = sources.listCachedPages();
  const cachedPageLines = cachedPages.length > 0
    ? formatCachedPageLines(cachedPages, maxCachedPages, maxLabelChars)
    : [];

  const lines: string[] = ['## Browser Overview'];
  lines.push(
    `Tabs: ${tabs.length} open${activeTabId ? `; active tab is ${activeTabId}` : ''}.`,
  );
  lines.push(...tabLines);
  if (hiddenTabCount > 0) {
    lines.push(`- ...and ${hiddenTabCount} more tab${hiddenTabCount === 1 ? '' : 's'} open (inactive tabs elided; run a browser action in one of them to see its full state echoed back).`);
  }
  if (cachedPageLines.length > 0) {
    lines.push('');
    lines.push(`Recently cached pages (${cachedPages.length} total):`);
    lines.push(...cachedPageLines);
  }
  lines.push('');
  lines.push(
    'Use `browser.search_page_cache` against the cached pages above before re-extracting a tab, `browser.record_finding` to pin answers into task memory, and `browser.pin_page` to protect a cached page (📌) from LRU eviction. Pages marked (closed) outlived their tab — still searchable.',
  );
  return lines.join('\n');
}

function formatTabLine(tab: TabInfo, activeTabId: string, maxLabelChars: number): string {
  const marker = tab.id === activeTabId ? '(active) ' : '';
  const title = truncate((tab.navigation.title || '').trim(), maxLabelChars) || '(untitled)';
  const url = truncate((tab.navigation.url || '').trim(), maxLabelChars) || 'about:blank';
  const loading = tab.navigation.isLoading ? ' [loading]' : '';
  return `- ${marker}${tab.id} — ${title} — ${url}${loading}`;
}

function formatCachedPageLines(
  pages: CachedPageRecord[],
  limit: number,
  maxLabelChars: number,
): string[] {
  // Pinned pages bubble to the top so the "protected working set" is
  // immediately visible; then we fall back to freshest-first. Pages whose
  // owning tab was closed are still listed (they are still searchable) but
  // tagged so the model knows they won't echo on browser tool calls.
  const sorted = [...pages]
    .sort((a, b) => {
      const aPinned = a.pinned ? 1 : 0;
      const bPinned = b.pinned ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      return b.updatedAt - a.updatedAt;
    })
    .slice(0, limit);
  return sorted.map((page) => {
    const title = truncate((page.title || '').trim(), maxLabelChars) || truncate(page.url, maxLabelChars);
    const pin = page.pinned ? ' 📌' : '';
    const closed = page.tabClosedAt ? ' (closed)' : '';
    return `- ${page.id} (tab ${page.tabId}${closed}, ${page.chunkIds.length} chunks)${pin} — ${title}`;
  });
}

function truncate(value: string, maxChars: number): string {
  if (!value) return value;
  return value.length > maxChars ? `${value.slice(0, maxChars - 1)}…` : value;
}
