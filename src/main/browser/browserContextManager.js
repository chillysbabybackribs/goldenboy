"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.browserContextManager = exports.BrowserContextManager = void 0;
const BrowserService_1 = require("./BrowserService");
const browserContext_1 = require("./browserContext");
function createDefaultBrowserContext(service = BrowserService_1.browserService) {
    return {
        id: browserContext_1.DEFAULT_BROWSER_CONTEXT_ID,
        label: 'Default Browser Context',
        isDefault: true,
        service,
    };
}
class BrowserContextManager {
    contexts = new Map();
    defaultContextId = browserContext_1.DEFAULT_BROWSER_CONTEXT_ID;
    constructor(defaultContext = createDefaultBrowserContext()) {
        this.contexts.set(defaultContext.id, defaultContext);
        this.defaultContextId = defaultContext.id;
    }
    createContext(input) {
        const context = {
            id: input.id,
            label: input.label || input.id,
            isDefault: input.isDefault === true,
            service: input.service,
        };
        this.contexts.set(context.id, context);
        if (context.isDefault) {
            this.defaultContextId = context.id;
            for (const [id, existing] of this.contexts) {
                if (id === context.id)
                    continue;
                this.contexts.set(id, { ...existing, isDefault: false });
            }
        }
        return { ...context };
    }
    getDefaultContext() {
        const context = this.contexts.get(this.defaultContextId);
        if (!context) {
            throw new Error(`Default browser context not found: ${this.defaultContextId}`);
        }
        return context;
    }
    resolveContext(contextId) {
        if (!contextId)
            return this.getDefaultContext();
        const context = this.contexts.get(contextId);
        if (!context) {
            throw new Error(`Unknown browser context: ${contextId}`);
        }
        return context;
    }
    listContexts() {
        return Array.from(this.contexts.values()).map(({ id, label, isDefault }) => ({
            id,
            label,
            isDefault,
        }));
    }
    resetForTests(defaultService = BrowserService_1.browserService) {
        this.contexts.clear();
        const defaultContext = createDefaultBrowserContext(defaultService);
        this.contexts.set(defaultContext.id, defaultContext);
        this.defaultContextId = defaultContext.id;
    }
}
exports.BrowserContextManager = BrowserContextManager;
exports.browserContextManager = new BrowserContextManager();
//# sourceMappingURL=browserContextManager.js.map