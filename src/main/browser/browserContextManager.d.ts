import { BrowserContext, BrowserContextService, BrowserContextSummary } from './browserContext';
export declare class BrowserContextManager {
    private contexts;
    private defaultContextId;
    constructor(defaultContext?: BrowserContext);
    createContext(input: {
        id: string;
        service: BrowserContextService;
        label?: string;
        isDefault?: boolean;
    }): BrowserContext;
    getDefaultContext(): BrowserContext;
    resolveContext(contextId?: string | null): BrowserContext;
    listContexts(): BrowserContextSummary[];
    resetForTests(defaultService?: BrowserContextService): void;
}
export declare const browserContextManager: BrowserContextManager;
