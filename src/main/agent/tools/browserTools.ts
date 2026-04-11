import { AgentToolDefinition } from '../AgentTypes';
import { browserService } from '../../browser/BrowserService';
import { PageExtractor } from '../../context/pageExtractor';
import { pageKnowledgeStore } from '../../browserKnowledge/PageKnowledgeStore';
import { appStateStore } from '../../state/appStateStore';
import { ActionType } from '../../state/actions';
import { generateId } from '../../../shared/utils/ids';
import { geminiSidecar } from '../GeminiSidecar';
import { WebIntentInstruction, WebIntentVM } from '../../browser/WebIntentVM';

function objectInput(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
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

function requireBrowserCreated(): void {
  if (!browserService.isCreated()) {
    throw new Error('Browser surface is not initialized yet. Open the execution window before using browser tools.');
  }
}

function includesText(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function compactText(text: string | undefined, maxChars: number): string {
  const cleaned = (text || '').replace(/\s+/g, ' ').trim();
  return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars)}...` : cleaned;
}

function queryTerms(query: string): string[] {
  const stopWords = new Set(['the', 'and', 'for', 'with', 'from', 'what', 'when', 'where', 'how', 'does', 'are', 'was', 'latest', 'current', 'search', 'look', 'lookup', 'find', 'online']);
  return Array.from(new Set(
    query.toLowerCase()
      .split(/[^a-z0-9.$%-]+/)
      .filter(term => term.length >= 2 && !stopWords.has(term)),
  ));
}

function scoreEvidence(input: {
  query: string;
  title?: string;
  url?: string;
  summary?: string;
  keyFacts?: string[];
  matchSnippets?: string[];
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

  return {
    score,
    reasons,
    sufficient: score >= 9 || (matchedTerms.length >= Math.min(4, Math.max(2, terms.length)) && score >= 7),
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
        `document.body ? document.body.innerText : ''`,
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
      if (tabId) browserService.activateTab(tabId);
      browserService.navigate(url);
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
    async getActionableElements(tabId) {
      return browserService.getActionableElements(tabId);
    },
    async getFormModel(tabId) {
      return browserService.getFormModel(tabId);
    },
    async click(selector, tabId) {
      return browserService.clickElement(selector, tabId);
    },
    async type(selector, text, tabId) {
      return browserService.typeInElement(selector, text, tabId);
    },
    async drag(sourceSelector, targetSelector, tabId) {
      return browserService.dragElement(sourceSelector, targetSelector, tabId);
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
        return { summary: 'Read browser state', data: { state: browserService.getState() } };
      },
    },
    {
      name: 'browser.get_tabs',
      description: 'Return open browser tabs.',
      inputSchema: { type: 'object' },
      async execute() {
        return { summary: 'Read browser tabs', data: { tabs: browserService.getTabs() } };
      },
    },
    {
      name: 'browser.navigate',
      description: 'Navigate the active browser tab to a URL or direct address. For user requests phrased as "search ..." use browser.search_web instead.',
      inputSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string' } } },
      async execute(input) {
        requireBrowserCreated();
        const url = requireString(objectInput(input), 'url');
        browserService.navigate(url);
        await waitForBrowserSettled();
        const state = browserService.getState();
        return {
          summary: `Navigated to ${state.navigation.url || url}`,
          data: {
            url: state.navigation.url || url,
            title: state.navigation.title,
            isLoading: state.navigation.isLoading,
          },
        };
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
        const query = requireString(objectInput(input), 'query');
        browserService.navigate(query);
        await waitForBrowserSettled();
        const state = browserService.getState();
        logBrowserCache(`Opened web search for "${query}"`);
        return {
          summary: `Searched web for "${query}"`,
          data: {
            query,
            url: state.navigation.url,
            title: state.navigation.title,
            isLoading: state.navigation.isLoading,
          },
        };
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
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const query = requireString(obj, 'query');
        const resultLimit = Math.min(optionalNumber(obj, 'resultLimit', 8), 12);
        const maxPages = Math.min(
          optionalNumber(obj, 'maxPages', optionalNumber(obj, 'openTopResults', 3)),
          5,
        );
        const stopWhenAnswerFound = obj.stopWhenAnswerFound === false ? false : true;
        const minEvidenceScore = optionalNumber(obj, 'minEvidenceScore', 9);

        browserService.navigate(query);
        await waitForBrowserSettled(10_000);

        const searchState = browserService.getState();
        const searchTabId = searchState.activeTabId;
        if (!searchTabId) throw new Error('No active browser tab after web search');

        const searchPage = await cachePageForTab(pageExtractor, searchTabId);
        const searchResults = await browserService.extractSearchResults(searchTabId, resultLimit);
        const ranked = await geminiSidecar.rankSearchResults(query, searchResults.map(result => ({
          index: result.index,
          title: result.title,
          url: result.url,
          snippet: result.snippet,
        })));
        const rankedSearchResults = ranked.results.map(result => {
          const original = searchResults.find(item => item.index === result.index);
          return original || result;
        });
        const cacheMatches = pageKnowledgeStore.answerFromCache(query, {
          tabId: searchTabId,
          limit: 4,
        });

        const openedPages: Array<Record<string, unknown>> = [];
        const skippedResults: Array<Record<string, unknown>> = [];
        let stoppedEarly = false;
        let stopReason = '';
        const targets = rankedSearchResults.slice(0, maxPages);
        for (const target of targets) {
          const tab = browserService.createTab(target.url);
          await waitForBrowserSettled(10_000);
          const page = await cachePageForTab(pageExtractor, tab.id);
          const evidence = await browserService.extractPageEvidence(tab.id);
          const relevantChunks = pageKnowledgeStore.answerFromCache(query, {
            tabId: tab.id,
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
          const geminiJudge = await geminiSidecar.judgeEvidence({
            query,
            title: evidence?.title || page.title || target.title,
            url: evidence?.url || page.url || target.url,
            summary: evidence?.summary || '',
            keyFacts: evidence?.keyFacts || [],
            snippets: matchSnippets,
          });
          const geminiScore = geminiJudge ? Math.round(geminiJudge.score * 1.2) : null;
          const sufficient = geminiJudge?.sufficient === true || score.score >= minEvidenceScore || score.sufficient;
          openedPages.push({
            tabId: tab.id,
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

        browserService.activateTab(searchTabId);
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
              rankReason: ranked.reason,
            },
            maxPages,
            stopWhenAnswerFound,
            minEvidenceScore,
            searchPage: {
              tabId: searchPage.tabId,
              pageId: searchPage.id,
              title: searchPage.title,
              url: searchPage.url,
              chunkCount: searchPage.chunkIds.length,
            },
            searchResults: rankedSearchResults.map(result => ({
              index: result.index,
              title: compactText(result.title, 140),
              url: result.url,
              snippet: compactText(result.snippet, 180),
            })),
            searchPageSuggestedChunkIds: cacheMatches.suggestedChunkIds,
            openedPages,
            skippedResults,
            nextStep: openedPages.length > 0
              ? 'Answer only from openedPages evidence or read suggested chunk ids with browser.read_cached_chunk.'
              : 'Open a result or inspect the search page before answering.',
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
        browserService.goBack();
        await waitForBrowserSettled();
        return { summary: 'Navigated back', data: { navigation: browserService.getState().navigation } };
      },
    },
    {
      name: 'browser.forward',
      description: 'Go forward in the active browser tab.',
      inputSchema: { type: 'object' },
      async execute() {
        requireBrowserCreated();
        browserService.goForward();
        await waitForBrowserSettled();
        return { summary: 'Navigated forward', data: { navigation: browserService.getState().navigation } };
      },
    },
    {
      name: 'browser.reload',
      description: 'Reload the active browser tab.',
      inputSchema: { type: 'object' },
      async execute() {
        requireBrowserCreated();
        browserService.reload();
        await waitForBrowserSettled();
        return { summary: 'Reloaded browser tab', data: { navigation: browserService.getState().navigation } };
      },
    },
    {
      name: 'browser.create_tab',
      description: 'Create a browser tab.',
      inputSchema: { type: 'object', properties: { url: { type: 'string' } } },
      async execute(input) {
        requireBrowserCreated();
        const tab = browserService.createTab(optionalString(objectInput(input), 'url'));
        await waitForBrowserSettled();
        return { summary: `Created tab ${tab.id}`, data: { tab } };
      },
    },
    {
      name: 'browser.close_tab',
      description: 'Close one or more browser tabs by id. Use browser.get_tabs first when tab ids are unknown.',
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
          browserService.closeTab(tabId);
        }
        return { summary: `Closed ${ids.length} browser tab${ids.length === 1 ? '' : 's'}`, data: { tabIds: ids } };
      },
    },
    {
      name: 'browser.activate_tab',
      description: 'Activate a browser tab.',
      inputSchema: { type: 'object', required: ['tabId'], properties: { tabId: { type: 'string' } } },
      async execute(input) {
        requireBrowserCreated();
        const tabId = requireString(objectInput(input), 'tabId');
        browserService.activateTab(tabId);
        return { summary: `Activated tab ${tabId}`, data: { tabId } };
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
        const result = await browserService.clickElement(selector, optionalString(obj, 'tabId'));
        return { summary: `Clicked ${selector}`, data: { result } };
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
        const result = await browserService.typeInElement(selector, text, optionalString(obj, 'tabId'));
        return { summary: `Typed into ${selector}`, data: { result } };
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
        const result = await browserService.dragElement(sourceSelector, targetSelector, optionalString(obj, 'tabId'));
        return {
          summary: result.dragged
            ? `Dragged ${sourceSelector} to ${targetSelector}`
            : `Drag failed from ${sourceSelector} to ${targetSelector}: ${result.error || 'unknown error'}`,
          data: { result },
        };
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
        const tabId = optionalString(obj, 'tabId');
        const textLimit = Math.min(optionalNumber(obj, 'textLimit', 3000), 6000);
        const elementLimit = Math.min(optionalNumber(obj, 'elementLimit', 30), 80);
        const [metadata, text, snapshot, forms] = await Promise.all([
          browserService.getPageMetadata(tabId),
          browserService.getPageText(textLimit),
          browserService.captureTabSnapshot(tabId),
          browserService.getFormModel(tabId),
        ]);
        return {
          summary: `Inspected page ${snapshot.title || snapshot.url}`,
          data: {
            navigation: browserService.getState().navigation,
            metadata,
            text,
            viewport: snapshot.viewport,
            forms,
            actionableElements: snapshot.actionableElements.slice(0, elementLimit),
          },
        };
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
        const result = await browserService.clickElement(match.ref.selector, tabId);
        return {
          summary: `Clicked text "${text}"`,
          data: { result, element: match },
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
      description: 'Evaluate JavaScript in the active browser page. Use for inspection only unless the user asks to manipulate page state.',
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
          summary: result.error ? `JavaScript evaluation failed: ${result.error}` : 'Evaluated JavaScript',
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
      name: 'browser.run_intent_program',
      description: 'Execute semantic Web Intent VM bytecode (NAVIGATE, ASSERT, INTENT.LOGIN, INTENT.DRAG_DROP, INTENT.ADD_TO_CART, INTENT.OPEN_CART, INTENT.CHECKOUT, INTENT.FILL_CHECKOUT_INFO, INTENT.FINISH_ORDER, INTENT.UPLOAD, INTENT.EXTRACT) using selector-agnostic resolution and postcondition checks.',
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
        const elements = await browserService.getActionableElements(optionalString(objectInput(input), 'tabId'));
        return { summary: `Found ${elements.length} actionable elements`, data: { elements } };
      },
    },
    {
      name: 'browser.capture_snapshot',
      description: 'Capture a browser tab snapshot.',
      inputSchema: { type: 'object', properties: { tabId: { type: 'string' } } },
      async execute(input) {
        requireBrowserCreated();
        const snapshot = await browserService.captureTabSnapshot(optionalString(objectInput(input), 'tabId'));
        return { summary: `Captured snapshot ${snapshot.id}`, data: { snapshot } };
      },
    },
  ];
}
