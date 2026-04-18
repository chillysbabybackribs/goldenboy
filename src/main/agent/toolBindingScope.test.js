"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const toolBindingScope_1 = require("./toolBindingScope");
(0, vitest_1.describe)('toolBindingScope', () => {
    const catalog = [
        { name: 'runtime.search_tools', description: 'Search tools', inputSchema: {} },
        { name: 'browser.close_tab', description: 'Close a browser tab', inputSchema: {} },
        { name: 'browser.get_tabs', description: 'List browser tabs', inputSchema: {} },
    ];
    (0, vitest_1.it)('keeps newly expanded tools out of the callable set until promotion', () => {
        const initial = (0, toolBindingScope_1.createToolBindings)([catalog[0]]);
        const queued = (0, toolBindingScope_1.queueExpandedBindings)(initial, [...catalog], ['browser.close_tab']);
        (0, vitest_1.expect)((0, toolBindingScope_1.listCallableTools)(queued).map((tool) => tool.name)).toEqual(['runtime.search_tools']);
        (0, vitest_1.expect)(queued.find((binding) => binding.name === 'browser.close_tab')?.state).toBe('queued_next_turn');
        const promoted = (0, toolBindingScope_1.promoteQueuedBindings)(queued);
        (0, vitest_1.expect)((0, toolBindingScope_1.listCallableTools)(promoted).map((tool) => tool.name)).toEqual([
            'runtime.search_tools',
            'browser.close_tab',
        ]);
    });
    (0, vitest_1.it)('does not duplicate already callable tools when queueing an expansion', () => {
        const initial = (0, toolBindingScope_1.createToolBindings)([catalog[0], catalog[1]]);
        const queued = (0, toolBindingScope_1.queueExpandedBindings)(initial, [...catalog], ['browser.close_tab', 'browser.get_tabs']);
        (0, vitest_1.expect)(queued.filter((binding) => binding.name === 'browser.close_tab')).toHaveLength(1);
        (0, vitest_1.expect)(queued.find((binding) => binding.name === 'browser.close_tab')?.state).toBe('callable');
        (0, vitest_1.expect)(queued.find((binding) => binding.name === 'browser.get_tabs')?.state).toBe('queued_next_turn');
    });
    (0, vitest_1.it)('promotes queued tools only when a new turn begins in the binding store', () => {
        const store = (0, toolBindingScope_1.createToolBindingStore)([catalog[0]], [...catalog]);
        (0, vitest_1.expect)(store.beginTurn().map((tool) => tool.name)).toEqual(['runtime.search_tools']);
        store.queueTools(['browser.close_tab']);
        (0, vitest_1.expect)(store.getCallableTools().map((tool) => tool.name)).toEqual(['runtime.search_tools']);
        (0, vitest_1.expect)(store.beginTurn().map((tool) => tool.name)).toEqual([
            'runtime.search_tools',
            'browser.close_tab',
        ]);
    });
    (0, vitest_1.it)('can restore a binding store from explicit binding state', () => {
        const store = toolBindingScope_1.AgentToolBindingStore.fromBindings([
            { ...catalog[0], state: 'callable' },
            { ...catalog[1], state: 'queued_next_turn' },
        ], [...catalog]);
        (0, vitest_1.expect)(store.getCallableTools().map((tool) => tool.name)).toEqual(['runtime.search_tools']);
        (0, vitest_1.expect)(store.beginTurn().map((tool) => tool.name)).toEqual([
            'runtime.search_tools',
            'browser.close_tab',
        ]);
    });
});
//# sourceMappingURL=toolBindingScope.test.js.map