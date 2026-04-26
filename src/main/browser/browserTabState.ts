export type BrowserTabState = {
  activeTabId: string;
  splitLeftTabId: string | null;
  splitRightTabId: string | null;
};

export function nextActiveTabIdForClose<T>(
  tabs: Map<string, T>,
  closingTabId: string,
): string | null {
  const tabIds = Array.from(tabs.keys());
  const idx = tabIds.indexOf(closingTabId);
  if (idx === -1) return null;
  return tabIds[idx + 1] || tabIds[idx - 1] || null;
}

export function placeTabAfter<T>(
  tabs: Map<string, T>,
  tabId: string,
  insertAfterTabId: string,
): Map<string, T> {
  const entries = Array.from(tabs.entries());
  const fromIndex = entries.findIndex(([id]) => id === tabId);
  const afterIndex = entries.findIndex(([id]) => id === insertAfterTabId);
  if (fromIndex === -1 || afterIndex === -1) return tabs;
  if (fromIndex === afterIndex + 1) return tabs;

  const [entry] = entries.splice(fromIndex, 1);
  entries.splice(afterIndex + 1, 0, entry);
  return new Map(entries);
}

export function normalizeTabState<T>(
  tabs: Map<string, T>,
  state: BrowserTabState,
): BrowserTabState {
  let { activeTabId, splitLeftTabId, splitRightTabId } = state;

  if (splitLeftTabId && !tabs.has(splitLeftTabId)) splitLeftTabId = null;
  if (splitRightTabId && !tabs.has(splitRightTabId)) splitRightTabId = null;
  if (splitLeftTabId && splitRightTabId && splitLeftTabId === splitRightTabId) {
    splitRightTabId = null;
  }

  if (!activeTabId || !tabs.has(activeTabId)) {
    activeTabId = Array.from(tabs.keys())[0] || '';
  }

  if (!splitLeftTabId && tabs.size > 0) {
    splitLeftTabId = activeTabId || Array.from(tabs.keys())[0] || null;
  }

  if (tabs.size <= 1 || !splitRightTabId) {
    splitRightTabId = null;
    return { activeTabId, splitLeftTabId, splitRightTabId };
  }

  if (splitLeftTabId && !tabs.has(splitLeftTabId)) {
    splitLeftTabId = activeTabId || Array.from(tabs.keys())[0] || null;
  }

  return { activeTabId, splitLeftTabId, splitRightTabId };
}
