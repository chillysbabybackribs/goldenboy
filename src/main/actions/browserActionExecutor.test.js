"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const { executeBrowserOperation } = vitest_1.vi.hoisted(() => ({
    executeBrowserOperation: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../browser/browserOperations', () => ({ executeBrowserOperation }));
const browserActionExecutor_1 = require("./browserActionExecutor");
(0, vitest_1.describe)('executeBrowserAction', () => {
    (0, vitest_1.beforeEach)(() => {
        executeBrowserOperation.mockReset();
    });
    (0, vitest_1.it)('forwards surface browser actions to the authoritative browser operation layer', async () => {
        executeBrowserOperation.mockResolvedValue({
            summary: 'Opened tab: https://example.com',
            data: { tabId: 'tab_1' },
        });
        const result = await (0, browserActionExecutor_1.executeBrowserAction)('browser.create-tab', { url: 'https://example.com' }, { taskId: 'task_1', origin: 'command-center' });
        (0, vitest_1.expect)(executeBrowserOperation).toHaveBeenCalledWith({
            kind: 'browser.create-tab',
            payload: { url: 'https://example.com' },
            context: {
                taskId: 'task_1',
                contextId: null,
                source: 'ui',
            },
        });
        (0, vitest_1.expect)(result).toEqual({
            summary: 'Opened tab: https://example.com',
            data: { tabId: 'tab_1' },
        });
    });
    (0, vitest_1.it)('rejects non-browser actions', async () => {
        await (0, vitest_1.expect)((0, browserActionExecutor_1.executeBrowserAction)('terminal.execute', { command: 'pwd' }))
            .rejects
            .toThrow('Unknown browser action kind: terminal.execute');
    });
});
//# sourceMappingURL=browserActionExecutor.test.js.map