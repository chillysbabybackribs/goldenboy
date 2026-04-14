import {
  BrowserActivateTabPayload,
  BrowserClickPayload,
  BrowserClickRankedActionPayload,
  BrowserCloseTabPayload,
  BrowserCreateTabPayload,
  BrowserOpenSearchResultsTabsPayload,
  BrowserSemanticTargetPayload,
  BrowserSplitTabPayload,
  BrowserTypePayload,
  BrowserWaitForOverlayPayload,
} from '../../shared/actions/surfaceActionTypes';
import type {
  BrowserOperationContextId,
  BrowserOperationExecutionContext,
  BrowserOperationKind,
} from '../../shared/types/browserOperationLedger';
import type { BrowserContextService } from './browserContext';
import { getBrowserOperationContext } from './browserOperationContext';
import { browserContextManager } from './browserContextManager';
import { browserOperationLedger } from './browserOperationLedger';

export type { BrowserOperationKind } from '../../shared/types/browserOperationLedger';

type BrowserUploadFilePayload = { selector: string; filePath: string; tabId?: string };
type BrowserDownloadLinkPayload = { selector: string; tabId?: string };
type BrowserDownloadUrlPayload = { url: string; tabId?: string };
type BrowserGetDownloadsPayload = { state?: string; filename?: string; tabId?: string };
type BrowserWaitForDownloadPayload = { downloadId?: string; filename?: string; tabId?: string; timeoutMs?: number };
type BrowserDragPayload = { sourceSelector: string; targetSelector: string; tabId?: string };
type BrowserHoverPayload = { selector: string; tabId?: string };
type BrowserHitTestPayload = { selector: string; tabId?: string };
type BrowserInspectPagePayload = { tabId?: string; textLimit?: number; elementLimit?: number };
type BrowserDialogsPayload = { tabId?: string; dialogId?: string; promptText?: string };
type BrowserActionableElementsPayload = { tabId?: string };
type BrowserSnapshotPayload = { tabId?: string };

export type BrowserOperationPayloadMap = {
  'browser.navigate': { url: string };
  'browser.back': Record<string, never>;
  'browser.forward': Record<string, never>;
  'browser.reload': Record<string, never>;
  'browser.stop': Record<string, never>;
  'browser.create-tab': BrowserCreateTabPayload;
  'browser.close-tab': BrowserCloseTabPayload;
  'browser.activate-tab': BrowserActivateTabPayload;
  'browser.split-tab': BrowserSplitTabPayload;
  'browser.clear-split-view': Record<string, never>;
  'browser.click': BrowserClickPayload;
  'browser.type': BrowserTypePayload;
  'browser.dismiss-foreground-ui': BrowserSemanticTargetPayload;
  'browser.return-to-primary-surface': BrowserSemanticTargetPayload;
  'browser.click-ranked-action': BrowserClickRankedActionPayload;
  'browser.wait-for-overlay-state': BrowserWaitForOverlayPayload;
  'browser.open-search-results-tabs': BrowserOpenSearchResultsTabsPayload;
  'browser.get-state': Record<string, never>;
  'browser.get-tabs': Record<string, never>;
  'browser.search-web': { query: string };
  'browser.upload-file': BrowserUploadFilePayload;
  'browser.download-link': BrowserDownloadLinkPayload;
  'browser.download-url': BrowserDownloadUrlPayload;
  'browser.get-downloads': BrowserGetDownloadsPayload;
  'browser.wait-for-download': BrowserWaitForDownloadPayload;
  'browser.drag': BrowserDragPayload;
  'browser.hover': BrowserHoverPayload;
  'browser.hit-test': BrowserHitTestPayload;
  'browser.inspect-page': BrowserInspectPagePayload;
  'browser.get-dialogs': BrowserDialogsPayload;
  'browser.accept-dialog': BrowserDialogsPayload;
  'browser.dismiss-dialog': BrowserDialogsPayload;
  'browser.get-actionable-elements': BrowserActionableElementsPayload;
  'browser.capture-snapshot': BrowserSnapshotPayload;
};

export type BrowserOperationInput = {
  [K in BrowserOperationKind]: {
    kind: K;
    payload: BrowserOperationPayloadMap[K];
    context?: BrowserOperationExecutionContext & BrowserOperationContextId;
  };
}[BrowserOperationKind];

export type BrowserOperationResult = {
  summary: string;
  data: Record<string, unknown>;
};

function getDebugNavigateDelayMs(): number {
  const raw = process.env.V2_DEBUG_NAVIGATE_DELAY_MS;
  if (!raw) return 0;
  const ms = parseInt(raw, 10);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

function requireBrowserRuntime(browser: BrowserContextService): void {
  if (!browser.isCreated()) {
    throw new Error('Browser runtime not initialized');
  }
}

async function waitForBrowserLoad(
  browser: BrowserContextService,
  timeoutMs: number = 5000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    const state = browser.getState();
    if (!state.navigation.isLoading) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

async function executeNavigation(
  browser: BrowserContextService,
  url: string,
): Promise<BrowserOperationResult> {
  browser.navigate(url);

  const delayMs = getDebugNavigateDelayMs();
  if (delayMs > 0) {
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  await waitForBrowserLoad(browser, 5000);

  const state = browser.getState();
  const metadata = await browser.getPageMetadata();
  const preview = await browser.getPageText(2000);

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

function resolveOperationTabId(
  state: ReturnType<BrowserContextService['getState']>,
  payload: Record<string, unknown>,
  context?: BrowserOperationExecutionContext,
): string | null {
  const payloadTabId = typeof payload.tabId === 'string' && payload.tabId ? payload.tabId : null;
  return context?.tabId ?? payloadTabId ?? state.activeTabId ?? null;
}

export function executeBrowserOperation<K extends BrowserOperationKind>(
  input: {
    kind: K;
    payload: BrowserOperationPayloadMap[K];
    context?: BrowserOperationExecutionContext & BrowserOperationContextId;
  },
): Promise<BrowserOperationResult>;
export async function executeBrowserOperation(
  input: BrowserOperationInput,
): Promise<BrowserOperationResult> {
  const operationContext = {
    ...getBrowserOperationContext(),
    ...input.context,
  };
  const browserContext = browserContextManager.resolveContext(operationContext.contextId);
  const browser = browserContext.service;
  requireBrowserRuntime(browser);
  const browserState = browser.getState();
  const ledgerEntry = browserOperationLedger.start({
    kind: input.kind,
    payload: input.payload as Record<string, unknown>,
    contextId: browserContext.id,
    context: operationContext,
    state: browserState,
  });
  browser.beginOperationNetworkScope({
    operationId: ledgerEntry.operationId,
    contextId: browserContext.id,
    kind: input.kind,
    tabId: resolveOperationTabId(browserState, input.payload as Record<string, unknown>, operationContext),
  });

  try {
    let result: BrowserOperationResult;

    switch (input.kind) {
      case 'browser.navigate':
        result = await executeNavigation(browser, input.payload.url);
        break;

      case 'browser.search-web':
        result = await executeNavigation(browser, input.payload.query);
        break;

      case 'browser.back': {
        const before = browser.getState();
        if (!before.navigation.canGoBack) {
          throw new Error('Cannot go back: no history');
        }
        browser.goBack();
        const after = browser.getState();
        result = {
          summary: 'Navigated back',
          data: {
            url: after.navigation.url,
            title: after.navigation.title,
            canGoBack: after.navigation.canGoBack,
            canGoForward: after.navigation.canGoForward,
          },
        };
        break;
      }

      case 'browser.forward': {
        const before = browser.getState();
        if (!before.navigation.canGoForward) {
          throw new Error('Cannot go forward: no forward history');
        }
        browser.goForward();
        const after = browser.getState();
        result = {
          summary: 'Navigated forward',
          data: {
            url: after.navigation.url,
            title: after.navigation.title,
            canGoBack: after.navigation.canGoBack,
            canGoForward: after.navigation.canGoForward,
          },
        };
        break;
      }

      case 'browser.reload': {
        browser.reload();
        const state = browser.getState();
        result = {
          summary: 'Page reload initiated',
          data: { url: state.navigation.url, isLoading: state.navigation.isLoading },
        };
        break;
      }

      case 'browser.stop': {
        browser.stop();
        const state = browser.getState();
        result = {
          summary: 'Page loading stopped',
          data: { url: state.navigation.url, isLoading: state.navigation.isLoading },
        };
        break;
      }

      case 'browser.create-tab': {
        const { url, insertAfterTabId } = input.payload;
        const tab = browser.createTab(url, insertAfterTabId);
        result = {
          summary: url ? `Opened tab: ${url}` : `Opened new tab (${tab.id})`,
          data: {
            tabId: tab.id,
            url: url || '',
            totalTabs: browser.getTabs().length,
          },
        };
        break;
      }

      case 'browser.close-tab': {
        const { tabId } = input.payload;
        browser.closeTab(tabId);
        result = {
          summary: `Closed tab ${tabId}`,
          data: { closedTabId: tabId, remainingTabs: browser.getTabs().length },
        };
        break;
      }

      case 'browser.activate-tab': {
        const { tabId } = input.payload;
        browser.activateTab(tabId);
        const state = browser.getState();
        result = {
          summary: `Activated tab ${tabId}`,
          data: { tabId, url: state.navigation.url, title: state.navigation.title },
        };
        break;
      }

      case 'browser.split-tab': {
        const tab = browser.splitTab(input.payload.tabId);
        result = {
          summary: `Split browser tab into ${tab.id}`,
          data: {
            tabId: tab.id,
            splitLeftTabId: browser.getState().splitLeftTabId,
            splitRightTabId: browser.getState().splitRightTabId,
          },
        };
        break;
      }

      case 'browser.clear-split-view': {
        browser.clearSplitView();
        const state = browser.getState();
        result = {
          summary: 'Cleared split view',
          data: {
            splitLeftTabId: state.splitLeftTabId,
            splitRightTabId: state.splitRightTabId,
          },
        };
        break;
      }

      case 'browser.click': {
        const { selector, tabId } = input.payload;
        const clickResult = await browser.clickElement(selector, tabId);
        if (!clickResult.clicked) {
          throw new Error(clickResult.error || `Click failed: ${selector}`);
        }
        result = {
          summary: `Clicked: ${selector}`,
          data: { selector, result: clickResult },
        };
        break;
      }

      case 'browser.type': {
        const { selector, text, tabId } = input.payload;
        const typeResult = await browser.typeInElement(selector, text, tabId);
        if (!typeResult.typed) {
          throw new Error(typeResult.error || `Type failed: ${selector}`);
        }
        result = {
          summary: `Typed in: ${selector}`,
          data: { selector, textLength: text.length, result: typeResult },
        };
        break;
      }

      case 'browser.upload-file': {
        const { selector, filePath, tabId } = input.payload;
        const uploadResult = await browser.uploadFileToElement(selector, filePath, tabId);
        if (!uploadResult.uploaded) {
          throw new Error(uploadResult.error || `Upload failed: ${selector}`);
        }
        result = {
          summary: `Attached ${uploadResult.fileName || filePath} to ${selector}`,
          data: { selector, filePath, result: uploadResult },
        };
        break;
      }

      case 'browser.download-link': {
        const { selector, tabId } = input.payload;
        const downloadLinkResult = await browser.downloadLink(selector, tabId);
        if (!downloadLinkResult.started) {
          throw new Error(downloadLinkResult.error || `Download link failed: ${selector}`);
        }
        result = {
          summary: `Started browser download from ${downloadLinkResult.href || selector}`,
          data: { selector, result: downloadLinkResult },
        };
        break;
      }

      case 'browser.download-url': {
        const { url, tabId } = input.payload;
        const downloadUrlResult = await browser.downloadUrl(url, tabId);
        if (!downloadUrlResult.started) {
          throw new Error(downloadUrlResult.error || `Download URL failed: ${url}`);
        }
        result = {
          summary: `Started browser download for ${url}`,
          data: { url, result: downloadUrlResult },
        };
        break;
      }

      case 'browser.get-downloads': {
        const { state, filename, tabId } = input.payload;
        const downloads = browser.getDownloads()
          .filter(download => !state || download.state === state)
          .filter(download => !filename || download.filename === filename)
          .filter(download => !tabId || download.sourceTabId === tabId);
        result = {
          summary: downloads.length === 0
            ? 'No browser downloads matched'
            : `Found ${downloads.length} browser download${downloads.length === 1 ? '' : 's'}`,
          data: { downloads },
        };
        break;
      }

      case 'browser.wait-for-download': {
        const waitResult = await browser.waitForDownload({
          downloadId: input.payload.downloadId,
          filename: input.payload.filename,
          tabId: input.payload.tabId,
          timeoutMs: input.payload.timeoutMs,
        });
        result = {
          summary: waitResult.timedOut
            ? 'Timed out waiting for browser download'
            : waitResult.completed
              ? `Browser download completed: ${waitResult.download?.filename || 'unknown file'}`
              : `Browser download settled without completion: ${waitResult.download?.state || 'unknown state'}`,
          data: { result: waitResult },
        };
        break;
      }

      case 'browser.drag': {
        const dragResult = await browser.dragElement(
          input.payload.sourceSelector,
          input.payload.targetSelector,
          input.payload.tabId,
        );
        if (!dragResult.dragged) {
          throw new Error(dragResult.error || 'Drag failed');
        }
        result = {
          summary: `Dragged ${input.payload.sourceSelector} to ${input.payload.targetSelector}`,
          data: { result: dragResult },
        };
        break;
      }

      case 'browser.hover': {
        const { selector, tabId } = input.payload;
        const hoverResult = await browser.hoverElement(selector, tabId);
        if (!hoverResult.hovered) {
          throw new Error(hoverResult.error || `Hover failed: ${selector}`);
        }
        result = {
          summary: `Hovered: ${selector}`,
          data: { selector, result: hoverResult },
        };
        break;
      }

      case 'browser.hit-test': {
        const { selector, tabId } = input.payload;
        const hitTest = await browser.hitTestElement(selector, tabId);
        result = {
          summary: hitTest.ok ? `Hit tested ${selector}` : `Hit test failed for ${selector}`,
          data: { hitTest },
        };
        break;
      }

      case 'browser.get-state':
        result = { summary: 'Read browser state', data: { state: browser.getState() } };
        break;

      case 'browser.get-tabs':
        result = { summary: 'Read browser tabs', data: { tabs: browser.getTabs() } };
        break;

      case 'browser.inspect-page': {
        const textLimit = Math.min(input.payload.textLimit ?? 3000, 6000);
        const elementLimit = Math.min(input.payload.elementLimit ?? 30, 80);
        const tabId = input.payload.tabId;
        const [metadata, text, snapshot, forms] = await Promise.all([
          browser.getPageMetadata(tabId),
          browser.getPageText(textLimit),
          browser.captureTabSnapshot(tabId),
          browser.getFormModel(tabId),
        ]);
        result = {
          summary: `Inspected page ${snapshot.title || snapshot.url}`,
          data: {
            navigation: browser.getState().navigation,
            metadata,
            text,
            viewport: snapshot.viewport,
            forms,
            actionableElements: snapshot.actionableElements.slice(0, elementLimit),
          },
        };
        break;
      }

      case 'browser.dismiss-foreground-ui': {
        const dismissResult = await browser.dismissForegroundUI(input.payload.tabId);
        if (!dismissResult.success) throw new Error(dismissResult.error || 'No dismiss action succeeded');
        result = {
          summary: dismissResult.beforeModalPresent && !dismissResult.afterModalPresent
            ? 'Dismissed foreground UI'
            : 'Attempted to dismiss foreground UI',
          data: dismissResult,
        };
        break;
      }

      case 'browser.return-to-primary-surface': {
        const returnResult = await browser.returnToPrimarySurface(input.payload.tabId);
        if (!returnResult.success) throw new Error(returnResult.error || 'Primary surface not restored');
        result = {
          summary: returnResult.restored ? 'Returned to primary surface' : 'Attempted to return to primary surface',
          data: returnResult,
        };
        break;
      }

      case 'browser.click-ranked-action': {
        const ranked = await browser.clickRankedAction(input.payload);
        if (!ranked.success) throw new Error(ranked.error || 'Ranked action failed');
        result = {
          summary: `Clicked ranked action: ${ranked.clickedAction?.text || ranked.clickedAction?.ref.selector || ranked.clickedAction?.id || 'unknown'}`,
          data: ranked,
        };
        break;
      }

      case 'browser.wait-for-overlay-state': {
        const overlayResult = await browser.waitForOverlayState(
          input.payload.state,
          input.payload.timeoutMs,
          input.payload.tabId,
        );
        if (!overlayResult.success) throw new Error(overlayResult.error || `Overlay did not become ${input.payload.state}`);
        result = {
          summary: `Overlay is now ${input.payload.state}`,
          data: overlayResult,
        };
        break;
      }

      case 'browser.open-search-results-tabs': {
        const openTabsResult = await browser.openSearchResultsTabs(input.payload);
        if (!openTabsResult.success) throw new Error(openTabsResult.error || 'No search results were opened');
        result = {
          summary: `Opened ${openTabsResult.openedTabIds.length} search result tabs`,
          data: openTabsResult,
        };
        break;
      }

      case 'browser.get-dialogs': {
        const dialogs = browser.getPendingDialogs(input.payload.tabId);
        result = {
          summary: dialogs.length === 0
            ? 'No pending JavaScript dialogs'
            : `Found ${dialogs.length} pending JavaScript dialog${dialogs.length === 1 ? '' : 's'}`,
          data: { dialogs },
        };
        break;
      }

      case 'browser.accept-dialog': {
        const acceptResult = await browser.acceptDialog({
          tabId: input.payload.tabId,
          dialogId: input.payload.dialogId,
          promptText: input.payload.promptText,
        });
        if (!acceptResult.accepted) {
          throw new Error(acceptResult.error || 'Accept dialog failed');
        }
        result = {
          summary: acceptResult.dialog?.message
            ? `Accepted JavaScript dialog: ${acceptResult.dialog.message}`
            : 'Accepted JavaScript dialog',
          data: { result: acceptResult },
        };
        break;
      }

      case 'browser.dismiss-dialog': {
        const dismissDialogResult = await browser.dismissDialog({
          tabId: input.payload.tabId,
          dialogId: input.payload.dialogId,
        });
        if (!dismissDialogResult.dismissed) {
          throw new Error(dismissDialogResult.error || 'Dismiss dialog failed');
        }
        result = {
          summary: dismissDialogResult.dialog?.message
            ? `Dismissed JavaScript dialog: ${dismissDialogResult.dialog.message}`
            : 'Dismissed JavaScript dialog',
          data: { result: dismissDialogResult },
        };
        break;
      }

      case 'browser.get-actionable-elements': {
        const elements = await browser.getActionableElements(input.payload.tabId);
        result = {
          summary: `Found ${elements.length} actionable elements`,
          data: { elements },
        };
        break;
      }

      case 'browser.capture-snapshot': {
        const snapshot = await browser.captureTabSnapshot(input.payload.tabId);
        result = {
          summary: `Captured snapshot ${snapshot.id}`,
          data: { snapshot },
        };
        break;
      }

      default:
        throw new Error(`Unknown browser operation kind: ${String((input as { kind: string }).kind)}`);
    }

    const networkCapture = browser.completeOperationNetworkScope(ledgerEntry.operationId);
    browserOperationLedger.complete(ledgerEntry.operationId, result, networkCapture || undefined);
    return result;
  } catch (error) {
    const networkCapture = browser.completeOperationNetworkScope(ledgerEntry.operationId);
    browserOperationLedger.fail(ledgerEntry.operationId, error, networkCapture || undefined);
    throw error;
  }
}
