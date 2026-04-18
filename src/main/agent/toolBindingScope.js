"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentToolBindingStore = void 0;
exports.createToolBindings = createToolBindings;
exports.promoteQueuedBindings = promoteQueuedBindings;
exports.listCallableTools = listCallableTools;
exports.queueExpandedBindings = queueExpandedBindings;
exports.createToolBindingStore = createToolBindingStore;
exports.createRequestToolBindingStore = createRequestToolBindingStore;
exports.listCallableRequestTools = listCallableRequestTools;
function createToolBindings(initialTools) {
    return initialTools.map((tool) => ({
        ...tool,
        state: 'callable',
    }));
}
function promoteQueuedBindings(bindings) {
    return bindings.map((binding) => (binding.state === 'queued_next_turn'
        ? { ...binding, state: 'callable' }
        : binding));
}
function listCallableTools(bindings) {
    return bindings
        .filter((binding) => binding.state === 'callable')
        .map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}
function queueExpandedBindings(bindings, toolCatalog, toolNames) {
    const bindingsByName = new Map(bindings.map((binding) => [binding.name, binding]));
    const catalogByName = new Map(toolCatalog.map((tool) => [tool.name, tool]));
    const nextBindings = [...bindings];
    for (const toolName of toolNames) {
        const existing = bindingsByName.get(toolName);
        if (existing) {
            if (existing.state === 'discoverable' || existing.state === 'failed' || existing.state === 'evicted') {
                const updated = { ...existing, state: 'queued_next_turn', failureReason: undefined };
                nextBindings[nextBindings.findIndex((binding) => binding.name === toolName)] = updated;
                bindingsByName.set(toolName, updated);
            }
            continue;
        }
        const schema = catalogByName.get(toolName);
        if (!schema)
            continue;
        const queued = {
            ...schema,
            state: 'queued_next_turn',
        };
        nextBindings.push(queued);
        bindingsByName.set(toolName, queued);
    }
    return nextBindings;
}
class AgentToolBindingStore {
    toolCatalog;
    bindings;
    constructor(initialBindings, toolCatalog) {
        this.toolCatalog = toolCatalog;
        this.bindings = initialBindings.map((binding) => ({ ...binding }));
    }
    static fromTools(initialTools, toolCatalog) {
        return new AgentToolBindingStore(createToolBindings(initialTools), toolCatalog);
    }
    static fromBindings(initialBindings, toolCatalog) {
        return new AgentToolBindingStore(initialBindings, toolCatalog);
    }
    beginTurn() {
        this.bindings = promoteQueuedBindings(this.bindings);
        return this.getCallableTools();
    }
    getCallableTools() {
        return listCallableTools(this.bindings);
    }
    getBindings() {
        return this.bindings.map((binding) => ({ ...binding }));
    }
    queueTools(toolNames) {
        this.bindings = queueExpandedBindings(this.bindings, this.toolCatalog, toolNames);
    }
}
exports.AgentToolBindingStore = AgentToolBindingStore;
function createToolBindingStore(initialTools, toolCatalog) {
    return AgentToolBindingStore.fromTools(initialTools, toolCatalog);
}
function createRequestToolBindingStore(request) {
    return AgentToolBindingStore.fromBindings(request.toolBindings, request.toolCatalog);
}
function listCallableRequestTools(request) {
    return createRequestToolBindingStore(request).getCallableTools();
}
//# sourceMappingURL=toolBindingScope.js.map