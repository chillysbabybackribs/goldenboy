// ═══════════════════════════════════════════════════════════════════════════
// Browser Action Executor — Routes browser actions to BrowserService
// Returns structured { summary, data } for both display and automation consumers.
// ═══════════════════════════════════════════════════════════════════════════

import {
  SurfaceActionKind, BrowserNavigatePayload,
  BrowserCreateTabPayload, BrowserCloseTabPayload, BrowserActivateTabPayload,
  BrowserClickPayload, BrowserTypePayload, BrowserClickRankedActionPayload,
  BrowserWaitForOverlayPayload, BrowserSemanticTargetPayload, BrowserOpenSearchResultsTabsPayload,
} from '../../shared/actions/surfaceActionTypes';
import { browserService } from '../browser/BrowserService';

export type ActionResult = { summary: string; data: Record<string, unknown> };

/**
 * Debug-only: artificial delay (ms) applied after browser.navigate execution.
 * Set via env: V2_DEBUG_NAVIGATE_DELAY_MS=3000
 */
function getDebugNavigateDelayMs(): number {
  const raw = process.env.V2_DEBUG_NAVIGATE_DELAY_MS;
  if (!raw) return 0;
  const ms = parseInt(raw, 10);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

function waitForBrowserLoad(timeoutMs: number = 5000): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    function check(): void {
      const state = browserService.getState();
      if (!state.navigation.isLoading) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        resolve(); // timeout — return whatever state exists
        return;
      }
      setTimeout(check, 200);
    }
    check();
  });
}

export async function executeBrowserAction(
  kind: SurfaceActionKind,
  payload: Record<string, unknown>,
): Promise<ActionResult> {
  if (!browserService.isCreated()) {
    throw new Error('Browser runtime not initialized');
  }

  switch (kind) {
    case 'browser.navigate': {
      const { url } = payload as BrowserNavigatePayload;
      browserService.navigate(url);

      const delayMs = getDebugNavigateDelayMs();
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }

      // Wait for page to finish loading (or timeout)
      await waitForBrowserLoad(5000);

      const state = browserService.getState();
      const metadata = await browserService.getPageMetadata();
      const preview = await browserService.getPageText(2000);

      return {
        summary: `Navigated to ${state.navigation.url || url}`,
        data: {
          url: state.navigation.url || url,
          title: state.navigation.title,
          isLoading: state.navigation.isLoading,
          tabCount: state.tabs.length,
          pagePreview: preview.slice(0, 2000),
          metadata,
        },
      };
    }

    case 'browser.back': {
      const before = browserService.getState();
      if (!before.navigation.canGoBack) {
        throw new Error('Cannot go back: no history');
      }
      browserService.goBack();
      const after = browserService.getState();
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
      const before = browserService.getState();
      if (!before.navigation.canGoForward) {
        throw new Error('Cannot go forward: no forward history');
      }
      browserService.goForward();
      const after = browserService.getState();
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
      browserService.reload();
      const state = browserService.getState();
      return {
        summary: 'Page reload initiated',
        data: { url: state.navigation.url, isLoading: state.navigation.isLoading },
      };
    }

    case 'browser.stop': {
      browserService.stop();
      const state = browserService.getState();
      return {
        summary: 'Page loading stopped',
        data: { url: state.navigation.url, isLoading: state.navigation.isLoading },
      };
    }

    case 'browser.create-tab': {
      const { url } = payload as BrowserCreateTabPayload;
      const tab = browserService.createTab(url);
      return {
        summary: url ? `Opened tab: ${url}` : `Opened new tab (${tab.id})`,
        data: { tabId: tab.id, url: url || '', totalTabs: browserService.getTabs().length },
      };
    }

    case 'browser.close-tab': {
      const { tabId } = payload as BrowserCloseTabPayload;
      browserService.closeTab(tabId);
      return {
        summary: `Closed tab ${tabId}`,
        data: { closedTabId: tabId, remainingTabs: browserService.getTabs().length },
      };
    }

    case 'browser.activate-tab': {
      const { tabId } = payload as BrowserActivateTabPayload;
      browserService.activateTab(tabId);
      const state = browserService.getState();
      return {
        summary: `Activated tab ${tabId}`,
        data: { tabId, url: state.navigation.url, title: state.navigation.title },
      };
    }

    case 'browser.click': {
      const { selector, tabId } = payload as BrowserClickPayload;
      const result = await browserService.clickElement(selector, tabId);
      if (!result.clicked) {
        throw new Error(result.error || `Click failed: ${selector}`);
      }
      return {
        summary: `Clicked: ${selector}`,
        data: { selector, clicked: true },
      };
    }

    case 'browser.type': {
      const { selector, text, tabId } = payload as BrowserTypePayload;
      const result = await browserService.typeInElement(selector, text, tabId);
      if (!result.typed) {
        throw new Error(result.error || `Type failed: ${selector}`);
      }
      return {
        summary: `Typed in: ${selector}`,
        data: { selector, typed: true, textLength: text.length },
      };
    }

    case 'browser.dismiss-foreground-ui': {
      const { tabId } = payload as BrowserSemanticTargetPayload;
      const result = await browserService.dismissForegroundUI(tabId);
      if (!result.success) throw new Error(result.error || 'No dismiss action succeeded');
      return {
        summary: result.beforeModalPresent && !result.afterModalPresent
          ? 'Dismissed foreground UI'
          : 'Attempted to dismiss foreground UI',
        data: result,
      };
    }

    case 'browser.return-to-primary-surface': {
      const { tabId } = payload as BrowserSemanticTargetPayload;
      const result = await browserService.returnToPrimarySurface(tabId);
      if (!result.success) throw new Error(result.error || 'Primary surface not restored');
      return {
        summary: result.restored ? 'Returned to primary surface' : 'Attempted to return to primary surface',
        data: result,
      };
    }

    case 'browser.click-ranked-action': {
      const ranked = await browserService.clickRankedAction(payload as BrowserClickRankedActionPayload);
      if (!ranked.success) throw new Error(ranked.error || 'Ranked action failed');
      return {
        summary: `Clicked ranked action: ${ranked.clickedAction?.text || ranked.clickedAction?.ref.selector || ranked.clickedAction?.id || 'unknown'}`,
        data: ranked,
      };
    }

    case 'browser.wait-for-overlay-state': {
      const { tabId, state, timeoutMs } = payload as BrowserWaitForOverlayPayload;
      const result = await browserService.waitForOverlayState(state, timeoutMs, tabId);
      if (!result.success) throw new Error(result.error || `Overlay did not become ${state}`);
      return {
        summary: `Overlay is now ${state}`,
        data: result,
      };
    }

    case 'browser.open-search-results-tabs': {
      const result = await browserService.openSearchResultsTabs(payload as BrowserOpenSearchResultsTabsPayload);
      if (!result.success) throw new Error(result.error || 'No search results were opened');
      return {
        summary: `Opened ${result.openedTabIds.length} search result tabs`,
        data: result,
      };
    }

    default:
      throw new Error(`Unknown browser action kind: ${kind}`);
  }
}
