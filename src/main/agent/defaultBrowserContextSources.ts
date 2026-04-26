// ═══════════════════════════════════════════════════════════════════════════
// Default Browser Context Sources — production wiring for the browser
// context block injected into `AgentRuntime.run`. Isolated from AgentRuntime
// so unit tests can mock a single module instead of the whole browser stack.
// ═══════════════════════════════════════════════════════════════════════════

import { browserService } from '../browser/BrowserService';
import { pageKnowledgeStore } from '../browserKnowledge/PageKnowledgeStore';
import type { BrowserContextSources } from './browserContextInjection';

export const defaultBrowserContextSources = {
  isBrowserReady: () => browserService.isCreated(),
  getActiveTabId: () => browserService.getState().activeTabId,
  getTabs: () => browserService.getTabs(),
  // Task-scope the overview so long-running sessions do not drag pages from
  // unrelated prior tasks into every prompt. Pages that are untagged (cached
  // before any task was active) or stamped with the current task are kept
  // visible; everything else is hidden from this task's overview.
  listCachedPages: (filter) => {
    const pages = pageKnowledgeStore.listPages();
    const taskId = filter?.taskId;
    if (!taskId) return pages;
    return pages.filter(page => !page.taskId || page.taskId === taskId);
  },
} satisfies BrowserContextSources;
