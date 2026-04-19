import type { BrowserContextService } from './browserContext';
import type { BrowserOperationExecutionContext } from '../../shared/types/browserOperationLedger';

export type BrowserOperationResult = {
  summary: string;
  data: Record<string, unknown>;
};

export function currentSearchYear(): number {
  return new Date().getFullYear();
}

export function hasExplicitYear(query: string): boolean {
  return /\b(?:19|20)\d{2}\b/.test(query);
}

export function isFreshnessSensitiveSearchQuery(query: string): boolean {
  const normalized = query.toLowerCase();
  return /\b(latest|current|today|recent|newest|up[- ]?to[- ]?date|breaking|news|release(?: notes?)?|pricing|price|cost|version|docs?|documentation|policy|policies|law|laws|regulation|regulations|guidance|schedule|scores?)\b/.test(normalized);
}

export function prepareSearchEngineQuery(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return trimmed;
  if (hasExplicitYear(trimmed) || !isFreshnessSensitiveSearchQuery(trimmed)) {
    return trimmed;
  }
  return `${trimmed} ${currentSearchYear()}`;
}

export function getDebugNavigateDelayMs(): number {
  const raw = process.env.V2_DEBUG_NAVIGATE_DELAY_MS;
  if (!raw) return 0;
  const ms = parseInt(raw, 10);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

export function requireBrowserRuntime(browser: BrowserContextService): void {
  if (!browser.isCreated()) {
    throw new Error('Browser runtime not initialized');
  }
}

export async function waitForBrowserLoad(
  browser: BrowserContextService,
  timeoutMs: number = 5000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    const state = browser.getState();
    if (!state.navigation.isLoading) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

export async function executeNavigation(
  browser: BrowserContextService,
  url: string,
): Promise<BrowserOperationResult> {
  browser.navigate(url);

  const delayMs = getDebugNavigateDelayMs();
  if (delayMs > 0) {
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  await waitForBrowserLoad(browser, 5000);

  const state = browser.getState();
  const metadata = await browser.getPageMetadata();
  const preview = await browser.getPageText(2000);

  return {
    summary: `Navigated to ${state.navigation.url || url}`,
    data: {
      url: state.navigation.url || url,
      title: state.navigation.title,
      isLoading: state.navigation.isLoading,
      tabCount: state.tabs.length,
      pagePreview: preview.slice(0, 2000),
      metadata,
    },
  };
}

export function resolveOperationTabId(
  state: ReturnType<BrowserContextService['getState']>,
  payload: Record<string, unknown>,
  context?: BrowserOperationExecutionContext,
): string | null {
  const payloadTabId = typeof payload.tabId === 'string' && payload.tabId ? payload.tabId : null;
  return context?.tabId ?? payloadTabId ?? state.activeTabId ?? null;
}
