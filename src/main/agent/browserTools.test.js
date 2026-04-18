"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const { answerFromCache, cachePage, executeBrowserOperation, extractPageEvidence, extractSearchResults, getState, judgeEvidence, rankSearchResults, extractContent, } = vitest_1.vi.hoisted(() => ({
    answerFromCache: vitest_1.vi.fn(),
    cachePage: vitest_1.vi.fn(),
    executeBrowserOperation: vitest_1.vi.fn(),
    extractContent: vitest_1.vi.fn(),
    extractPageEvidence: vitest_1.vi.fn(),
    extractSearchResults: vitest_1.vi.fn(),
    getState: vitest_1.vi.fn(),
    judgeEvidence: vitest_1.vi.fn(),
    rankSearchResults: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../browser/BrowserService', () => ({
    browserService: {
        executeInPage: vitest_1.vi.fn(),
        extractPageEvidence,
        extractSearchResults,
        getState,
        isCreated: vitest_1.vi.fn(() => true),
    },
}));
vitest_1.vi.mock('../browser/browserOperations', () => ({ executeBrowserOperation }));
vitest_1.vi.mock('../context/pageExtractor', () => ({
    PageExtractor: class MockPageExtractor {
        extractContent = extractContent;
    },
}));
vitest_1.vi.mock('../browserKnowledge/PageKnowledgeStore', () => ({
    pageKnowledgeStore: {
        answerFromCache,
        cachePage,
    },
}));
vitest_1.vi.mock('./GeminiSidecar', () => ({
    geminiSidecar: {
        isConfigured: vitest_1.vi.fn(() => true),
        judgeEvidence,
        rankSearchResults,
    },
}));
vitest_1.vi.mock('../state/appStateStore', () => ({
    appStateStore: {
        dispatch: vitest_1.vi.fn(),
    },
}));
vitest_1.vi.mock('../state/actions', () => ({
    ActionType: {
        ADD_LOG: 'ADD_LOG',
    },
}));
const browserTools_1 = require("./tools/browserTools");
(0, vitest_1.describe)('buildWaitForTextExpression', () => {
    (0, vitest_1.it)('includes form control values in the page text probe', () => {
        const expression = (0, browserTools_1.buildWaitForTextExpression)();
        (0, vitest_1.expect)(expression).toContain("document.querySelectorAll('input, textarea, select')");
        (0, vitest_1.expect)(expression).toContain("'value' in element");
        (0, vitest_1.expect)(expression).toContain('element.selectedOptions');
        (0, vitest_1.expect)(expression).toContain('document.body?.innerText');
    });
});
(0, vitest_1.describe)('createBrowserToolDefinitions', () => {
    (0, vitest_1.beforeEach)(() => {
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
    (0, vitest_1.it)('routes browser.navigate through the browser operation layer', async () => {
        executeBrowserOperation.mockResolvedValue({
            summary: 'Navigated to https://example.com',
            data: { url: 'https://example.com' },
        });
        const tool = (0, browserTools_1.createBrowserToolDefinitions)().find(item => item.name === 'browser.navigate');
        (0, vitest_1.expect)(tool).toBeTruthy();
        const result = await tool.execute({ url: 'https://example.com' }, { runId: 'run_1', agentId: 'agent_1', mode: 'unrestricted-dev' });
        (0, vitest_1.expect)(executeBrowserOperation).toHaveBeenCalledWith({
            kind: 'browser.navigate',
            payload: { url: 'https://example.com' },
        });
        (0, vitest_1.expect)(result).toEqual({
            summary: 'Navigated to https://example.com',
            data: { url: 'https://example.com' },
        });
    });
    (0, vitest_1.it)('routes browser.click through the browser operation layer', async () => {
        executeBrowserOperation.mockResolvedValue({
            summary: 'Clicked: button.submit',
            data: { selector: 'button.submit', result: { clicked: true } },
        });
        const tool = (0, browserTools_1.createBrowserToolDefinitions)().find(item => item.name === 'browser.click');
        (0, vitest_1.expect)(tool).toBeTruthy();
        const result = await tool.execute({ selector: 'button.submit', tabId: 'tab_1' }, { runId: 'run_2', agentId: 'agent_2', mode: 'unrestricted-dev' });
        (0, vitest_1.expect)(executeBrowserOperation).toHaveBeenCalledWith({
            kind: 'browser.click',
            payload: { selector: 'button.submit', tabId: 'tab_1' },
        });
        (0, vitest_1.expect)(result).toEqual({
            summary: 'Clicked: button.submit',
            data: { selector: 'button.submit', result: { clicked: true } },
        });
    });
    (0, vitest_1.it)('fails clearly when browser.research_search receives a non-object input', async () => {
        const tool = (0, browserTools_1.createBrowserToolDefinitions)().find(item => item.name === 'browser.research_search');
        (0, vitest_1.expect)(tool).toBeTruthy();
        await (0, vitest_1.expect)(tool.execute('{"query":"pricing"}', { runId: 'run_3', agentId: 'agent_3', mode: 'unrestricted-dev' })).rejects.toThrow('Invalid input for browser.research_search: input must be an object; got string.');
        (0, vitest_1.expect)(executeBrowserOperation).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('keeps research search focused on extracted results instead of cached search-page chunks', async () => {
        executeBrowserOperation.mockImplementation(async (input) => {
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
        });
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
        const tool = (0, browserTools_1.createBrowserToolDefinitions)().find(item => item.name === 'browser.research_search');
        (0, vitest_1.expect)(tool).toBeTruthy();
        const result = await tool.execute({ query: 'acme pricing' }, { runId: 'run_4', agentId: 'agent_4', mode: 'unrestricted-dev' });
        (0, vitest_1.expect)(executeBrowserOperation).toHaveBeenCalledWith({
            kind: 'browser.search-web',
            payload: { query: 'acme pricing' },
        });
        (0, vitest_1.expect)(result.data).toEqual(vitest_1.expect.objectContaining({
            searchSurface: {
                tabId: 'tab_search',
                title: 'acme pricing at DuckDuckGo',
                url: 'https://duckduckgo.com/?q=acme%20pricing',
            },
            nextStep: 'Answer only from openedPages evidence or open another result if more evidence is needed.',
        }));
        (0, vitest_1.expect)(result.data).not.toHaveProperty('searchPage');
        (0, vitest_1.expect)(result.data).not.toHaveProperty('searchPageSuggestedChunkIds');
    });
    (0, vitest_1.it)('does not treat stale dated evidence as sufficient for freshness-sensitive queries', async () => {
        executeBrowserOperation.mockImplementation(async (input) => {
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
        });
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
        const tool = (0, browserTools_1.createBrowserToolDefinitions)().find(item => item.name === 'browser.research_search');
        (0, vitest_1.expect)(tool).toBeTruthy();
        const result = await tool.execute({ query: 'latest electron release notes', maxPages: 1 }, { runId: 'run_5', agentId: 'agent_5', mode: 'unrestricted-dev' });
        (0, vitest_1.expect)(result.data.stoppedEarly).toBe(false);
        (0, vitest_1.expect)(result.data.openedPages[0]).toEqual(vitest_1.expect.objectContaining({
            answerLikely: false,
            deterministicEvidenceScore: vitest_1.expect.any(Number),
        }));
        (0, vitest_1.expect)(result.data.openedPages[0].scoreReasons.join(' ')).toContain('stale evidence');
    });
});
//# sourceMappingURL=browserTools.test.js.map