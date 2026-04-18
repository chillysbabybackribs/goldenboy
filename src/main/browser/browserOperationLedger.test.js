"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const browserOperationLedger_1 = require("./browserOperationLedger");
(0, vitest_1.describe)('BrowserOperationLedger', () => {
    (0, vitest_1.it)('keeps only the most recent bounded entries', () => {
        const ledger = new browserOperationLedger_1.BrowserOperationLedger(3);
        const baseState = {
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
        };
        for (let index = 0; index < 4; index += 1) {
            const entry = ledger.start({
                kind: 'browser.get-state',
                payload: { ordinal: index },
                contextId: 'default',
                state: baseState,
            });
            ledger.complete(entry.operationId, {
                summary: `Completed ${index}`,
                data: {},
            });
        }
        const entries = ledger.listRecent(10);
        (0, vitest_1.expect)(entries).toHaveLength(3);
        (0, vitest_1.expect)(entries.map(entry => entry.resultSummary)).toEqual([
            'Completed 1',
            'Completed 2',
            'Completed 3',
        ]);
    });
});
//# sourceMappingURL=browserOperationLedger.test.js.map