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
import {
  buildTargetDescriptor,
  isReplaySupportedOperation,
  validateOperationOutcome,
} from './browserDeterministicExecution';
import {
  requireBrowserRuntime,
  resolveOperationTabId,
} from './browserOperations.utils';
import { executeNavigationOperations } from './browserOperations.navigation';
import {
  decideBrowserExecution,
  finalizeBrowserExecutionDecision,
} from './browserExecutionPolicy';
import { getBrowserOperationContext } from './browserOperationContext';
import { browserContextManager } from './browserContextManager';
import { browserOperationLedger } from './browserOperationLedger';
import type { BrowserOperationExecutionMeta } from './browserOperationReplayStore';
import { browserOperationReplayStore } from './browserOperationReplayStore';

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
    meta?: BrowserOperationExecutionMeta;
  };
}[BrowserOperationKind];

export type BrowserOperationResult = {
  summary: string;
  data: Record<string, unknown>;
};

export function executeBrowserOperation<K extends BrowserOperationKind>(
  input: {
    kind: K;
    payload: BrowserOperationPayloadMap[K];
    context?: BrowserOperationExecutionContext & BrowserOperationContextId;
    meta?: BrowserOperationExecutionMeta;
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
  const deterministicInput = isReplaySupportedOperation(input.kind)
    ? {
      kind: input.kind,
      payload: input.payload as any,
      contextId: browserContext.id,
      tabId: resolveOperationTabId(browserState, input.payload as Record<string, unknown>, operationContext),
    }
    : null;
  const builtTarget = input.meta?.targetDescriptor
    ? {
      descriptor: input.meta.targetDescriptor,
      preflightValidation: input.meta.preflightValidation || null,
      resolvedSelector: input.meta.targetDescriptor.evidence.selector,
    }
    : deterministicInput
      ? await buildTargetDescriptor(browser, deterministicInput)
      : { descriptor: null, preflightValidation: null, resolvedSelector: null };
  const decision = decideBrowserExecution({
    kind: input.kind,
    replayOfOperationId: input.meta?.replayOfOperationId ?? null,
    strictness: input.meta?.strictness,
    preflightValidation: builtTarget.preflightValidation,
    supportsDeterministicExecution: Boolean(deterministicInput),
  });
  const ledgerEntry = browserOperationLedger.start({
    kind: input.kind,
    payload: input.payload as Record<string, unknown>,
    contextId: browserContext.id,
    context: operationContext,
    state: browserState,
    targetDescriptor: builtTarget.descriptor,
    replayOfOperationId: input.meta?.replayOfOperationId ?? null,
    decision,
  });
  let startedNetworkScope = false;

  try {
    if (decision.selectedMode === 'abort') {
      throw new Error(decision.reasonSummary);
    }

    browser.beginOperationNetworkScope({
      operationId: ledgerEntry.operationId,
      contextId: browserContext.id,
      kind: input.kind,
      tabId: resolveOperationTabId(browserState, input.payload as Record<string, unknown>, operationContext),
    });
    startedNetworkScope = true;

    let result: BrowserOperationResult;

    switch (input.kind) {
      case 'browser.navigate':
      case 'browser.search-web':
      case 'browser.back':
      case 'browser.forward':
      case 'browser.reload':
      case 'browser.stop':
      case 'browser.create-tab':
      case 'browser.close-tab':
      case 'browser.activate-tab':
      case 'browser.split-tab':
      case 'browser.clear-split-view':
        result = await executeNavigationOperations(browser, {
          kind: input.kind,
          payload: input.payload as Record<string, unknown>,
        });
        break;

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

    const shouldRunDeterministicValidation = (
      decision.selectedMode === 'deterministic_execute' || decision.selectedMode === 'deterministic_replay'
    ) && input.meta?.validationMode !== 'none';
    const validation = deterministicInput && builtTarget.descriptor && shouldRunDeterministicValidation
      ? await validateOperationOutcome(
        browser,
        deterministicInput,
        builtTarget.descriptor,
        result,
        builtTarget.preflightValidation,
      )
      : builtTarget.preflightValidation;
    const networkCapture = browser.completeOperationNetworkScope(ledgerEntry.operationId);
    browserOperationLedger.complete(
      ledgerEntry.operationId,
      result,
      networkCapture || undefined,
      validation || undefined,
      finalizeBrowserExecutionDecision(decision, {
        finalStatus: 'completed',
        preflightValidation: builtTarget.preflightValidation,
      }),
    );
    if (isReplaySupportedOperation(input.kind) && builtTarget.descriptor) {
      browserOperationReplayStore.save(ledgerEntry.operationId, {
        kind: input.kind,
        payload: input.payload as any,
        context: {
          ...operationContext,
          contextId: browserContext.id,
        },
      }, builtTarget.descriptor);
    }
    return result;
  } catch (error) {
    const networkCapture = startedNetworkScope
      ? browser.completeOperationNetworkScope(ledgerEntry.operationId)
      : null;
    browserOperationLedger.fail(
      ledgerEntry.operationId,
      error,
      networkCapture || undefined,
      builtTarget.preflightValidation || undefined,
      finalizeBrowserExecutionDecision(decision, {
        finalStatus: decision.selectedMode === 'abort' ? 'aborted' : 'failed',
        preflightValidation: builtTarget.preflightValidation,
      }),
    );
    throw error;
  }
}
