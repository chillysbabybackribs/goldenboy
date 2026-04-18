import { BrowserActivateTabPayload, BrowserClickPayload, BrowserClickRankedActionPayload, BrowserCloseTabPayload, BrowserCreateTabPayload, BrowserOpenSearchResultsTabsPayload, BrowserSemanticTargetPayload, BrowserSplitTabPayload, BrowserTypePayload, BrowserWaitForOverlayPayload } from '../../shared/actions/surfaceActionTypes';
import type { BrowserOperationContextId, BrowserOperationExecutionContext, BrowserOperationKind } from '../../shared/types/browserOperationLedger';
import type { BrowserOperationExecutionMeta } from './browserOperationReplayStore';
export type { BrowserOperationKind } from '../../shared/types/browserOperationLedger';
type BrowserUploadFilePayload = {
    selector: string;
    filePath: string;
    tabId?: string;
};
type BrowserDownloadLinkPayload = {
    selector: string;
    tabId?: string;
};
type BrowserDownloadUrlPayload = {
    url: string;
    tabId?: string;
};
type BrowserGetDownloadsPayload = {
    state?: string;
    filename?: string;
    tabId?: string;
};
type BrowserWaitForDownloadPayload = {
    downloadId?: string;
    filename?: string;
    tabId?: string;
    timeoutMs?: number;
};
type BrowserDragPayload = {
    sourceSelector: string;
    targetSelector: string;
    tabId?: string;
};
type BrowserHoverPayload = {
    selector: string;
    tabId?: string;
};
type BrowserHitTestPayload = {
    selector: string;
    tabId?: string;
};
type BrowserInspectPagePayload = {
    tabId?: string;
    textLimit?: number;
    elementLimit?: number;
};
type BrowserDialogsPayload = {
    tabId?: string;
    dialogId?: string;
    promptText?: string;
};
type BrowserActionableElementsPayload = {
    tabId?: string;
};
type BrowserSnapshotPayload = {
    tabId?: string;
};
export type BrowserOperationPayloadMap = {
    'browser.navigate': {
        url: string;
    };
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
    'browser.search-web': {
        query: string;
    };
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
export declare function executeBrowserOperation<K extends BrowserOperationKind>(input: {
    kind: K;
    payload: BrowserOperationPayloadMap[K];
    context?: BrowserOperationExecutionContext & BrowserOperationContextId;
    meta?: BrowserOperationExecutionMeta;
}): Promise<BrowserOperationResult>;
