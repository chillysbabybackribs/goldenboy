import { AgentToolDefinition } from '../AgentTypes';
import { browserService } from '../../browser/BrowserService';
import { PageExtractor } from '../../context/pageExtractor';
import { pageKnowledgeStore } from '../../browserKnowledge/PageKnowledgeStore';
import { WebIntentInstruction, WebIntentVM } from '../../browser/WebIntentVM';
import {
  includesText,
  invalidateBrowserCaches,
  logBrowserCache,
  requireBrowserCreated,
  runBrowserOperation,
  objectInput,
  optionalNumber,
  optionalString,
  optionalStringArray,
  waitForBrowserSettled,
  requireObjectInput,
  requireString,
  cachePageForTab,
  waitForCondition,
  buildWaitForTextExpression,
} from './browserTools.utils';
import { executeBrowserResearchSearch } from './browserTools.research';

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

        return executeBrowserResearchSearch({
          query,
          resultLimit,
          maxPages,
          stopWhenAnswerFound,
          minEvidenceScore,
          pageExtractor,
          context,
        });
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

export { buildWaitForTextExpression };
