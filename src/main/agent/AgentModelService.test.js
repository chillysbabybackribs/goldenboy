"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const startupProgress_1 = require("./startupProgress");
const model_1 = require("../../shared/types/model");
(0, vitest_1.describe)('AgentModelService startup progress', () => {
    (0, vitest_1.it)('emits no user-facing startup statuses for research tasks', () => {
        (0, vitest_1.expect)((0, startupProgress_1.buildStartupStatusMessages)({
            taskKind: 'research',
            browserSurfaceReady: true,
        })).toEqual([]);
        (0, vitest_1.expect)((0, startupProgress_1.buildStartupStatusMessages)({
            taskKind: 'research',
            browserSurfaceReady: false,
        })).toEqual([]);
    });
    (0, vitest_1.it)('emits no user-facing startup statuses for browser automation', () => {
        (0, vitest_1.expect)((0, startupProgress_1.buildStartupStatusMessages)({
            taskKind: 'browser-automation',
            browserSurfaceReady: true,
        })).toEqual([]);
    });
    (0, vitest_1.it)('reports the correct execution backend label per provider', () => {
        (0, vitest_1.expect)((0, startupProgress_1.resolveExecutionBackendLabel)(model_1.PRIMARY_PROVIDER_ID)).toBe('app-server');
        (0, vitest_1.expect)((0, startupProgress_1.resolveExecutionBackendLabel)(model_1.HAIKU_PROVIDER_ID)).toBe('anthropic-api');
    });
});
//# sourceMappingURL=AgentModelService.test.js.map