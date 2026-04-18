"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const { browserService } = vitest_1.vi.hoisted(() => ({
    browserService: {
        beginOperationNetworkScope: vitest_1.vi.fn(),
        captureTabSnapshot: vitest_1.vi.fn(),
        clickElement: vitest_1.vi.fn(),
        completeOperationNetworkScope: vitest_1.vi.fn(() => null),
        getFormModel: vitest_1.vi.fn(() => Promise.resolve([])),
        getPageMetadata: vitest_1.vi.fn(() => Promise.resolve({})),
        getPageText: vitest_1.vi.fn(() => Promise.resolve('')),
        getState: vitest_1.vi.fn(),
        getTabs: vitest_1.vi.fn(() => [{ id: 'tab_1' }]),
        isCreated: vitest_1.vi.fn(() => true),
    },
}));
vitest_1.vi.mock('./BrowserService', () => ({ browserService }));
const browserContextManager_1 = require("./browserContextManager");
const browserOperationLedger_1 = require("./browserOperationLedger");
const browserOperations_1 = require("./browserOperations");
const browserOperationReplay_1 = require("./browserOperationReplay");
const browserOperationReplayStore_1 = require("./browserOperationReplayStore");
function makeSnapshot(selector, text = 'Buy now') {
    return {
        id: `snap_${selector.replace(/[^a-z0-9]/gi, '')}`,
        tabId: 'tab_1',
        capturedAt: Date.now(),
        url: 'https://example.com/products',
        title: 'Products',
        mainHeading: 'Products',
        visibleTextExcerpt: 'Products',
        forms: [],
        viewport: { url: 'https://example.com/products' },
        actionableElements: [{
                id: 'act_1',
                ref: { tabId: 'tab_1', frameId: null, selector },
                role: 'button',
                tagName: 'button',
                text,
                ariaLabel: '',
                href: null,
                boundingBox: { x: 1, y: 2, width: 100, height: 30 },
                actionability: ['clickable'],
                visible: true,
                enabled: true,
                confidence: 0.95,
            }],
    };
}
(0, vitest_1.describe)('replayBrowserOperation', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        (0, browserOperationLedger_1.clearBrowserOperationLedger)();
        (0, browserOperationReplayStore_1.clearBrowserOperationReplayStore)();
        browserContextManager_1.browserContextManager.resetForTests(browserService);
        browserService.getState.mockReturnValue({
            activeTabId: 'tab_1',
            splitLeftTabId: null,
            splitRightTabId: null,
            navigation: {
                url: 'https://example.com/products',
                title: 'Products',
                canGoBack: false,
                canGoForward: false,
                isLoading: false,
            },
            tabs: [{ id: 'tab_1' }],
        });
    });
    (0, vitest_1.it)('replays a supported click through the shared executor using descriptor resolution', async () => {
        browserService.captureTabSnapshot
            .mockResolvedValueOnce(makeSnapshot('#buy-now-old'))
            .mockResolvedValueOnce(makeSnapshot('#buy-now-new'));
        browserService.clickElement.mockResolvedValue({ clicked: true, error: null, method: 'native-input' });
        await (0, browserOperations_1.executeBrowserOperation)({
            kind: 'browser.click',
            payload: { selector: '#buy-now-old' },
        });
        const sourceOperationId = (0, browserOperationLedger_1.getRecentBrowserOperationLedgerEntries)(1)[0]?.operationId;
        (0, vitest_1.expect)(sourceOperationId).toBeTruthy();
        const replayResult = await (0, browserOperationReplay_1.replayBrowserOperation)({
            sourceOperationId: sourceOperationId,
            strictness: 'strict',
        });
        (0, vitest_1.expect)(browserService.clickElement).toHaveBeenNthCalledWith(1, '#buy-now-old', undefined);
        (0, vitest_1.expect)(browserService.clickElement).toHaveBeenNthCalledWith(2, '#buy-now-new', undefined);
        (0, vitest_1.expect)(replayResult.replayedOperationId).toBeTruthy();
        const latest = (0, browserOperationLedger_1.getRecentBrowserOperationLedgerEntries)(1)[0];
        (0, vitest_1.expect)(latest).toEqual(vitest_1.expect.objectContaining({
            kind: 'browser.click',
            replayOfOperationId: sourceOperationId,
            decision: vitest_1.expect.objectContaining({
                selectedMode: 'deterministic_replay',
                confidence: 'high',
            }),
            decisionResult: vitest_1.expect.objectContaining({
                selectedMode: 'deterministic_replay',
                finalStatus: 'completed',
            }),
            targetDescriptor: vitest_1.expect.objectContaining({
                evidence: vitest_1.expect.objectContaining({
                    selector: '#buy-now-old',
                    text: 'Buy now',
                }),
            }),
            validation: vitest_1.expect.objectContaining({
                status: 'matched',
                phase: 'postflight',
            }),
        }));
    });
    (0, vitest_1.it)('records a failed replay when strict preflight validation cannot resolve the target', async () => {
        browserService.captureTabSnapshot
            .mockResolvedValueOnce(makeSnapshot('#buy-now-old'))
            .mockResolvedValueOnce({
            ...makeSnapshot('#other-button', 'Something else'),
            actionableElements: [],
        });
        browserService.clickElement.mockResolvedValue({ clicked: true, error: null, method: 'native-input' });
        await (0, browserOperations_1.executeBrowserOperation)({
            kind: 'browser.click',
            payload: { selector: '#buy-now-old' },
        });
        const sourceOperationId = (0, browserOperationLedger_1.getRecentBrowserOperationLedgerEntries)(1)[0]?.operationId;
        await (0, vitest_1.expect)((0, browserOperationReplay_1.replayBrowserOperation)({
            sourceOperationId: sourceOperationId,
            strictness: 'strict',
        })).rejects.toThrow('no longer resolves');
        const latest = (0, browserOperationLedger_1.getRecentBrowserOperationLedgerEntries)(1)[0];
        (0, vitest_1.expect)(latest).toEqual(vitest_1.expect.objectContaining({
            kind: 'browser.click',
            status: 'failed',
            replayOfOperationId: sourceOperationId,
            decision: vitest_1.expect.objectContaining({
                selectedMode: 'abort',
            }),
            decisionResult: vitest_1.expect.objectContaining({
                selectedMode: 'abort',
                finalStatus: 'aborted',
            }),
            validation: vitest_1.expect.objectContaining({
                status: 'missing',
                phase: 'preflight',
            }),
        }));
    });
    (0, vitest_1.it)('falls back from replay to heuristic execution in best-effort mode when replay preflight is weak', async () => {
        browserService.captureTabSnapshot
            .mockResolvedValueOnce(makeSnapshot('#buy-now-old'))
            .mockResolvedValueOnce({
            ...makeSnapshot('#other-button', 'Something else'),
            actionableElements: [],
        });
        browserService.clickElement.mockResolvedValue({ clicked: true, error: null, method: 'native-input' });
        await (0, browserOperations_1.executeBrowserOperation)({
            kind: 'browser.click',
            payload: { selector: '#buy-now-old' },
        });
        const sourceOperationId = (0, browserOperationLedger_1.getRecentBrowserOperationLedgerEntries)(1)[0]?.operationId;
        const replayResult = await (0, browserOperationReplay_1.replayBrowserOperation)({
            sourceOperationId: sourceOperationId,
            strictness: 'best-effort',
        });
        (0, vitest_1.expect)(replayResult.replayedOperationId).toBeTruthy();
        (0, vitest_1.expect)(browserService.clickElement).toHaveBeenNthCalledWith(2, '#buy-now-old', undefined);
        const latest = (0, browserOperationLedger_1.getRecentBrowserOperationLedgerEntries)(1)[0];
        (0, vitest_1.expect)(latest).toEqual(vitest_1.expect.objectContaining({
            kind: 'browser.click',
            status: 'completed',
            replayOfOperationId: sourceOperationId,
            decision: vitest_1.expect.objectContaining({
                selectedMode: 'heuristic_execute',
            }),
            decisionResult: vitest_1.expect.objectContaining({
                selectedMode: 'heuristic_execute',
                attemptedModes: ['deterministic_replay', 'heuristic_execute'],
                fallbackUsed: true,
                finalStatus: 'completed',
            }),
            validation: vitest_1.expect.objectContaining({
                status: 'missing',
                phase: 'preflight',
            }),
        }));
    });
});
//# sourceMappingURL=browserOperationReplay.test.js.map