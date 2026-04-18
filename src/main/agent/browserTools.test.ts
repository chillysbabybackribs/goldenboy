import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  answerFromCache,
  cachePage,
  executeBrowserOperation,
  extractPageEvidence,
  extractSearchResults,
  getState,
  judgeEvidence,
  rankSearchResults,
  extractContent,
} = vi.hoisted(() => ({
  answerFromCache: vi.fn(),
  cachePage: vi.fn(),
  executeBrowserOperation: vi.fn(),
  extractContent: vi.fn(),
  extractPageEvidence: vi.fn(),
  extractSearchResults: vi.fn(),
  getState: vi.fn(),
  judgeEvidence: vi.fn(),
  rankSearchResults: vi.fn(),
}));

vi.mock('../browser/BrowserService', () => ({
  browserService: {
    executeInPage: vi.fn(),
    extractPageEvidence,
    extractSearchResults,
    getState,
    isCreated: vi.fn(() => true),
  },
}));

vi.mock('../browser/browserOperations', () => ({ executeBrowserOperation }));
vi.mock('../context/pageExtractor', () => ({
  PageExtractor: class MockPageExtractor {
    extractContent = extractContent;
  },
}));
vi.mock('../browserKnowledge/PageKnowledgeStore', () => ({
  pageKnowledgeStore: {
    answerFromCache,
    cachePage,
  },
}));
vi.mock('./GeminiSidecar', () => ({
  geminiSidecar: {
    isConfigured: vi.fn(() => true),
    judgeEvidence,
    rankSearchResults,
  },
}));
vi.mock('../state/appStateStore', () => ({
  appStateStore: {
    dispatch: vi.fn(),
  },
}));
vi.mock('../state/actions', () => ({
  ActionType: {
    ADD_LOG: 'ADD_LOG',
  },
}));

import { buildWaitForTextExpression, createBrowserToolDefinitions } from './tools/browserTools';

describe('buildWaitForTextExpression', () => {
  it('includes form control values in the page text probe', () => {
    const expression = buildWaitForTextExpression();

    expect(expression).toContain("document.querySelectorAll('input, textarea, select')");
    expect(expression).toContain("'value' in element");
    expect(expression).toContain('element.selectedOptions');
    expect(expression).toContain('document.body?.innerText');
  });
});

describe('createBrowserToolDefinitions', () => {
  beforeEach(() => {
    answerFromCache.mockReset();
    cachePage.mockReset();
    executeBrowserOperation.mockReset();
    extractContent.mockReset();
    extractPageEvidence.mockReset();
    extractSearchResults.mockReset();
    getState.mockReset();
    judgeEvidence.mockReset();
    rankSearchResults.mockReset();
    getState.mockReturnValue({
      activeTabId: 'tab_search',
      navigation: {
        isLoading: false,
        title: 'Search',
        url: 'https://duckduckgo.com/?q=test',
      },
    });
  });

  it('routes browser.navigate through the browser operation layer', async () => {
    executeBrowserOperation.mockResolvedValue({
      summary: 'Navigated to https://example.com',
      data: { url: 'https://example.com' },
    });

    const tool = createBrowserToolDefinitions().find(item => item.name === 'browser.navigate');
    expect(tool).toBeTruthy();

    const result = await tool!.execute(
      { url: 'https://example.com' },
      { runId: 'run_1', agentId: 'agent_1', mode: 'unrestricted-dev' },
    );

    expect(executeBrowserOperation).toHaveBeenCalledWith({
      kind: 'browser.navigate',
      payload: { url: 'https://example.com' },
    });
    expect(result).toEqual({
      summary: 'Navigated to https://example.com',
      data: { url: 'https://example.com' },
    });
  });

  it('routes browser.click through the browser operation layer', async () => {
    executeBrowserOperation.mockResolvedValue({
      summary: 'Clicked: button.submit',
      data: { selector: 'button.submit', result: { clicked: true } },
    });

    const tool = createBrowserToolDefinitions().find(item => item.name === 'browser.click');
    expect(tool).toBeTruthy();

    const result = await tool!.execute(
      { selector: 'button.submit', tabId: 'tab_1' },
      { runId: 'run_2', agentId: 'agent_2', mode: 'unrestricted-dev' },
    );

    expect(executeBrowserOperation).toHaveBeenCalledWith({
      kind: 'browser.click',
      payload: { selector: 'button.submit', tabId: 'tab_1' },
    });
    expect(result).toEqual({
      summary: 'Clicked: button.submit',
      data: { selector: 'button.submit', result: { clicked: true } },
    });
  });

  it('fails clearly when browser.research_search receives a non-object input', async () => {
    const tool = createBrowserToolDefinitions().find(item => item.name === 'browser.research_search');
    expect(tool).toBeTruthy();

    await expect(tool!.execute(
      '{"query":"pricing"}',
      { runId: 'run_3', agentId: 'agent_3', mode: 'unrestricted-dev' },
    )).rejects.toThrow(
      'Invalid input for browser.research_search: input must be an object; got string.',
    );
    expect(executeBrowserOperation).not.toHaveBeenCalled();
  });

  it('keeps research search focused on extracted results instead of cached search-page chunks', async () => {
    executeBrowserOperation.mockImplementation(async (input: { kind: string }) => {
      if (input.kind === 'browser.search-web') {
        return { summary: 'Opened search', data: {} };
      }
      if (input.kind === 'browser.create-tab') {
        return { summary: 'Opened result', data: { tabId: 'tab_result' } };
      }
      if (input.kind === 'browser.activate-tab') {
        return { summary: 'Activated search tab', data: { tabId: 'tab_search' } };
      }
      throw new Error(`Unexpected browser operation: ${input.kind}`);
    });
    getState.mockReturnValue({
      activeTabId: 'tab_search',
      navigation: {
        isLoading: false,
        title: 'acme pricing at DuckDuckGo',
        url: 'https://duckduckgo.com/?q=acme%20pricing',
      },
    });
    extractSearchResults.mockResolvedValue([
      {
        index: 0,
        title: 'Acme pricing',
        url: 'https://example.com/pricing',
        snippet: 'Compare plans and pricing for Acme.',
        selector: 'main > div.result > a',
        source: 'search',
      },
    ]);
    extractContent.mockResolvedValue({
      url: 'https://example.com/pricing',
      title: 'Acme pricing',
      content: 'Pricing details',
      tier: 'semantic',
    });
    cachePage.mockReturnValue({
      id: 'page_1',
      tabId: 'tab_result',
      url: 'https://example.com/pricing',
      title: 'Acme pricing',
      chunkIds: ['chunk_1'],
    });
    extractPageEvidence.mockResolvedValue({
      tabId: 'tab_result',
      url: 'https://example.com/pricing',
      title: 'Acme pricing',
      mainHeading: 'Acme pricing',
      summary: 'Pricing details',
      keyFacts: ['Pro plan is $20'],
      quotes: [],
      dates: [],
      sourceLinks: ['https://example.com/pricing'],
      activeSurfaceType: 'document',
      activeSurfaceLabel: 'document',
    } as any);
    answerFromCache.mockReturnValue({ matches: [], suggestedChunkIds: [] });
    rankSearchResults.mockResolvedValue({
      results: [{
        index: 0,
        title: 'Acme pricing',
        url: 'https://example.com/pricing',
        snippet: 'Compare plans and pricing for Acme.',
      }],
      modelId: 'gemini-2.5-flash',
      reason: 'pricing page is the direct match',
    });
    judgeEvidence.mockResolvedValue({
      score: 10,
      sufficient: true,
      reasons: ['direct pricing evidence'],
      compactEvidence: ['Pro plan is $20'],
      modelId: 'gemini-2.5-flash',
    });

    const tool = createBrowserToolDefinitions().find(item => item.name === 'browser.research_search');
    expect(tool).toBeTruthy();

    const result = await tool!.execute(
      { query: 'acme pricing' },
      { runId: 'run_4', agentId: 'agent_4', mode: 'unrestricted-dev' },
    );

    expect(executeBrowserOperation).toHaveBeenCalledWith({
      kind: 'browser.search-web',
      payload: { query: 'acme pricing' },
    });
    expect(result.data).toEqual(expect.objectContaining({
      searchSurface: {
        tabId: 'tab_search',
        title: 'acme pricing at DuckDuckGo',
        url: 'https://duckduckgo.com/?q=acme%20pricing',
      },
      nextStep: 'Answer only from openedPages evidence or open another result if more evidence is needed.',
    }));
    expect(result.data).not.toHaveProperty('searchPage');
    expect(result.data).not.toHaveProperty('searchPageSuggestedChunkIds');
  });

  it('does not treat stale dated evidence as sufficient for freshness-sensitive queries', async () => {
    executeBrowserOperation.mockImplementation(async (input: { kind: string }) => {
      if (input.kind === 'browser.search-web') {
        return { summary: 'Opened search', data: {} };
      }
      if (input.kind === 'browser.create-tab') {
        return { summary: 'Opened result', data: { tabId: 'tab_result' } };
      }
      if (input.kind === 'browser.activate-tab') {
        return { summary: 'Activated search tab', data: { tabId: 'tab_search' } };
      }
      throw new Error(`Unexpected browser operation: ${input.kind}`);
    });
    getState.mockReturnValue({
      activeTabId: 'tab_search',
      navigation: {
        isLoading: false,
        title: 'latest electron release notes at DuckDuckGo',
        url: 'https://duckduckgo.com/?q=latest%20electron%20release%20notes',
      },
    });
    extractSearchResults.mockResolvedValue([
      {
        index: 0,
        title: 'Electron release notes',
        url: 'https://example.com/releases',
        snippet: 'Release notes and updates.',
        selector: 'main > div.result > a',
        source: 'search',
      },
    ]);
    extractContent.mockResolvedValue({
      url: 'https://example.com/releases',
      title: 'Electron release notes',
      content: 'Release notes from 2024',
      tier: 'semantic',
    });
    cachePage.mockReturnValue({
      id: 'page_1',
      tabId: 'tab_result',
      url: 'https://example.com/releases',
      title: 'Electron release notes',
      chunkIds: ['chunk_1'],
    });
    extractPageEvidence.mockResolvedValue({
      tabId: 'tab_result',
      url: 'https://example.com/releases',
      title: 'Electron release notes',
      mainHeading: 'Electron release notes',
      summary: 'Release notes from 2024.',
      keyFacts: ['Electron 31 released in 2024'],
      quotes: [],
      dates: ['2024-05-01'],
      sourceLinks: ['https://example.com/releases'],
      activeSurfaceType: 'document',
      activeSurfaceLabel: 'document',
    } as any);
    answerFromCache.mockReturnValue({ matches: [], suggestedChunkIds: [] });
    rankSearchResults.mockResolvedValue({
      results: [{
        index: 0,
        title: 'Electron release notes',
        url: 'https://example.com/releases',
        snippet: 'Release notes and updates.',
      }],
      modelId: 'gemini-2.5-flash',
      reason: 'release notes page is relevant',
    });
    judgeEvidence.mockResolvedValue(null);

    const tool = createBrowserToolDefinitions().find(item => item.name === 'browser.research_search');
    expect(tool).toBeTruthy();

    const result = await tool!.execute(
      { query: 'latest electron release notes', maxPages: 1 },
      { runId: 'run_5', agentId: 'agent_5', mode: 'unrestricted-dev' },
    );

    expect(result.data.stoppedEarly).toBe(false);
    expect(result.data.openedPages[0]).toEqual(expect.objectContaining({
      answerLikely: false,
      deterministicEvidenceScore: expect.any(Number),
    }));
    expect(result.data.openedPages[0].scoreReasons.join(' ')).toContain('stale evidence');
  });
});
