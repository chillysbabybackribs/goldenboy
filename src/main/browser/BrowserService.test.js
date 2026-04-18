"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
vitest_1.vi.mock('electron', () => ({
    app: {
        getPath: () => '/tmp',
    },
}));
const BrowserService_1 = require("./BrowserService");
function makeTab(id, url) {
    return {
        id,
        view: {
            webContents: {
                isDestroyed: () => false,
                close: vitest_1.vi.fn(),
            },
        },
        info: {
            id,
            navigation: {
                url,
                title: url,
                canGoBack: false,
                canGoForward: false,
                isLoading: false,
                loadingProgress: null,
                favicon: '',
                lastNavigationAt: null,
            },
            status: 'idle',
            zoomLevel: 1,
            muted: false,
            isAudible: false,
            createdAt: Date.now(),
        },
    };
}
(0, vitest_1.describe)('BrowserService tab persistence scheduling', () => {
    (0, vitest_1.it)('schedules persistence when closing a tab', () => {
        const service = Object.create(BrowserService_1.BrowserService.prototype);
        service.tabs = new Map([
            ['tab-1', makeTab('tab-1', 'https://example.com')],
            ['tab-2', makeTab('tab-2', 'https://openai.com')],
        ]);
        service.activeTabId = 'tab-1';
        service.splitLeftTabId = null;
        service.splitRightTabId = null;
        service.settings = { homepage: 'https://duckduckgo.com' };
        service.scheduleHistoryPersist = vitest_1.vi.fn();
        service.syncState = vitest_1.vi.fn();
        service.applyTabLayout = vitest_1.vi.fn();
        service.destroyTabEntry = vitest_1.vi.fn();
        service.normalizeSplitState = vitest_1.vi.fn();
        service.activateTabInternal = vitest_1.vi.fn();
        service.closeTab('tab-1');
        (0, vitest_1.expect)(service.scheduleHistoryPersist).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(service.syncState).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('schedules persistence when activating a tab', () => {
        const service = Object.create(BrowserService_1.BrowserService.prototype);
        service.scheduleHistoryPersist = vitest_1.vi.fn();
        service.syncState = vitest_1.vi.fn();
        service.activateTabInternal = vitest_1.vi.fn();
        service.activateTab('tab-2');
        (0, vitest_1.expect)(service.activateTabInternal).toHaveBeenCalledWith('tab-2');
        (0, vitest_1.expect)(service.scheduleHistoryPersist).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(service.syncState).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('schedules persistence when clearing split view removes the right tab', () => {
        const service = Object.create(BrowserService_1.BrowserService.prototype);
        service.tabs = new Map([
            ['tab-1', makeTab('tab-1', 'https://example.com')],
            ['tab-2', makeTab('tab-2', 'https://openai.com')],
        ]);
        service.splitRightTabId = 'tab-2';
        service.scheduleHistoryPersist = vitest_1.vi.fn();
        service.syncState = vitest_1.vi.fn();
        service.applyTabLayout = vitest_1.vi.fn();
        service.destroyTabEntry = vitest_1.vi.fn();
        service.normalizeSplitState = vitest_1.vi.fn();
        service.clearSplitView();
        (0, vitest_1.expect)(service.scheduleHistoryPersist).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(service.syncState).toHaveBeenCalledTimes(1);
    });
});
//# sourceMappingURL=BrowserService.test.js.map