import { browserService } from './BrowserService';
import {
  BrowserContext,
  BrowserContextService,
  BrowserContextSummary,
  DEFAULT_BROWSER_CONTEXT_ID,
} from './browserContext';

function createDefaultBrowserContext(
  service: BrowserContextService = browserService,
): BrowserContext {
  return {
    id: DEFAULT_BROWSER_CONTEXT_ID,
    label: 'Default Browser Context',
    isDefault: true,
    service,
  };
}

export class BrowserContextManager {
  private contexts = new Map<string, BrowserContext>();
  private defaultContextId = DEFAULT_BROWSER_CONTEXT_ID;

  constructor(defaultContext: BrowserContext = createDefaultBrowserContext()) {
    this.contexts.set(defaultContext.id, defaultContext);
    this.defaultContextId = defaultContext.id;
  }

  createContext(input: {
    id: string;
    service: BrowserContextService;
    label?: string;
    isDefault?: boolean;
  }): BrowserContext {
    const context: BrowserContext = {
      id: input.id,
      label: input.label || input.id,
      isDefault: input.isDefault === true,
      service: input.service,
    };
    this.contexts.set(context.id, context);
    if (context.isDefault) {
      this.defaultContextId = context.id;
      for (const [id, existing] of this.contexts) {
        if (id === context.id) continue;
        this.contexts.set(id, { ...existing, isDefault: false });
      }
    }
    return { ...context };
  }

  getDefaultContext(): BrowserContext {
    const context = this.contexts.get(this.defaultContextId);
    if (!context) {
      throw new Error(`Default browser context not found: ${this.defaultContextId}`);
    }
    return context;
  }

  resolveContext(contextId?: string | null): BrowserContext {
    if (!contextId) return this.getDefaultContext();
    const context = this.contexts.get(contextId);
    if (!context) {
      throw new Error(`Unknown browser context: ${contextId}`);
    }
    return context;
  }

  listContexts(): BrowserContextSummary[] {
    return Array.from(this.contexts.values()).map(({ id, label, isDefault }) => ({
      id,
      label,
      isDefault,
    }));
  }

  resetForTests(defaultService: BrowserContextService = browserService): void {
    this.contexts.clear();
    const defaultContext = createDefaultBrowserContext(defaultService);
    this.contexts.set(defaultContext.id, defaultContext);
    this.defaultContextId = defaultContext.id;
  }
}

export const browserContextManager = new BrowserContextManager();
