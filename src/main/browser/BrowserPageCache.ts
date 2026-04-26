import { PageExtractor } from '../context/pageExtractor';
import type { CachedPageRecord } from '../browserKnowledge/PageCacheTypes';
import { pageKnowledgeStore } from '../browserKnowledge/PageKnowledgeStore';

const BACKGROUND_EXTRACTION_TAB_COOLDOWN_MS = 2_500;

type Deps = {
  getPageContext: (tabId: string) => { url: string; title: string } | null;
  executeInPage: (expression: string, tabId?: string) => Promise<{ result: unknown; error: string | null }>;
  emitLog: (level: 'info' | 'warn' | 'error', message: string) => void;
};

export class BrowserPageCache {
  private readonly pageExtractor: PageExtractor;
  private lastBackgroundExtractionByTab = new Map<string, { url: string; at: number }>();
  private pendingPageAnalysis = new Map<string, { url: string; promise: Promise<CachedPageRecord | null> }>();

  constructor(private readonly deps: Deps) {
    this.pageExtractor = new PageExtractor((expression, tabId) => this.deps.executeInPage(expression, tabId));
  }

  async ensurePageCached(
    tabId: string,
    opts: { taskIdOverride?: string } = {},
  ): Promise<CachedPageRecord | null> {
    return this.runPageAnalysis(tabId, opts);
  }

  cachePageKnowledgeInBackground(tabId: string): void {
    const context = this.deps.getPageContext(tabId);
    const url = context?.url ?? '';
    if (!url || url === 'about:blank' || url.startsWith('devtools://')) return;

    const previous = this.lastBackgroundExtractionByTab.get(tabId);
    const now = Date.now();
    if (previous && previous.url === url && now - previous.at < BACKGROUND_EXTRACTION_TAB_COOLDOWN_MS) {
      return;
    }
    this.lastBackgroundExtractionByTab.set(tabId, { url, at: now });
    void this.runPageAnalysis(tabId).catch(() => undefined);
  }

  forgetTab(tabId: string): void {
    this.lastBackgroundExtractionByTab.delete(tabId);
    this.pendingPageAnalysis.delete(tabId);
  }

  private async runPageAnalysis(
    tabId: string,
    opts: { taskIdOverride?: string } = {},
  ): Promise<CachedPageRecord | null> {
    const context = this.deps.getPageContext(tabId);
    const url = context?.url ?? '';
    if (!url || url === 'about:blank' || url.startsWith('devtools://')) return null;

    const existing = this.pendingPageAnalysis.get(tabId);
    if (existing && existing.url === url) return existing.promise;

    const taskId = opts.taskIdOverride;
    const pendingMap = this.pendingPageAnalysis;

    const slot: { url: string; promise: Promise<CachedPageRecord | null> } = {
      url,
      promise: null as unknown as Promise<CachedPageRecord | null>,
    };
    slot.promise = (async (): Promise<CachedPageRecord | null> => {
      try {
        const content = await this.pageExtractor.extractContent(tabId);

        let cached: CachedPageRecord | null = null;
        if (content.content.trim()) {
          cached = pageKnowledgeStore.cachePage({
            tabId,
            url: content.url || url,
            title: content.title || context?.title || '',
            content: content.content,
            tier: content.tier,
            taskId,
          });
          this.deps.emitLog('info', `Cached page knowledge: ${content.title || content.url || tabId}`);
        }

        return cached;
      } catch (err) {
        this.deps.emitLog('warn', `Page analysis failed: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      } finally {
        if (pendingMap.get(tabId) === slot) {
          pendingMap.delete(tabId);
        }
      }
    })();

    pendingMap.set(tabId, slot);
    return slot.promise;
  }
}
