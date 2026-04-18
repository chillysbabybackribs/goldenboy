"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const { browserService } = vitest_1.vi.hoisted(() => ({
    browserService: {
        beginOperationNetworkScope: vitest_1.vi.fn(),
        completeOperationNetworkScope: vitest_1.vi.fn(),
        captureTabSnapshot: vitest_1.vi.fn(),
        getFormModel: vitest_1.vi.fn(),
        isCreated: vitest_1.vi.fn(() => true),
        navigate: vitest_1.vi.fn(),
        getState: vitest_1.vi.fn(),
        getPageMetadata: vitest_1.vi.fn(),
        getPageText: vitest_1.vi.fn(),
        createTab: vitest_1.vi.fn(),
        getTabs: vitest_1.vi.fn(),
        clickElement: vitest_1.vi.fn(),
        splitTab: vitest_1.vi.fn(),
    },
}));
vitest_1.vi.mock('./BrowserService', () => ({ browserService }));
const browserOperations_1 = require("./browserOperations");
const browserContextManager_1 = require("./browserContextManager");
const browserOperationLedger_1 = require("./browserOperationLedger");
const browserOperationReplayStore_1 = require("./browserOperationReplayStore");
(0, vitest_1.describe)('executeBrowserOperation', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        (0, browserOperationLedger_1.clearBrowserOperationLedger)();
        (0, browserOperationReplayStore_1.clearBrowserOperationReplayStore)();
        browserContextManager_1.browserContextManager.resetForTests(browserService);
        browserService.isCreated.mockReturnValue(true);
        browserService.completeOperationNetworkScope.mockReturnValue(null);
        browserService.captureTabSnapshot.mockResolvedValue({
            id: 'snap_1',
            tabId: 'tab_1',
            capturedAt: Date.now(),
            url: 'https://example.com',
            title: 'Example',
            mainHeading: 'Example',
            visibleTextExcerpt: 'Example page',
            forms: [],
            viewport: { url: 'https://example.com' },
            actionableElements: [{
                    id: 'act_1',
                    ref: { tabId: 'tab_1', frameId: null, selector: '#buy-now' },
                    role: 'button',
                    tagName: 'button',
                    text: 'Buy now',
                    ariaLabel: '',
                    href: null,
                    boundingBox: { x: 10, y: 20, width: 50, height: 20 },
                    actionability: ['clickable'],
                    visible: true,
                    enabled: true,
                    confidence: 0.9,
                }],
        });
        browserService.getFormModel.mockResolvedValue([]);
        browserService.getState.mockReturnValue({
            activeTabId: 'tab_1',
            splitLeftTabId: null,
            splitRightTabId: null,
            navigation: {
                url: 'https://example.com',
                title: 'Example',
                canGoBack: false,
                canGoForward: false,
                isLoading: false,
            },
            tabs: [{ id: 'tab_1' }],
        });
    });
    (0, vitest_1.it)('navigates through the shared browser operation executor', async () => {
        browserService.getState.mockReturnValue({
            activeTabId: 'tab_1',
            splitLeftTabId: null,
            splitRightTabId: null,
            navigation: {
                url: 'https://example.com',
                title: 'Example',
                isLoading: false,
            },
            tabs: [{ id: 'tab_1' }],
        });
        browserService.getPageMetadata.mockResolvedValue({ lang: 'en' });
        browserService.getPageText.mockResolvedValue('Example page');
        const result = await (0, browserOperations_1.executeBrowserOperation)({
            kind: 'browser.navigate',
            payload: { url: 'https://example.com' },
            context: {
                taskId: 'task_1',
                source: 'agent',
                agentId: 'agent_1',
                runId: 'run_1',
            },
        });
        (0, vitest_1.expect)(browserService.navigate).toHaveBeenCalledWith('https://example.com');
        (0, vitest_1.expect)(browserService.beginOperationNetworkScope).toHaveBeenCalledWith({
            operationId: vitest_1.expect.any(String),
            contextId: 'default',
            kind: 'browser.navigate',
            tabId: 'tab_1',
        });
        (0, vitest_1.expect)(result).toEqual({
            summary: 'Navigated to https://example.com',
            data: {
                url: 'https://example.com',
                title: 'Example',
                isLoading: false,
                tabCount: 1,
                pagePreview: 'Example page',
                metadata: { lang: 'en' },
            },
        });
        (0, vitest_1.expect)((0, browserOperationLedger_1.getRecentBrowserOperationLedgerEntries)(1)).toEqual([
            vitest_1.expect.objectContaining({
                kind: 'browser.navigate',
                contextId: 'default',
                status: 'completed',
                resultSummary: 'Navigated to https://example.com',
                errorSummary: null,
                durationMs: vitest_1.expect.any(Number),
                context: vitest_1.expect.objectContaining({
                    taskId: 'task_1',
                    tabId: 'tab_1',
                    source: 'agent',
                    agentId: 'agent_1',
                    runId: 'run_1',
                    activeTabId: 'tab_1',
                    activeUrl: 'https://example.com',
                }),
                inputSummary: vitest_1.expect.objectContaining({
                    fields: vitest_1.expect.objectContaining({
                        url: 'https://example.com',
                    }),
                }),
                network: null,
                replayOfOperationId: null,
                decision: vitest_1.expect.objectContaining({
                    selectedMode: 'deterministic_execute',
                    confidence: 'high',
                }),
                decisionResult: vitest_1.expect.objectContaining({
                    selectedMode: 'deterministic_execute',
                    finalStatus: 'completed',
                }),
                targetDescriptor: vitest_1.expect.objectContaining({
                    kind: 'navigation',
                    evidence: vitest_1.expect.objectContaining({
                        expectedUrl: 'https://example.com',
                    }),
                }),
                validation: vitest_1.expect.objectContaining({
                    status: 'matched',
                    phase: 'postflight',
                }),
            }),
        ]);
    });
    (0, vitest_1.it)('creates tabs through the shared browser operation executor', async () => {
        browserService.createTab.mockReturnValue({ id: 'tab_2' });
        browserService.getTabs.mockReturnValue([{ id: 'tab_1' }, { id: 'tab_2' }]);
        const result = await (0, browserOperations_1.executeBrowserOperation)({
            kind: 'browser.create-tab',
            payload: { url: 'https://open.example' },
        });
        (0, vitest_1.expect)(browserService.createTab).toHaveBeenCalledWith('https://open.example', undefined);
        (0, vitest_1.expect)(result).toEqual({
            summary: 'Opened tab: https://open.example',
            data: {
                tabId: 'tab_2',
                url: 'https://open.example',
                totalTabs: 2,
            },
        });
    });
    (0, vitest_1.it)('routes browser.search-web queries through DuckDuckGo search URLs', async () => {
        const currentYear = new Date().getFullYear();
        browserService.getState.mockReturnValue({
            activeTabId: 'tab_1',
            splitLeftTabId: null,
            splitRightTabId: null,
            navigation: {
                url: `https://duckduckgo.com/?q=acme%20pricing%20${currentYear}`,
                title: `acme pricing ${currentYear} at DuckDuckGo`,
                isLoading: false,
            },
            tabs: [{ id: 'tab_1' }],
        });
        browserService.getPageMetadata.mockResolvedValue({ lang: 'en' });
        browserService.getPageText.mockResolvedValue('DuckDuckGo results');
        const result = await (0, browserOperations_1.executeBrowserOperation)({
            kind: 'browser.search-web',
            payload: { query: 'acme pricing' },
        });
        (0, vitest_1.expect)(browserService.navigate).toHaveBeenCalledWith(`https://duckduckgo.com/?q=acme%20pricing%20${currentYear}`);
        (0, vitest_1.expect)(result).toEqual({
            summary: `Navigated to https://duckduckgo.com/?q=acme%20pricing%20${currentYear}`,
            data: {
                url: `https://duckduckgo.com/?q=acme%20pricing%20${currentYear}`,
                title: `acme pricing ${currentYear} at DuckDuckGo`,
                isLoading: false,
                tabCount: 1,
                pagePreview: 'DuckDuckGo results',
                metadata: { lang: 'en' },
            },
        });
    });
    (0, vitest_1.it)('appends the current year for freshness-sensitive search queries', async () => {
        const currentYear = new Date().getFullYear();
        browserService.getState.mockReturnValue({
            activeTabId: 'tab_1',
            splitLeftTabId: null,
            splitRightTabId: null,
            navigation: {
                url: `https://duckduckgo.com/?q=latest%20electron%20release%20notes%20${currentYear}`,
                title: `latest electron release notes ${currentYear} at DuckDuckGo`,
                isLoading: false,
            },
            tabs: [{ id: 'tab_1' }],
        });
        browserService.getPageMetadata.mockResolvedValue({ lang: 'en' });
        browserService.getPageText.mockResolvedValue('DuckDuckGo results');
        const result = await (0, browserOperations_1.executeBrowserOperation)({
            kind: 'browser.search-web',
            payload: { query: 'latest electron release notes' },
        });
        (0, vitest_1.expect)(browserService.navigate).toHaveBeenCalledWith(`https://duckduckgo.com/?q=latest%20electron%20release%20notes%20${currentYear}`);
        (0, vitest_1.expect)(result.data.url).toBe(`https://duckduckgo.com/?q=latest%20electron%20release%20notes%20${currentYear}`);
    });
    (0, vitest_1.it)('preserves explicit years in freshness-sensitive search queries', async () => {
        browserService.getState.mockReturnValue({
            activeTabId: 'tab_1',
            splitLeftTabId: null,
            splitRightTabId: null,
            navigation: {
                url: 'https://duckduckgo.com/?q=latest%20electron%20release%20notes%202025',
                title: 'latest electron release notes 2025 at DuckDuckGo',
                isLoading: false,
            },
            tabs: [{ id: 'tab_1' }],
        });
        browserService.getPageMetadata.mockResolvedValue({ lang: 'en' });
        browserService.getPageText.mockResolvedValue('DuckDuckGo results');
        const result = await (0, browserOperations_1.executeBrowserOperation)({
            kind: 'browser.search-web',
            payload: { query: 'latest electron release notes 2025' },
        });
        (0, vitest_1.expect)(browserService.navigate).toHaveBeenCalledWith('https://duckduckgo.com/?q=latest%20electron%20release%20notes%202025');
        (0, vitest_1.expect)(result.data.url).toBe('https://duckduckgo.com/?q=latest%20electron%20release%20notes%202025');
    });
    (0, vitest_1.it)('fails click operations when the browser reports a click failure', async () => {
        browserService.clickElement.mockResolvedValue({ clicked: false, error: 'intercepted' });
        browserService.completeOperationNetworkScope.mockReturnValue({
            eventIds: ['net_1'],
            summary: {
                requestCount: 1,
                failedRequestCount: 1,
                urls: ['https://example.com/api'],
                statusCodes: [500],
            },
        });
        await (0, vitest_1.expect)((0, browserOperations_1.executeBrowserOperation)({
            kind: 'browser.click',
            payload: { selector: '#buy-now' },
        })).rejects.toThrow('intercepted');
        (0, vitest_1.expect)((0, browserOperationLedger_1.getRecentBrowserOperationLedgerEntries)(1)).toEqual([
            vitest_1.expect.objectContaining({
                kind: 'browser.click',
                status: 'failed',
                resultSummary: null,
                errorSummary: 'intercepted',
                inputSummary: vitest_1.expect.objectContaining({
                    fields: vitest_1.expect.objectContaining({
                        selector: '#buy-now',
                    }),
                }),
                related: vitest_1.expect.objectContaining({
                    networkEventIds: ['net_1'],
                }),
                network: {
                    requestCount: 1,
                    failedRequestCount: 1,
                    urls: ['https://example.com/api'],
                    statusCodes: [500],
                },
                decision: vitest_1.expect.objectContaining({
                    selectedMode: 'deterministic_execute',
                }),
                decisionResult: vitest_1.expect.objectContaining({
                    selectedMode: 'deterministic_execute',
                    finalStatus: 'failed',
                }),
                targetDescriptor: vitest_1.expect.objectContaining({
                    kind: 'actionable-element',
                    evidence: vitest_1.expect.objectContaining({
                        selector: '#buy-now',
                        text: 'Buy now',
                    }),
                }),
                validation: vitest_1.expect.objectContaining({
                    status: 'matched',
                    phase: 'preflight',
                }),
            }),
        ]);
    });
    (0, vitest_1.it)('falls back to heuristic execution when deterministic target evidence is weak', async () => {
        browserService.captureTabSnapshot.mockResolvedValue({
            id: 'snap_missing',
            tabId: 'tab_1',
            capturedAt: Date.now(),
            url: 'https://example.com',
            title: 'Example',
            mainHeading: 'Example',
            visibleTextExcerpt: 'Example page',
            forms: [],
            viewport: { url: 'https://example.com' },
            actionableElements: [],
        });
        browserService.clickElement.mockResolvedValue({ clicked: true, error: null, method: 'native-input' });
        const result = await (0, browserOperations_1.executeBrowserOperation)({
            kind: 'browser.click',
            payload: { selector: '#buy-now' },
        });
        (0, vitest_1.expect)(result.summary).toBe('Clicked: #buy-now');
        (0, vitest_1.expect)((0, browserOperationLedger_1.getRecentBrowserOperationLedgerEntries)(1)).toEqual([
            vitest_1.expect.objectContaining({
                kind: 'browser.click',
                status: 'completed',
                decision: vitest_1.expect.objectContaining({
                    selectedMode: 'heuristic_execute',
                    confidence: 'low',
                }),
                decisionResult: vitest_1.expect.objectContaining({
                    selectedMode: 'heuristic_execute',
                    attemptedModes: ['deterministic_execute', 'heuristic_execute'],
                    fallbackUsed: true,
                    finalStatus: 'completed',
                }),
                validation: vitest_1.expect.objectContaining({
                    status: 'missing',
                    phase: 'preflight',
                }),
            }),
        ]);
    });
    (0, vitest_1.it)('supports split-view operations through the shared executor', async () => {
        browserService.splitTab.mockReturnValue({ id: 'tab_split' });
        browserService.getState.mockReturnValue({
            activeTabId: 'tab_left',
            splitLeftTabId: 'tab_left',
            splitRightTabId: 'tab_split',
            navigation: {
                url: 'https://example.com',
                title: 'Example',
                canGoBack: false,
                canGoForward: false,
                isLoading: false,
            },
            tabs: [{ id: 'tab_left' }, { id: 'tab_split' }],
        });
        const result = await (0, browserOperations_1.executeBrowserOperation)({
            kind: 'browser.split-tab',
            payload: { tabId: 'tab_left' },
        });
        (0, vitest_1.expect)(browserService.splitTab).toHaveBeenCalledWith('tab_left');
        (0, vitest_1.expect)(result).toEqual({
            summary: 'Split browser tab into tab_split',
            data: {
                tabId: 'tab_split',
                splitLeftTabId: 'tab_left',
                splitRightTabId: 'tab_split',
            },
        });
    });
    (0, vitest_1.it)('routes operations through an explicitly resolved browser context', async () => {
        const secondaryContext = {
            beginOperationNetworkScope: vitest_1.vi.fn(),
            completeOperationNetworkScope: vitest_1.vi.fn(() => null),
            isCreated: vitest_1.vi.fn(() => true),
            getState: vitest_1.vi.fn(() => ({
                activeTabId: 'tab_secondary',
                splitLeftTabId: null,
                splitRightTabId: null,
                navigation: {
                    url: 'https://secondary.example',
                    title: 'Secondary',
                    canGoBack: false,
                    canGoForward: false,
                    isLoading: false,
                },
                tabs: [{ id: 'tab_secondary' }, { id: 'tab_secondary_2' }],
            })),
            createTab: vitest_1.vi.fn(() => ({ id: 'tab_secondary_2' })),
            getTabs: vitest_1.vi.fn(() => [{ id: 'tab_secondary' }, { id: 'tab_secondary_2' }]),
        };
        browserContextManager_1.browserContextManager.createContext({
            id: 'ctx_secondary',
            label: 'Secondary',
            service: secondaryContext,
        });
        const result = await (0, browserOperations_1.executeBrowserOperation)({
            kind: 'browser.create-tab',
            payload: { url: 'https://secondary.example/new' },
            context: { contextId: 'ctx_secondary' },
        });
        (0, vitest_1.expect)(secondaryContext.createTab).toHaveBeenCalledWith('https://secondary.example/new', undefined);
        (0, vitest_1.expect)(browserService.createTab).not.toHaveBeenCalled();
        (0, vitest_1.expect)(result).toEqual({
            summary: 'Opened tab: https://secondary.example/new',
            data: {
                tabId: 'tab_secondary_2',
                url: 'https://secondary.example/new',
                totalTabs: 2,
            },
        });
        (0, vitest_1.expect)((0, browserOperationLedger_1.getRecentBrowserOperationLedgerEntries)(1)).toEqual([
            vitest_1.expect.objectContaining({
                contextId: 'ctx_secondary',
                context: vitest_1.expect.objectContaining({
                    activeTabId: 'tab_secondary',
                    activeUrl: 'https://secondary.example',
                }),
            }),
        ]);
    });
});
//# sourceMappingURL=browserOperations.test.js.map