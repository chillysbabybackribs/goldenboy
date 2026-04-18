"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const browserOperationContext_1 = require("../browser/browserOperationContext");
const AgentToolExecutor_1 = require("./AgentToolExecutor");
(0, vitest_1.describe)('AgentToolExecutor', () => {
    (0, vitest_1.it)('provides browser operation context to browser tools', async () => {
        const executor = new AgentToolExecutor_1.AgentToolExecutor();
        const tool = {
            name: 'browser.navigate',
            description: 'Test browser tool',
            inputSchema: { type: 'object' },
            async execute() {
                return {
                    summary: 'ok',
                    data: {
                        context: (0, browserOperationContext_1.getBrowserOperationContext)(),
                    },
                };
            },
        };
        executor.register(tool);
        const result = await executor.execute('browser.navigate', { url: 'https://example.com' }, {
            runId: 'run_1',
            agentId: 'agent_1',
            mode: 'unrestricted-dev',
            taskId: 'task_1',
        });
        (0, vitest_1.expect)(result.data.context).toEqual({
            source: 'agent',
            taskId: 'task_1',
            agentId: 'agent_1',
            runId: 'run_1',
            contextId: null,
        });
    });
});
//# sourceMappingURL=AgentToolExecutor.test.js.map