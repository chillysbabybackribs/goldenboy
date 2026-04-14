import type { BrowserService } from './BrowserService';
import type {
  BrowserNetworkInterceptionPolicy,
  BrowserOperationNetworkCapture,
  BrowserOperationNetworkScope,
} from './browserNetworkSupport';

export const DEFAULT_BROWSER_CONTEXT_ID = 'default';

export type BrowserContextService = Pick<
  BrowserService,
  | 'acceptDialog'
  | 'activateTab'
  | 'captureTabSnapshot'
  | 'completeOperationNetworkScope'
  | 'clearSplitView'
  | 'clickElement'
  | 'clickRankedAction'
  | 'closeTab'
  | 'createTab'
  | 'dismissDialog'
  | 'dismissForegroundUI'
  | 'downloadLink'
  | 'downloadUrl'
  | 'dragElement'
  | 'getActionableElements'
  | 'getDownloads'
  | 'getFormModel'
  | 'getNetworkEvents'
  | 'getPageMetadata'
  | 'getPageText'
  | 'getPendingDialogs'
  | 'getState'
  | 'getTabs'
  | 'goBack'
  | 'goForward'
  | 'hitTestElement'
  | 'hoverElement'
  | 'isCreated'
  | 'beginOperationNetworkScope'
  | 'navigate'
  | 'openSearchResultsTabs'
  | 'registerNetworkInterceptionPolicy'
  | 'reload'
  | 'returnToPrimarySurface'
  | 'splitTab'
  | 'stop'
  | 'typeInElement'
  | 'uploadFileToElement'
  | 'waitForDownload'
  | 'waitForOverlayState'
>;

export type BrowserContext = {
  id: string;
  label: string;
  isDefault: boolean;
  service: BrowserContextService;
};

export type {
  BrowserNetworkInterceptionPolicy,
  BrowserOperationNetworkCapture,
  BrowserOperationNetworkScope,
};

export type BrowserContextSummary = Pick<BrowserContext, 'id' | 'label' | 'isDefault'>;
