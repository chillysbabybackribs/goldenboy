"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const BrowserPageAnalysis_1 = require("./BrowserPageAnalysis");
(0, vitest_1.describe)('BrowserPageAnalysis.extractSearchResults', () => {
    (0, vitest_1.it)('filters Google utility links before returning search candidates', async () => {
        const executeInPage = vitest_1.vi.fn().mockResolvedValue({
            error: null,
            result: [
                {
                    index: 0,
                    title: 'Google Search Help',
                    url: 'https://support.google.com/websearch/?hl=en',
                    snippet: 'Find help for Google Search.',
                    selector: 'footer > a',
                    source: 'generic',
                },
                {
                    index: 1,
                    title: 'Policies',
                    url: 'https://policies.google.com/privacy',
                    snippet: 'Privacy and terms.',
                    selector: 'footer > a',
                    source: 'generic',
                },
                {
                    index: 2,
                    title: 'Acme pricing',
                    url: 'https://example.com/pricing',
                    snippet: 'Compare plans and pricing for Acme.',
                    selector: 'main > div.g > a',
                    source: 'search',
                },
                {
                    index: 3,
                    title: 'Acme documentation',
                    url: 'https://docs.example.com/getting-started',
                    snippet: 'Getting started guide and setup instructions.',
                    selector: 'main > div.g > a',
                    source: 'search',
                },
            ],
        });
        const analysis = new BrowserPageAnalysis_1.BrowserPageAnalysis({
            resolveEntry: () => ({
                id: 'tab_1',
                view: {},
                info: {
                    id: 'tab_1',
                    url: 'https://www.google.com/search?q=acme',
                    title: 'acme - Google Search',
                },
            }),
            getTabs: () => [],
            createTab: vitest_1.vi.fn(),
            activateTab: vitest_1.vi.fn(),
            executeInPage,
            captureTabSnapshot: vitest_1.vi.fn(),
            activeTabId: () => 'tab_1',
        });
        const results = await analysis.extractSearchResults('tab_1', 4);
        (0, vitest_1.expect)(executeInPage).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(results).toEqual([
            vitest_1.expect.objectContaining({
                index: 0,
                title: 'Acme pricing',
                url: 'https://example.com/pricing',
            }),
            vitest_1.expect.objectContaining({
                index: 1,
                title: 'Acme documentation',
                url: 'https://docs.example.com/getting-started',
            }),
        ]);
    });
    (0, vitest_1.it)('unwraps Google redirect URLs to the destination page', async () => {
        const executeInPage = vitest_1.vi.fn().mockResolvedValue({
            error: null,
            result: [
                {
                    index: 0,
                    title: 'Acme pricing',
                    url: 'https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fpricing&sa=U&ved=123',
                    snippet: 'Compare plans and pricing for Acme.',
                    selector: 'main > div.g > a',
                    source: 'search',
                },
            ],
        });
        const analysis = new BrowserPageAnalysis_1.BrowserPageAnalysis({
            resolveEntry: () => ({
                id: 'tab_1',
                view: {},
                info: {
                    id: 'tab_1',
                    url: 'https://www.google.com/search?q=acme',
                    title: 'acme - Google Search',
                },
            }),
            getTabs: () => [],
            createTab: vitest_1.vi.fn(),
            activateTab: vitest_1.vi.fn(),
            executeInPage,
            captureTabSnapshot: vitest_1.vi.fn(),
            activeTabId: () => 'tab_1',
        });
        const results = await analysis.extractSearchResults('tab_1', 4);
        (0, vitest_1.expect)(results).toEqual([
            vitest_1.expect.objectContaining({
                index: 0,
                url: 'https://example.com/pricing',
            }),
        ]);
    });
    (0, vitest_1.it)('unwraps DuckDuckGo redirect URLs to the destination page', async () => {
        const executeInPage = vitest_1.vi.fn().mockResolvedValue({
            error: null,
            result: [
                {
                    index: 0,
                    title: 'Acme pricing',
                    url: 'https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpricing',
                    snippet: 'Compare plans and pricing for Acme.',
                    selector: 'main > div.result > a',
                    source: 'search',
                },
            ],
        });
        const analysis = new BrowserPageAnalysis_1.BrowserPageAnalysis({
            resolveEntry: () => ({
                id: 'tab_1',
                view: {},
                info: {
                    id: 'tab_1',
                    navigation: {
                        url: 'https://duckduckgo.com/?q=acme',
                        title: 'acme at DuckDuckGo',
                    },
                },
            }),
            getTabs: () => [],
            createTab: vitest_1.vi.fn(),
            activateTab: vitest_1.vi.fn(),
            executeInPage,
            captureTabSnapshot: vitest_1.vi.fn(),
            activeTabId: () => 'tab_1',
        });
        const results = await analysis.extractSearchResults('tab_1', 4);
        (0, vitest_1.expect)(results).toEqual([
            vitest_1.expect.objectContaining({
                index: 0,
                url: 'https://example.com/pricing',
            }),
        ]);
    });
});
//# sourceMappingURL=BrowserPageAnalysis.test.js.map