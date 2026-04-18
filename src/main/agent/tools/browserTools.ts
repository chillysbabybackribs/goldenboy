import { AgentToolDefinition } from '../AgentTypes';
import { browserService } from '../../browser/BrowserService';
import { PageExtractor } from '../../context/pageExtractor';
import { pageKnowledgeStore } from '../../browserKnowledge/PageKnowledgeStore';
import { appStateStore } from '../../state/appStateStore';
import { ActionType } from '../../state/actions';
import { generateId } from '../../../shared/utils/ids';
import { geminiSidecar } from '../GeminiSidecar';
import { WebIntentInstruction, WebIntentVM } from '../../browser/WebIntentVM';
import { agentCache } from '../AgentCache';
import {
  BrowserOperationKind,
  BrowserOperationPayloadMap,
  BrowserOperationResult,
  executeBrowserOperation,
} from '../../browser/browserOperations';

const SIDECAR_RANK_TIMEOUT_MS = 1200;
const SIDECAR_JUDGE_TIMEOUT_MS = 1200;

function objectInput(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
}

function requireObjectInput(input: unknown, toolName: string): Record<string, unknown> {
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  const received = input === null ? 'null' : Array.isArray(input) ? 'array' : typeof input;
  throw new Error(`Invalid input for ${toolName}: input must be an object; got ${received}.`);
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Expected non-empty string input: ${key}`);
  }
  return value;
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function optionalNumber(input: Record<string, unknown>, key: string, fallback: number): number {
  const value = input[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optionalStringArray(input: Record<string, unknown>, key: string): string[] {
  const value = input[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : [];
}

function logBrowserCache(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
  appStateStore.dispatch({
    type: ActionType.ADD_LOG,
    log: {
      id: generateId('log'),
      timestamp: Date.now(),
      level,
      source: 'browser',
      message,
    },
  });
}

function invalidateBrowserCaches(): void {
  agentCache.invalidateByToolPrefix('browser.');
}

function requireBrowserCreated(): void {
  if (!browserService.isCreated()) {
    throw new Error('Browser surface is not initialized yet. Open the execution window before using browser tools.');
  }
}

async function runBrowserOperation<K extends BrowserOperationKind>(
  kind: K,
  payload: BrowserOperationPayloadMap[K],
  input?: { invalidateCache?: boolean },
): Promise<BrowserOperationResult> {
  const result = await executeBrowserOperation({ kind, payload });
  if (input?.invalidateCache) invalidateBrowserCaches();
  return result;
}

function includesText(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function buildWaitForTextExpression(): string {
  return `(() => {
    const parts = [];
    if (document.body?.innerText) parts.push(document.body.innerText);
    for (const element of document.querySelectorAll('input, textarea, select')) {
      if (element instanceof HTMLSelectElement) {
        const selectedText = Array.from(element.selectedOptions || [])
          .map(option => option.textContent || '')
          .join('\\n')
          .trim();
        if (selectedText) parts.push(selectedText);
        if (element.value) parts.push(element.value);
        continue;
      }
      if ('value' in element && typeof element.value === 'string' && element.value.trim()) {
        parts.push(element.value);
      }
    }
    return parts.join('\\n');
  })()`;
}

function compactText(text: string | undefined, maxChars: number): string {
  const cleaned = (text || '').replace(/\s+/g, ' ').trim();
  return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars)}...` : cleaned;
}

async function resolveWithSoftTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<{ value: T; timedOut: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ value: fallback, timedOut: true });
    }, timeoutMs);

    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ value, timedOut: false });
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ value: fallback, timedOut: false });
      });
  });
}

function queryTerms(query: string): string[] {
  const stopWords = new Set(['the', 'and', 'for', 'with', 'from', 'what', 'when', 'where', 'how', 'does', 'are', 'was', 'latest', 'current', 'search', 'look', 'lookup', 'find', 'online']);
  return Array.from(new Set(
    query.toLowerCase()
      .split(/[^a-z0-9.$%-]+/)
      .filter(term => term.length >= 2 && !stopWords.has(term)),
  ));
}

function currentSearchYear(): number {
  return new Date().getFullYear();
}

function hasExplicitYear(query: string): boolean {
  return /\b(?:19|20)\d{2}\b/.test(query);
}

function isFreshnessSensitiveQuery(query: string): boolean {
  const normalized = query.toLowerCase();
  return /\b(latest|current|today|recent|newest|up[- ]?to[- ]?date|breaking|news|release(?: notes?)?|pricing|price|cost|version|docs?|documentation|policy|policies|law|laws|regulation|regulations|guidance|schedule|scores?)\b/.test(normalized)
    && !hasExplicitYear(query);
}

function extractReferencedYears(input: Array<string | undefined>): number[] {
  const years = new Set<number>();
  for (const text of input) {
    for (const match of (text || '').match(/\b(?:19|20)\d{2}\b/g) || []) {
      years.add(Number(match));
    }
  }
  return Array.from(years).sort((a, b) => b - a);
}

function scoreEvidence(input: {
  query: string;
  title?: string;
  url?: string;
  summary?: string;
  keyFacts?: string[];
  matchSnippets?: string[];
  dates?: string[];
}): { score: number; reasons: string[]; sufficient: boolean } {
  const terms = queryTerms(input.query);
  const titleUrl = `${input.title || ''} ${input.url || ''}`.toLowerCase();
  const body = `${input.summary || ''} ${(input.keyFacts || []).join(' ')} ${(input.matchSnippets || []).join(' ')}`.toLowerCase();
  const combined = `${titleUrl} ${body}`;
  let score = 0;
  const reasons: string[] = [];

  const matchedTerms = terms.filter(term => combined.includes(term));
  score += matchedTerms.length * 2;
  if (matchedTerms.length > 0) reasons.push(`matched terms: ${matchedTerms.slice(0, 6).join(', ')}`);

  const titleMatches = terms.filter(term => titleUrl.includes(term));
  score += titleMatches.length;
  if (titleMatches.length > 0) reasons.push('title/url relevance');

  if (/[$€£¥]|(?:usd|eur|gbp)|\b\d+(?:\.\d+)?\s*(?:%|tokens?|million|thousand|per|\/)\b/i.test(body)) {
    score += 3;
    reasons.push('numeric/pricing-style evidence');
  }
  if (/\b(?:api|pricing|price|cost|rate|input|output|token|tokens|model)\b/i.test(input.query)
    && /\b(?:api|pricing|price|cost|rate|input|output|token|tokens|model)\b/i.test(body)) {
    score += 3;
    reasons.push('query-specific evidence terms');
  }
  if ((input.keyFacts || []).length > 0) {
    score += 2;
    reasons.push('structured page facts');
  }

  const freshnessSensitive = isFreshnessSensitiveQuery(input.query);
  const currentYear = currentSearchYear();
  const referencedYears = extractReferencedYears([
    input.title,
    input.url,
    input.summary,
    ...(input.keyFacts || []),
    ...(input.matchSnippets || []),
    ...(input.dates || []),
  ]);
  const newestYear = referencedYears[0] ?? null;
  if (freshnessSensitive && newestYear !== null) {
    if (newestYear >= currentYear) {
      score += 5;
      reasons.push(`current-year evidence (${newestYear})`);
    } else if (newestYear === currentYear - 1) {
      score += 1;
      reasons.push(`recent evidence (${newestYear})`);
    } else {
      score -= 4;
      reasons.push(`stale evidence (${newestYear})`);
    }
  }

  return {
    score,
    reasons,
    sufficient: freshnessSensitive
      ? ((newestYear !== null && newestYear >= currentYear && score >= 9)
        || (matchedTerms.length >= Math.min(4, Math.max(2, terms.length)) && newestYear !== null && newestYear >= currentYear && score >= 8))
      : (score >= 9 || (matchedTerms.length >= Math.min(4, Math.max(2, terms.length)) && score >= 7)),
  };
}

async function waitForBrowserSettled(timeoutMs = 7000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = browserService.getState();
    if (!state.navigation.isLoading) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

async function cachePageForTab(pageExtractor: PageExtractor, tabId: string): Promise<{
  id: string;
  tabId: string;
  url: string;
  title: string;
  chunkIds: string[];
}> {
  const content = await pageExtractor.extractContent(tabId);
  const page = pageKnowledgeStore.cachePage({
    tabId,
    url: content.url,
    title: content.title,
    content: content.content,
    tier: content.tier,
  });
  return {
    id: page.id,
    tabId: page.tabId,
    url: page.url,
    title: page.title,
    chunkIds: page.chunkIds,
  };
}

async function waitForCondition(input: {
  selector?: string;
  text?: string;
  state: 'present' | 'absent';
  tabId?: string;
  timeoutMs: number;
}): Promise<{ success: boolean; elapsedMs: number; matched: boolean }> {
  const start = Date.now();
  while (Date.now() - start < input.timeoutMs) {
    let matched = false;
    if (input.selector) {
      const query = JSON.stringify(input.selector);
      const result = await browserService.executeInPage(
        `Boolean(document.querySelector(${query}))`,
        input.tabId,
      );
      matched = result.result === true;
    }
    if (input.text) {
      const result = await browserService.executeInPage(
        buildWaitForTextExpression(),
        input.tabId,
      );
      matched = matched || (typeof result.result === 'string' && includesText(result.result, input.text));
    }

    const success = input.state === 'present' ? matched : !matched;
    if (success) {
      return { success: true, elapsedMs: Date.now() - start, matched };
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return { success: false, elapsedMs: Date.now() - start, matched: false };
}

export function createBrowserToolDefinitions(): AgentToolDefinition[] {
  const pageExtractor = new PageExtractor((expression, tabId) => browserService.executeInPage(expression, tabId));
  const webIntentVm = new WebIntentVM({
    async navigate(url, tabId) {
      if (tabId) {
        await runBrowserOperation('browser.activate-tab', { tabId });
      }
      await runBrowserOperation('browser.navigate', { url });
    },
    async waitForSettled(timeoutMs = 7000) {
      await waitForBrowserSettled(timeoutMs);
    },
    async getCurrentUrl(tabId) {
      if (tabId) {
        const tab = browserService.getTabs().find(item => item.id === tabId);
        if (tab?.navigation.url) return tab.navigation.url;
      }
      return browserService.getState().navigation.url;
    },
    async readPageState(tabId) {
      const snapshot = await browserService.captureTabSnapshot(tabId);
      return {
        url: snapshot.url,
        title: snapshot.title,
        text: snapshot.visibleTextExcerpt,
        mainHeading: snapshot.mainHeading,
      };
    },
    async getDialogs(tabId) {
      const result = await runBrowserOperation('browser.get-dialogs', { tabId });
      return (result.data.dialogs as ReturnType<typeof browserService.getPendingDialogs>) || [];
    },
    async acceptDialog(input) {
      const result = await runBrowserOperation('browser.accept-dialog', input, { invalidateCache: true });
      return result.data.result as Awaited<ReturnType<typeof browserService.acceptDialog>>;
    },
    async dismissDialog(input) {
      const result = await runBrowserOperation('browser.dismiss-dialog', input, { invalidateCache: true });
      return result.data.result as Awaited<ReturnType<typeof browserService.dismissDialog>>;
    },
    async getActionableElements(tabId) {
      const result = await runBrowserOperation('browser.get-actionable-elements', { tabId });
      return (result.data.elements as Awaited<ReturnType<typeof browserService.getActionableElements>>) || [];
    },
    async getFormModel(tabId) {
      return browserService.getFormModel(tabId);
    },
    async click(selector, tabId) {
      const result = await runBrowserOperation('browser.click', { selector, tabId }, { invalidateCache: true });
      return result.data.result as Awaited<ReturnType<typeof browserService.clickElement>>;
    },
    async type(selector, text, tabId) {
      const result = await runBrowserOperation('browser.type', { selector, text, tabId }, { invalidateCache: true });
      return result.data.result as Awaited<ReturnType<typeof browserService.typeInElement>>;
    },
    async upload(selector, filePath, tabId) {
      const result = await runBrowserOperation('browser.upload-file', { selector, filePath, tabId }, { invalidateCache: true });
      return result.data.result as Awaited<ReturnType<typeof browserService.uploadFileToElement>>;
    },
    async drag(sourceSelector, targetSelector, tabId) {
      const result = await runBrowserOperation(
        'browser.drag',
        { sourceSelector, targetSelector, tabId },
        { invalidateCache: true },
      );
      return result.data.result as Awaited<ReturnType<typeof browserService.dragElement>>;
    },
    async hover(selector, tabId) {
      const result = await runBrowserOperation('browser.hover', { selector, tabId }, { invalidateCache: true });
      return result.data.result as Awaited<ReturnType<typeof browserService.hoverElement>>;
    },
    async executeInPage(expression, tabId) {
      return browserService.executeInPage(expression, tabId);
    },
  });

  return [
    {
      name: 'browser.get_state',
      description: 'Return current browser state.',
      inputSchema: { type: 'object' },
      async execute() {
        return runBrowserOperation('browser.get-state', {});
      },
    },
    {
      name: 'browser.get_tabs',
      description: 'Return open browser tabs.',
      inputSchema: { type: 'object' },
      async execute() {
        return runBrowserOperation('browser.get-tabs', {});
      },
    },
    {
      name: 'browser.navigate',
      description: 'Navigate the active browser tab to a URL or direct address. This does not open a new tab; use browser.create_tab when the user asks for a new, separate, or additional tab. For user requests phrased as "search ..." use browser.search_web instead.',
      inputSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string' } } },
      async execute(input) {
        requireBrowserCreated();
        const url = requireString(objectInput(input), 'url');
        return runBrowserOperation('browser.navigate', { url }, { invalidateCache: true });
      },
    },
    {
      name: 'browser.search_web',
      description: 'Search the web in the owned browser using the configured search engine. Use this whenever the user says search, look up, find online, research online, or asks for current web information.',
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const query = requireString(requireObjectInput(input, 'browser.search_web'), 'query');
        const result = await runBrowserOperation('browser.search-web', { query }, { invalidateCache: true });
        logBrowserCache(`Opened web search for "${query}"`);
        return result;
      },
    },
    {
      name: 'browser.research_search',
      description: 'Run the default browser research workflow for a web query: open search results in the owned browser, cache the search page, parse result links, optionally open top results, cache those pages, and return compact evidence. Use this as the first tool for web search tasks.',
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string' },
          maxPages: { type: 'number' },
          openTopResults: { type: 'number' },
          resultLimit: { type: 'number' },
          stopWhenAnswerFound: { type: 'boolean' },
          minEvidenceScore: { type: 'number' },
        },
      },
      async execute(input, context) {
        requireBrowserCreated();
        const obj = requireObjectInput(input, 'browser.research_search');
        const query = requireString(obj, 'query');
        const resultLimit = Math.min(optionalNumber(obj, 'resultLimit', 8), 12);
        const maxPages = Math.min(
          optionalNumber(obj, 'maxPages', optionalNumber(obj, 'openTopResults', 3)),
          5,
        );
        const stopWhenAnswerFound = obj.stopWhenAnswerFound === false ? false : true;
        const minEvidenceScore = optionalNumber(obj, 'minEvidenceScore', 9);
        const progress = (message: string): void => {
          context.onProgress?.(`tool-progress:Browser: research "${query}" -> ${message}`);
        };

        progress('opening search results');
        await runBrowserOperation('browser.search-web', { query }, { invalidateCache: true });

        const searchState = browserService.getState();
        const searchTabId = searchState.activeTabId;
        if (!searchTabId) throw new Error('No active browser tab after web search');

        progress('extracting search results');
        const searchResults = await browserService.extractSearchResults(searchTabId, resultLimit);
        const defaultRankedResults = {
          results: searchResults,
          modelId: null,
          reason: null,
        };
        const rankedResult = await resolveWithSoftTimeout(
          geminiSidecar.rankSearchResults(query, searchResults.map(result => ({
            index: result.index,
            title: result.title,
            url: result.url,
            snippet: result.snippet,
          }))),
          SIDECAR_RANK_TIMEOUT_MS,
          defaultRankedResults,
        );
        const ranked = rankedResult.value;
        const rankedSearchResults = ranked.results.map(result => {
          const original = searchResults.find(item => item.index === result.index);
          return original || result;
        });

        const openedPages: Array<Record<string, unknown>> = [];
        const skippedResults: Array<Record<string, unknown>> = [];
        let stoppedEarly = false;
        let stopReason = '';
        const targets = rankedSearchResults.slice(0, maxPages);
        for (const target of targets) {
          progress(`opening result ${target.index}: ${compactText(target.title, 80)}`);
          const createTabResult = await runBrowserOperation('browser.create-tab', { url: target.url });
          const tabId = typeof createTabResult.data.tabId === 'string' ? createTabResult.data.tabId : '';
          if (!tabId) throw new Error(`Browser create-tab did not return a tab id for ${target.url}`);
          await waitForBrowserSettled(10_000);
          const [page, evidence] = await Promise.all([
            cachePageForTab(pageExtractor, tabId),
            browserService.extractPageEvidence(tabId),
          ]);
          const relevantChunks = pageKnowledgeStore.answerFromCache(query, {
            tabId,
            limit: 4,
          });
          const matchSnippets = relevantChunks.matches.map(match => match.snippet);
          const score = scoreEvidence({
            query,
            title: evidence?.title || page.title || target.title,
            url: evidence?.url || page.url || target.url,
            summary: evidence?.summary,
            keyFacts: evidence?.keyFacts,
            matchSnippets,
          });
          const judgeResult = await resolveWithSoftTimeout(
            geminiSidecar.judgeEvidence({
              query,
              title: evidence?.title || page.title || target.title,
              url: evidence?.url || page.url || target.url,
              summary: evidence?.summary || '',
              keyFacts: evidence?.keyFacts || [],
              snippets: matchSnippets,
            }),
            SIDECAR_JUDGE_TIMEOUT_MS,
            null,
          );
          const geminiJudge = judgeResult.value;
          const geminiScore = geminiJudge ? Math.round(geminiJudge.score * 1.2) : null;
          const sufficient = geminiJudge?.sufficient === true || score.score >= minEvidenceScore || score.sufficient;
          progress(
            sufficient
              ? `result ${target.index} appears sufficient`
              : `result ${target.index} reviewed; continuing`,
          );
          openedPages.push({
            tabId,
            resultIndex: target.index,
            title: evidence?.title || page.title || target.title,
            url: evidence?.url || page.url || target.url,
            resultSnippet: compactText(target.snippet, 180),
            pageId: page.id,
            chunkCount: page.chunkIds.length,
            summary: compactText(evidence?.summary, 360),
            keyFacts: (evidence?.keyFacts || []).slice(0, 4).map(fact => compactText(fact, 240)),
            dates: (evidence?.dates || []).slice(0, 4),
            sourceLinks: (evidence?.sourceLinks || []).slice(0, 4),
            suggestedChunkIds: relevantChunks.suggestedChunkIds,
            evidenceScore: geminiScore ?? score.score,
            deterministicEvidenceScore: score.score,
            answerLikely: sufficient,
            scoreReasons: geminiJudge?.reasons.length ? geminiJudge.reasons : score.reasons,
            judgeModel: geminiJudge?.modelId || null,
            judgeTimedOut: judgeResult.timedOut,
            answerEvidence: geminiJudge?.compactEvidence.length ? geminiJudge.compactEvidence : relevantChunks.matches.slice(0, 2).map(match => compactText(match.snippet, 320)),
            topMatches: relevantChunks.matches.slice(0, 3).map(match => ({
              chunkId: match.chunkId,
              heading: compactText(match.heading, 100),
              snippet: compactText(match.snippet, 260),
              score: match.score,
            })),
          });
          if (stopWhenAnswerFound && sufficient) {
            stoppedEarly = true;
            stopReason = geminiJudge?.sufficient
              ? `Stopped after result ${target.index}; Gemini judged cached evidence sufficient.`
              : `Stopped after result ${target.index}; cached evidence score ${score.score} met threshold ${minEvidenceScore}.`;
            skippedResults.push(...rankedSearchResults.slice(openedPages.length, maxPages).map(result => ({
              index: result.index,
              title: compactText(result.title, 140),
              url: result.url,
            })));
            break;
          }
        }

        progress(stoppedEarly ? 'stopping after sufficient evidence' : 'research pass complete');
        await runBrowserOperation('browser.activate-tab', { tabId: searchTabId }, { invalidateCache: true });
        invalidateBrowserCaches();
        logBrowserCache(`Research search "${query}" parsed ${searchResults.length} results, opened ${openedPages.length} page(s), stoppedEarly=${stoppedEarly}`);

        return {
          summary: `Searched "${query}", found ${searchResults.length} results, opened ${openedPages.length} page(s)${stoppedEarly ? ' and stopped early' : ''}`,
          data: {
            query,
            stoppedEarly,
            stopReason: stopReason || null,
            sidecar: {
              configured: geminiSidecar.isConfigured(),
              rankModel: ranked.modelId,
              rankReason: rankedResult.timedOut
                ? 'timed out; used browser result order'
                : ranked.reason,
              rankTimedOut: rankedResult.timedOut,
            },
            maxPages,
            stopWhenAnswerFound,
            minEvidenceScore,
            searchSurface: {
              tabId: searchTabId,
              title: searchState.navigation.title,
              url: searchState.navigation.url,
            },
            searchResults: rankedSearchResults.map(result => ({
              index: result.index,
              title: compactText(result.title, 140),
              url: result.url,
              snippet: compactText(result.snippet, 180),
            })),
            openedPages,
            skippedResults,
            nextStep: openedPages.length > 0
              ? 'Answer only from openedPages evidence or open another result if more evidence is needed.'
              : 'Open a result before answering.',
          },
        };
      },
    },
    {
      name: 'browser.back',
      description: 'Go back in the active browser tab.',
      inputSchema: { type: 'object' },
      async execute() {
        requireBrowserCreated();
        const result = await runBrowserOperation('browser.back', {}, { invalidateCache: true });
        await waitForBrowserSettled();
        return result;
      },
    },
    {
      name: 'browser.forward',
      description: 'Go forward in the active browser tab.',
      inputSchema: { type: 'object' },
      async execute() {
        requireBrowserCreated();
        const result = await runBrowserOperation('browser.forward', {}, { invalidateCache: true });
        await waitForBrowserSettled();
        return result;
      },
    },
    {
      name: 'browser.reload',
      description: 'Reload the active browser tab.',
      inputSchema: { type: 'object' },
      async execute() {
        requireBrowserCreated();
        const result = await runBrowserOperation('browser.reload', {}, { invalidateCache: true });
        await waitForBrowserSettled();
        return result;
      },
    },
    {
      name: 'browser.create_tab',
      description: 'Create a new browser tab, optionally with a starting URL. Use this when the user asks to open something in a new, separate, or additional tab.',
      inputSchema: { type: 'object', properties: { url: { type: 'string' } } },
      async execute(input) {
        requireBrowserCreated();
        const url = optionalString(objectInput(input), 'url');
        const result = await runBrowserOperation('browser.create-tab', { url }, { invalidateCache: true });
        await waitForBrowserSettled();
        return {
          summary: result.summary,
          data: {
            ...result.data,
            activeTabId: browserService.getState().activeTabId,
            tabs: browserService.getTabs(),
          },
        };
      },
    },
    {
      name: 'browser.close_tab',
      description: 'Close one or more browser tabs by id. The browser keeps one tab alive; closing the final tab navigates it to the configured homepage (Google by default). Treat a single remaining homepage tab as the expected floor state, and use browser.get_tabs before claiming the final tab state.',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: { type: 'string' },
          tabIds: { type: 'array', items: { type: 'string' } },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const tabIds = optionalStringArray(obj, 'tabIds');
        const singleTabId = optionalString(obj, 'tabId');
        const ids = Array.from(new Set([...(singleTabId ? [singleTabId] : []), ...tabIds]));
        if (ids.length === 0) throw new Error('Expected tabId or tabIds for browser.close_tab.');

        for (const tabId of ids) {
          await runBrowserOperation('browser.close-tab', { tabId }, { invalidateCache: true });
          // Add 100ms delay between close operations to ensure proper synchronization
          if (ids.length > 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        const tabs = browserService.getTabs();
        const homepage = browserService.getSettings().homepage;
        const retainedLastTabId = ids.find((tabId) => tabs.some((tab) => tab.id === tabId)) ?? null;
        return {
          summary: retainedLastTabId && tabs.length === 1
            ? `Closed ${ids.length} browser tab${ids.length === 1 ? '' : 's'}; retained one homepage tab`
            : `Closed ${ids.length} browser tab${ids.length === 1 ? '' : 's'}`,
          data: {
            tabIds: ids,
            homepage,
            retainedLastTabId,
            activeTabId: browserService.getState().activeTabId,
            tabs,
          },
        };
      },
    },
    {
      name: 'browser.activate_tab',
      description: 'Activate a browser tab.',
      inputSchema: { type: 'object', required: ['tabId'], properties: { tabId: { type: 'string' } } },
      async execute(input) {
        requireBrowserCreated();
        const tabId = requireString(objectInput(input), 'tabId');
        const result = await runBrowserOperation('browser.activate-tab', { tabId }, { invalidateCache: true });
        return {
          summary: result.summary,
          data: {
            ...result.data,
            activeTabId: browserService.getState().activeTabId,
            tabs: browserService.getTabs(),
          },
        };
      },
    },
    {
      name: 'browser.click',
      description: 'Click a page element by selector.',
      inputSchema: { type: 'object', required: ['selector'], properties: { selector: { type: 'string' }, tabId: { type: 'string' } } },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const selector = requireString(obj, 'selector');
        return runBrowserOperation(
          'browser.click',
          { selector, tabId: optionalString(obj, 'tabId') },
          { invalidateCache: true },
        );
      },
    },
    {
      name: 'browser.type',
      description: 'Type text into a page element by selector.',
      inputSchema: { type: 'object', required: ['selector', 'text'], properties: { selector: { type: 'string' }, text: { type: 'string' }, tabId: { type: 'string' } } },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const selector = requireString(obj, 'selector');
        const text = requireString(obj, 'text');
        return runBrowserOperation(
          'browser.type',
          { selector, text, tabId: optionalString(obj, 'tabId') },
          { invalidateCache: true },
        );
      },
    },
    {
      name: 'browser.upload_file',
      description: 'Attach a local file to an input[type="file"] element by selector.',
      inputSchema: { type: 'object', required: ['selector', 'filePath'], properties: { selector: { type: 'string' }, filePath: { type: 'string' }, tabId: { type: 'string' } } },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const selector = requireString(obj, 'selector');
        const filePath = requireString(obj, 'filePath');
        return runBrowserOperation(
          'browser.upload-file',
          { selector, filePath, tabId: optionalString(obj, 'tabId') },
          { invalidateCache: true },
        );
      },
    },
    {
      name: 'browser.download_link',
      description: 'Start a tracked browser download from a page link selector without relying on normal click/navigation behavior.',
      inputSchema: { type: 'object', required: ['selector'], properties: { selector: { type: 'string' }, tabId: { type: 'string' } } },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const selector = requireString(obj, 'selector');
        return runBrowserOperation(
          'browser.download-link',
          { selector, tabId: optionalString(obj, 'tabId') },
          { invalidateCache: true },
        );
      },
    },
    {
      name: 'browser.download_url',
      description: 'Start a tracked browser download from an explicit URL.',
      inputSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string' }, tabId: { type: 'string' } } },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const url = requireString(obj, 'url');
        return runBrowserOperation(
          'browser.download-url',
          { url, tabId: optionalString(obj, 'tabId') },
          { invalidateCache: true },
        );
      },
    },
    {
      name: 'browser.get_downloads',
      description: 'Return current and completed browser downloads.',
      inputSchema: {
        type: 'object',
        properties: {
          state: { type: 'string' },
          filename: { type: 'string' },
          tabId: { type: 'string' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        return runBrowserOperation('browser.get-downloads', {
          state: optionalString(obj, 'state'),
          filename: optionalString(obj, 'filename'),
          tabId: optionalString(obj, 'tabId'),
        });
      },
    },
    {
      name: 'browser.wait_for_download',
      description: 'Wait for a browser download to complete or settle.',
      inputSchema: {
        type: 'object',
        properties: {
          downloadId: { type: 'string' },
          filename: { type: 'string' },
          tabId: { type: 'string' },
          timeoutMs: { type: 'number' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        return runBrowserOperation('browser.wait-for-download', {
          downloadId: optionalString(obj, 'downloadId'),
          filename: optionalString(obj, 'filename'),
          tabId: optionalString(obj, 'tabId'),
          timeoutMs: optionalNumber(obj, 'timeoutMs', 15_000),
        });
      },
    },
    {
      name: 'browser.drag',
      description: 'Drag one page element onto another by selector using native input plus DOM drag/drop events.',
      inputSchema: {
        type: 'object',
        required: ['sourceSelector', 'targetSelector'],
        properties: {
          sourceSelector: { type: 'string' },
          targetSelector: { type: 'string' },
          tabId: { type: 'string' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const sourceSelector = requireString(obj, 'sourceSelector');
        const targetSelector = requireString(obj, 'targetSelector');
        return runBrowserOperation(
          'browser.drag',
          { sourceSelector, targetSelector, tabId: optionalString(obj, 'tabId') },
          { invalidateCache: true },
        );
      },
    },
    {
      name: 'browser.hover',
      description: 'Move the native pointer over an element by selector.',
      inputSchema: {
        type: 'object',
        required: ['selector'],
        properties: {
          selector: { type: 'string' },
          tabId: { type: 'string' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const selector = requireString(obj, 'selector');
        return runBrowserOperation(
          'browser.hover',
          { selector, tabId: optionalString(obj, 'tabId') },
          { invalidateCache: true },
        );
      },
    },
    {
      name: 'browser.hit_test',
      description: 'Check whether a selector is the topmost clickable element at its center point.',
      inputSchema: {
        type: 'object',
        required: ['selector'],
        properties: {
          selector: { type: 'string' },
          tabId: { type: 'string' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const selector = requireString(obj, 'selector');
        return runBrowserOperation('browser.hit-test', {
          selector,
          tabId: optionalString(obj, 'tabId'),
        });
      },
    },
    {
      name: 'browser.extract_page',
      description: 'Fallback only: extract active page text and metadata when cached page search/chunk reads are missing or insufficient. Prefer browser.search_page_cache and browser.read_cached_chunk first.',
      inputSchema: { type: 'object', properties: { maxLength: { type: 'number' }, tabId: { type: 'string' } } },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const maxLength = typeof obj.maxLength === 'number' ? obj.maxLength : 8000;
        const text = await browserService.getPageText(Math.min(maxLength, 6000));
        const metadata = await browserService.getPageMetadata(optionalString(obj, 'tabId'));
        logBrowserCache(`Broad page extraction fallback used (${text.length} chars)`, 'warn');
        return { summary: `Extracted ${text.length} characters from page`, data: { text, metadata } };
      },
    },
    {
      name: 'browser.cache_current_page',
      description: 'Cache the active page into cleaned, searchable chunks. Use before page-cache search if the current page may not have been cached yet.',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: { type: 'string' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const tabId = optionalString(objectInput(input), 'tabId') || browserService.getState().activeTabId;
        if (!tabId) throw new Error('No active tab to cache');
        const page = await cachePageForTab(pageExtractor, tabId);
        logBrowserCache(`Cached current page into ${page.chunkIds.length} chunks: ${page.title || page.url}`);
        return {
          summary: `Cached page ${page.title || page.url} into ${page.chunkIds.length} chunks`,
          data: { page },
        };
      },
    },
    {
      name: 'browser.answer_from_cache',
      description: 'Cheap first-pass retrieval for a browser question. Searches cached page chunks and returns snippets plus suggested chunk ids without broad page extraction.',
      inputSchema: {
        type: 'object',
        required: ['question'],
        properties: {
          question: { type: 'string' },
          tabId: { type: 'string' },
          pageId: { type: 'string' },
          limit: { type: 'number' },
        },
      },
      async execute(input) {
        const obj = objectInput(input);
        const question = requireString(obj, 'question');
        const answer = pageKnowledgeStore.answerFromCache(question, {
          tabId: optionalString(obj, 'tabId'),
          pageId: optionalString(obj, 'pageId'),
          limit: Math.min(optionalNumber(obj, 'limit', 8), 20),
        });
        logBrowserCache(
          `Cache answer ${answer.answerable ? 'hit' : 'miss'} for "${question}" (${answer.matches.length} matches, est ${answer.tokenEstimate} tokens)`,
          answer.answerable ? 'info' : 'warn',
        );
        return {
          summary: answer.answerable
            ? `Cache found ${answer.matches.length} relevant chunks`
            : 'Cache had no relevant chunks',
          data: answer,
        };
      },
    },
    {
      name: 'browser.search_page_cache',
      description: 'Search cached browser page chunks and return compact snippets plus chunk ids. Prefer this before reading full page text.',
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string' },
          tabId: { type: 'string' },
          pageId: { type: 'string' },
          limit: { type: 'number' },
        },
      },
      async execute(input) {
        const obj = objectInput(input);
        const query = requireString(obj, 'query');
        const results = pageKnowledgeStore.search(query, {
          tabId: optionalString(obj, 'tabId'),
          pageId: optionalString(obj, 'pageId'),
          limit: Math.min(optionalNumber(obj, 'limit', 8), 20),
        });
        logBrowserCache(`Cache search ${results.length > 0 ? 'hit' : 'miss'} for "${query}" (${results.length} matches)`, results.length > 0 ? 'info' : 'warn');
        return {
          summary: `Found ${results.length} cached page chunks for "${query}"`,
          data: { results },
        };
      },
    },
    {
      name: 'browser.read_cached_chunk',
      description: 'Read a specific cached page chunk by chunk id. Use after browser.search_page_cache returns a relevant chunk id.',
      inputSchema: {
        type: 'object',
        required: ['chunkId'],
        properties: {
          chunkId: { type: 'string' },
          maxChars: { type: 'number' },
        },
      },
      async execute(input) {
        const obj = objectInput(input);
        const chunkId = requireString(obj, 'chunkId');
        const chunk = pageKnowledgeStore.readChunk(chunkId, Math.min(optionalNumber(obj, 'maxChars', 2400), 6000));
        if (!chunk) throw new Error(`Cached page chunk not found: ${chunkId}`);
        logBrowserCache(`Read cached chunk ${chunkId} (est ${chunk.tokenEstimate} tokens)`);
        return {
          summary: `Read cached chunk ${chunkId}`,
          data: { chunk },
        };
      },
    },
    {
      name: 'browser.cache_stats',
      description: 'Return browser page-cache stats including pages, chunks, estimated stored tokens, and search hit/miss counts.',
      inputSchema: { type: 'object' },
      async execute() {
        const stats = pageKnowledgeStore.getStats();
        return {
          summary: `Browser cache has ${stats.pageCount} pages and ${stats.chunkCount} chunks`,
          data: { stats },
        };
      },
    },
    {
      name: 'browser.list_cached_pages',
      description: 'List cached browser pages with page ids, tab ids, titles, urls, headings, and chunk counts.',
      inputSchema: { type: 'object' },
      async execute() {
        const pages = pageKnowledgeStore.listPages().map(page => ({
          id: page.id,
          tabId: page.tabId,
          url: page.url,
          title: page.title,
          tier: page.tier,
          chunkCount: page.chunkIds.length,
          headings: page.headings.slice(0, 20),
          updatedAt: page.updatedAt,
        }));
        return {
          summary: `Listed ${pages.length} cached pages`,
          data: { pages },
        };
      },
    },
    {
      name: 'browser.list_cached_sections',
      description: 'List cached page sections/headings for a page id or tab id, with chunk ids for targeted reads.',
      inputSchema: {
        type: 'object',
        required: ['pageIdOrTabId'],
        properties: {
          pageIdOrTabId: { type: 'string' },
        },
      },
      async execute(input) {
        const pageIdOrTabId = requireString(objectInput(input), 'pageIdOrTabId');
        const sections = pageKnowledgeStore.listSections(pageIdOrTabId);
        return {
          summary: `Listed ${sections.length} cached sections`,
          data: { sections },
        };
      },
    },
    {
      name: 'browser.inspect_page',
      description: 'Inspect the active page with navigation, metadata, visible text excerpt, forms, viewport, and top actionable elements.',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: { type: 'string' },
          textLimit: { type: 'number' },
          elementLimit: { type: 'number' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        return runBrowserOperation('browser.inspect-page', {
          tabId: optionalString(obj, 'tabId'),
          textLimit: Math.min(optionalNumber(obj, 'textLimit', 3000), 6000),
          elementLimit: Math.min(optionalNumber(obj, 'elementLimit', 30), 80),
        });
      },
    },
    {
      name: 'browser.find_element',
      description: 'Find actionable elements by visible text, label, role, selector, or href. Returns candidate selectors for click/type tools.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          selector: { type: 'string' },
          tabId: { type: 'string' },
          limit: { type: 'number' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const query = optionalString(obj, 'query');
        const selector = optionalString(obj, 'selector');
        const tabId = optionalString(obj, 'tabId');
        const limit = Math.min(optionalNumber(obj, 'limit', 20), 80);

        if (selector) {
          const elements = await browserService.querySelectorAll(selector, tabId, limit);
          return {
            summary: `Found ${elements.length} elements for selector ${selector}`,
            data: { elements },
          };
        }

        if (!query) throw new Error('Expected query or selector');
        const elements = await browserService.getActionableElements(tabId);
        const matches = elements.filter((element) => {
          const haystack = [
            element.text,
            element.ariaLabel,
            element.role,
            element.ref?.selector,
            element.href,
          ].filter(Boolean).join(' ');
          return includesText(haystack, query);
        }).slice(0, limit);
        return {
          summary: `Found ${matches.length} actionable elements matching "${query}"`,
          data: { elements: matches },
        };
      },
    },
    {
      name: 'browser.click_text',
      description: 'Click the first actionable element whose text, label, role, selector, or href contains the given text.',
      inputSchema: {
        type: 'object',
        required: ['text'],
        properties: {
          text: { type: 'string' },
          tabId: { type: 'string' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const text = requireString(obj, 'text');
        const tabId = optionalString(obj, 'tabId');
        const elements = await browserService.getActionableElements(tabId);
        const match = elements.find((element) => {
          const haystack = [
            element.text,
            element.ariaLabel,
            element.role,
            element.ref?.selector,
            element.href,
          ].filter(Boolean).join(' ');
          return includesText(haystack, text);
        });
        if (!match?.ref?.selector) {
          throw new Error(`No clickable element found for text: ${text}`);
        }
        const result = await runBrowserOperation(
          'browser.click',
          { selector: match.ref.selector, tabId },
          { invalidateCache: true },
        );
        return {
          summary: `Clicked text "${text}"`,
          data: { result: result.data.result, element: match },
        };
      },
    },
    {
      name: 'browser.wait_for',
      description: 'Wait until page load settles, a selector/text is present, or a selector/text is absent.',
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string' },
          text: { type: 'string' },
          state: { type: 'string', enum: ['present', 'absent', 'load'] },
          tabId: { type: 'string' },
          timeoutMs: { type: 'number' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const timeoutMs = Math.min(optionalNumber(obj, 'timeoutMs', 7000), 30_000);
        const state = obj.state === 'absent' || obj.state === 'load' ? obj.state : 'present';
        if (state === 'load') {
          await waitForBrowserSettled(timeoutMs);
          return {
            summary: 'Browser load settled',
            data: { navigation: browserService.getState().navigation },
          };
        }
        const result = await waitForCondition({
          selector: optionalString(obj, 'selector'),
          text: optionalString(obj, 'text'),
          state,
          tabId: optionalString(obj, 'tabId'),
          timeoutMs,
        });
        return {
          summary: result.success ? `Wait condition ${state} satisfied` : `Wait condition ${state} timed out`,
          data: result,
        };
      },
    },
    {
      name: 'browser.summarize_page',
      description: 'Return a compact structured summary of the active tab or working tab set.',
      inputSchema: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          tabIds: { type: 'array', items: { type: 'string' } },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const tabIds = Array.isArray(obj.tabIds) ? obj.tabIds.filter((id): id is string => typeof id === 'string') : undefined;
        const question = optionalString(obj, 'question');
        const [evidence, workingSet] = await Promise.all([
          browserService.extractPageEvidence(tabIds?.[0]),
          browserService.summarizeTabWorkingSet(tabIds),
        ]);
        const brief = await browserService.synthesizeResearchBrief({ tabIds, question });
        return {
          summary: evidence?.title ? `Summarized ${evidence.title}` : 'Summarized browser page',
          data: { evidence, workingSet, brief },
        };
      },
    },
    {
      name: 'browser.evaluate_js',
      description: 'Unsafe diagnostic escape hatch. Evaluate JavaScript in the active page outside canonical browser-operation semantics. Use for inspection/debugging unless the user explicitly asks to mutate page state.',
      inputSchema: {
        type: 'object',
        required: ['expression'],
        properties: {
          expression: { type: 'string' },
          tabId: { type: 'string' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const expression = requireString(obj, 'expression');
        if (expression.length > 4000) throw new Error('JavaScript expression is too long');
        const result = await browserService.executeInPage(expression, optionalString(obj, 'tabId'));
        return {
          summary: result.error ? `Unsafe JavaScript evaluation failed: ${result.error}` : 'Executed unsafe JavaScript evaluation',
          data: result,
        };
      },
    },
    {
      name: 'browser.get_console_events',
      description: 'Return recent browser console events for diagnostics.',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: { type: 'string' },
          since: { type: 'number' },
          level: { type: 'string' },
          limit: { type: 'number' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const level = optionalString(obj, 'level');
        const limit = Math.min(Math.max(Math.floor(optionalNumber(obj, 'limit', 50)), 1), 250);
        const events = browserService
          .getConsoleEvents(optionalString(obj, 'tabId'), optionalNumber(obj, 'since', 0) || undefined)
          .filter(event => !level || event.level === level)
          .slice(-limit);
        const errorCount = events.filter(event => event.level === 'error').length;
        const warnCount = events.filter(event => event.level === 'warn').length;
        return {
          summary: `Read ${events.length} console event${events.length === 1 ? '' : 's'} (${errorCount} errors, ${warnCount} warnings)`,
          data: { events },
        };
      },
    },
    {
      name: 'browser.get_network_events',
      description: 'Return recent browser network events for diagnostics.',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: { type: 'string' },
          since: { type: 'number' },
          status: { type: 'string' },
          failedOnly: { type: 'boolean' },
          limit: { type: 'number' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const status = optionalString(obj, 'status');
        const failedOnly = obj.failedOnly === true;
        const limit = Math.min(Math.max(Math.floor(optionalNumber(obj, 'limit', 80)), 1), 500);
        const events = browserService
          .getNetworkEvents(optionalString(obj, 'tabId'), optionalNumber(obj, 'since', 0) || undefined)
          .filter(event => !status || event.status === status)
          .filter(event => !failedOnly || event.status === 'failed' || (typeof event.statusCode === 'number' && event.statusCode >= 400))
          .slice(-limit);
        const failedCount = events.filter(event => event.status === 'failed' || (typeof event.statusCode === 'number' && event.statusCode >= 400)).length;
        return {
          summary: `Read ${events.length} network event${events.length === 1 ? '' : 's'} (${failedCount} failed/error responses)`,
          data: { events },
        };
      },
    },
    {
      name: 'browser.get_dialogs',
      description: 'Return pending JavaScript alert/confirm/prompt dialogs.',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: { type: 'string' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        return runBrowserOperation('browser.get-dialogs', {
          tabId: optionalString(objectInput(input), 'tabId'),
        });
      },
    },
    {
      name: 'browser.accept_dialog',
      description: 'Accept a pending JavaScript alert/confirm/prompt dialog.',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: { type: 'string' },
          dialogId: { type: 'string' },
          promptText: { type: 'string' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        return runBrowserOperation('browser.accept-dialog', {
          tabId: optionalString(obj, 'tabId'),
          dialogId: optionalString(obj, 'dialogId'),
          promptText: optionalString(obj, 'promptText'),
        }, { invalidateCache: true });
      },
    },
    {
      name: 'browser.dismiss_dialog',
      description: 'Dismiss a pending JavaScript confirm/prompt dialog.',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: { type: 'string' },
          dialogId: { type: 'string' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        return runBrowserOperation('browser.dismiss-dialog', {
          tabId: optionalString(obj, 'tabId'),
          dialogId: optionalString(obj, 'dialogId'),
        }, { invalidateCache: true });
      },
    },
    {
      name: 'browser.run_intent_program',
      description: 'Execute semantic Web Intent VM bytecode (NAVIGATE, ASSERT, INTENT.LOGIN, INTENT.ACCEPT_DIALOG, INTENT.DISMISS_DIALOG, INTENT.HOVER, INTENT.DRAG_DROP, INTENT.ADD_TO_CART, INTENT.OPEN_CART, INTENT.CHECKOUT, INTENT.FILL_CHECKOUT_INFO, INTENT.FINISH_ORDER, INTENT.UPLOAD, INTENT.EXTRACT) using selector-agnostic resolution and postcondition checks.',
      inputSchema: {
        type: 'object',
        required: ['instructions'],
        properties: {
          instructions: { type: 'array', items: { type: 'object' } },
          tabId: { type: 'string' },
          failFast: { type: 'boolean' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const instructions = Array.isArray(obj.instructions)
          ? obj.instructions.filter((item): item is WebIntentInstruction => {
            return typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).op === 'string';
          })
          : [];
        if (instructions.length === 0) {
          throw new Error('browser.run_intent_program requires a non-empty instructions array');
        }
        const result = await webIntentVm.run({
          instructions,
          tabId: optionalString(obj, 'tabId'),
          failFast: obj.failFast === false ? false : true,
        });
        invalidateBrowserCaches();
        const failedStep = result.failedAt !== null ? result.steps[result.failedAt] : null;
        const failureReason = failedStep?.error || failedStep?.evidence || 'unknown error';
        return {
          summary: result.success
            ? `Intent program completed (${result.steps.length} steps)`
            : `Intent program failed at step ${result.failedAt} (${failedStep?.op || 'unknown'}): ${failureReason}`,
          data: result,
        };
      },
    },
    {
      name: 'browser.get_actionable_elements',
      description: 'Return actionable page elements for a tab.',
      inputSchema: { type: 'object', properties: { tabId: { type: 'string' } } },
      async execute(input) {
        requireBrowserCreated();
        return runBrowserOperation('browser.get-actionable-elements', {
          tabId: optionalString(objectInput(input), 'tabId'),
        });
      },
    },
    {
      name: 'browser.capture_snapshot',
      description: 'Capture a browser tab snapshot.',
      inputSchema: { type: 'object', properties: { tabId: { type: 'string' } } },
      async execute(input) {
        requireBrowserCreated();
        return runBrowserOperation('browser.capture-snapshot', {
          tabId: optionalString(objectInput(input), 'tabId'),
        });
      },
    },
  ];
}
