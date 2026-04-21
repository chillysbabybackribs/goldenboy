// ═══════════════════════════════════════════════════════════════════════════
// Default Browser Context Sources — production wiring for the browser
// context block injected into `AgentRuntime.run`. Isolated from AgentRuntime
// so unit tests can mock a single module instead of the whole browser stack.
// ═══════════════════════════════════════════════════════════════════════════

import { browserService } from '../browser/BrowserService';
import { pageKnowledgeStore } from '../browserKnowledge/PageKnowledgeStore';
import type { BrowserContextSources } from './browserContextInjection';

export const defaultBrowserContextSources: BrowserContextSources = {
  isBrowserReady: () => browserService.isCreated(),
  getActiveTabId: () => browserService.getState().activeTabId,
  getTabs: () => browserService.getTabs(),
  listCachedPages: () => pageKnowledgeStore.listPages(),
};
