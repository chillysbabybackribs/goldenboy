import type { BrowserContextService } from './browserContext';
import { executeNavigation, prepareSearchEngineQuery } from './browserOperations.utils';
import { normalizeNavigationTarget } from './navigationTarget';
import type { BrowserOperationResult } from './browserOperations';

type BrowserNavigationOperationKind =
  | 'browser.navigate'
  | 'browser.search-web'
  | 'browser.back'
  | 'browser.forward'
  | 'browser.reload'
  | 'browser.stop'
  | 'browser.create-tab'
  | 'browser.close-tab'
  | 'browser.activate-tab'
  | 'browser.split-tab'
  | 'browser.clear-split-view';

type BrowserNavigationPayload = Record<string, unknown>;

export type BrowserNavigationOperationInput = {
  kind: BrowserNavigationOperationKind;
  payload: BrowserNavigationPayload;
};

export async function executeNavigationOperations(
  browser: BrowserContextService,
  input: BrowserNavigationOperationInput,
): Promise<BrowserOperationResult> {
  switch (input.kind) {
    case 'browser.navigate': {
      const { url } = input.payload as { url: string };
      return executeNavigation(browser, url);
    }

    case 'browser.search-web': {
      const { query } = input.payload as { query: string };
      return executeNavigation(
        browser,
        normalizeNavigationTarget(prepareSearchEngineQuery(query), { searchEngine: 'duckduckgo' }).url,
      );
    }

    case 'browser.back': {
      const before = browser.getState();
      if (!before.navigation.canGoBack) {
        throw new Error('Cannot go back: no history');
      }
      browser.goBack();
      const after = browser.getState();
      return {
        summary: 'Navigated back',
        data: {
          url: after.navigation.url,
          title: after.navigation.title,
          canGoBack: after.navigation.canGoBack,
          canGoForward: after.navigation.canGoForward,
        },
      };
    }

    case 'browser.forward': {
      const before = browser.getState();
      if (!before.navigation.canGoForward) {
        throw new Error('Cannot go forward: no forward history');
      }
      browser.goForward();
      const after = browser.getState();
      return {
        summary: 'Navigated forward',
        data: {
          url: after.navigation.url,
          title: after.navigation.title,
          canGoBack: after.navigation.canGoBack,
          canGoForward: after.navigation.canGoForward,
        },
      };
    }

    case 'browser.reload': {
      browser.reload();
      const state = browser.getState();
      return {
        summary: 'Page reload initiated',
        data: { url: state.navigation.url, isLoading: state.navigation.isLoading },
      };
    }

    case 'browser.stop': {
      browser.stop();
      const state = browser.getState();
      return {
        summary: 'Page loading stopped',
        data: { url: state.navigation.url, isLoading: state.navigation.isLoading },
      };
    }

    case 'browser.create-tab': {
      const { url, insertAfterTabId } = input.payload as { url?: string; insertAfterTabId?: string };
      const tab = browser.createTab(url, insertAfterTabId);
      return {
        summary: url ? `Opened tab: ${url}` : `Opened new tab (${tab.id})`,
        data: {
          tabId: tab.id,
          url: url || '',
          totalTabs: browser.getTabs().length,
        },
      };
    }

    case 'browser.close-tab': {
      const { tabId } = input.payload as { tabId: string };
      browser.closeTab(tabId);
      return {
        summary: `Closed tab ${tabId}`,
        data: { closedTabId: tabId, remainingTabs: browser.getTabs().length },
      };
    }

    case 'browser.activate-tab': {
      const { tabId } = input.payload as { tabId: string };
      browser.activateTab(tabId);
      const state = browser.getState();
      return {
        summary: `Activated tab ${tabId}`,
        data: { tabId, url: state.navigation.url, title: state.navigation.title },
      };
    }

    case 'browser.split-tab': {
      const { tabId } = input.payload as { tabId: string };
      const tab = browser.splitTab(tabId);
      return {
        summary: `Split browser tab into ${tab.id}`,
        data: {
          tabId: tab.id,
          splitLeftTabId: browser.getState().splitLeftTabId,
          splitRightTabId: browser.getState().splitRightTabId,
        },
      };
    }

    case 'browser.clear-split-view': {
      browser.clearSplitView();
      const state = browser.getState();
      return {
        summary: 'Cleared split view',
        data: {
          splitLeftTabId: state.splitLeftTabId,
          splitRightTabId: state.splitRightTabId,
        },
      };
    }

    default:
      throw new Error(`Unsupported navigation operation: ${input.kind}`);
  }
}
