"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const ConstraintValidator_1 = require("./ConstraintValidator");
(0, vitest_1.describe)('ConstraintValidator', () => {
    (0, vitest_1.it)('validates closed browser tabs against post-action tab state', () => {
        const result = (0, ConstraintValidator_1.validateToolResult)('browser.close_tab', {
            summary: 'Closed 2 browser tabs',
            data: {
                tabIds: ['tab-1', 'tab-2'],
                activeTabId: 'tab-3',
                tabs: [{ id: 'tab-3' }],
            },
        }, { tabIds: ['tab-1', 'tab-2'] });
        (0, vitest_1.expect)(result?.status).toBe('VALID');
        (0, vitest_1.expect)(result?.constraints).toEqual(vitest_1.expect.arrayContaining([
            vitest_1.expect.objectContaining({
                name: 'tab_closed',
                status: 'PASS',
            }),
        ]));
    });
    (0, vitest_1.it)('marks browser tab close as invalid when the requested tab is still present', () => {
        const result = (0, ConstraintValidator_1.validateToolResult)('browser.close_tab', {
            summary: 'Closed 1 browser tab',
            data: {
                tabIds: ['tab-2'],
                activeTabId: 'tab-2',
                tabs: [{ id: 'tab-2' }, { id: 'tab-3' }],
            },
        }, { tabId: 'tab-2' });
        (0, vitest_1.expect)(result?.status).toBe('INVALID');
        (0, vitest_1.expect)(result?.constraints).toEqual(vitest_1.expect.arrayContaining([
            vitest_1.expect.objectContaining({
                name: 'tab_closed',
                status: 'FAIL',
            }),
        ]));
    });
    (0, vitest_1.it)('accepts a single retained homepage tab when closing the last browser tab', () => {
        const result = (0, ConstraintValidator_1.validateToolResult)('browser.close_tab', {
            summary: 'Closed 1 browser tab; retained one homepage tab',
            data: {
                tabIds: ['tab-2'],
                homepage: 'https://www.google.com',
                retainedLastTabId: 'tab-2',
                activeTabId: 'tab-2',
                tabs: [{
                        id: 'tab-2',
                        navigation: {
                            url: 'https://www.google.com/?zx=12345',
                        },
                    }],
            },
        }, { tabId: 'tab-2' });
        (0, vitest_1.expect)(result?.status).toBe('VALID');
        (0, vitest_1.expect)(result?.constraints).toEqual(vitest_1.expect.arrayContaining([
            vitest_1.expect.objectContaining({
                name: 'tab_closed',
                status: 'PASS',
            }),
        ]));
    });
    (0, vitest_1.it)('validates browser activate_tab against activeTabId', () => {
        const result = (0, ConstraintValidator_1.validateToolResult)('browser.activate_tab', {
            summary: 'Activated tab tab-9',
            data: {
                tabId: 'tab-9',
                activeTabId: 'tab-9',
                tabs: [{ id: 'tab-9' }, { id: 'tab-3' }],
            },
        }, { tabId: 'tab-9' });
        (0, vitest_1.expect)(result?.status).toBe('VALID');
        (0, vitest_1.expect)(result?.constraints).toEqual(vitest_1.expect.arrayContaining([
            vitest_1.expect.objectContaining({
                name: 'active_tab',
                status: 'PASS',
            }),
        ]));
    });
});
//# sourceMappingURL=ConstraintValidator.test.js.map