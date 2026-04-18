"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const { browserService } = vitest_1.vi.hoisted(() => ({
    browserService: {
        isCreated: vitest_1.vi.fn(() => true),
    },
}));
vitest_1.vi.mock('./BrowserService', () => ({ browserService }));
const browserContext_1 = require("./browserContext");
const browserContextManager_1 = require("./browserContextManager");
(0, vitest_1.describe)('browserContextManager', () => {
    (0, vitest_1.beforeEach)(() => {
        browserContextManager_1.browserContextManager.resetForTests(browserService);
    });
    (0, vitest_1.it)('resolves the singleton-backed default context when none is provided', () => {
        const context = browserContextManager_1.browserContextManager.resolveContext();
        (0, vitest_1.expect)(context.id).toBe(browserContext_1.DEFAULT_BROWSER_CONTEXT_ID);
        (0, vitest_1.expect)(context.isDefault).toBe(true);
        (0, vitest_1.expect)(context.service).toBe(browserService);
    });
    (0, vitest_1.it)('resolves an explicitly created context by id', () => {
        const secondaryService = { isCreated: vitest_1.vi.fn(() => true) };
        browserContextManager_1.browserContextManager.createContext({
            id: 'ctx_test',
            label: 'Test Context',
            service: secondaryService,
        });
        const context = browserContextManager_1.browserContextManager.resolveContext('ctx_test');
        (0, vitest_1.expect)(context).toEqual({
            id: 'ctx_test',
            label: 'Test Context',
            isDefault: false,
            service: secondaryService,
        });
    });
});
//# sourceMappingURL=browserContextManager.test.js.map