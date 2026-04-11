// ═══════════════════════════════════════════════════════════════════════════
// Browser Intelligence Types — Semantic page perception, instrumentation,
// branching scaffolding, and task-bound browser memory
// ═══════════════════════════════════════════════════════════════════════════

export type BrowserPrimitiveRef = {
  tabId: string;
  frameId: string | null;
  selector: string;
};

export type BrowserActionability =
  | 'clickable'
  | 'typeable'
  | 'selectable'
  | 'navigational'
  | 'dismissible'
  | 'unknown';

export type BrowserActionableElement = {
  id: string;
  ref: BrowserPrimitiveRef;
  role: string;
  tagName: string;
  text: string;
  ariaLabel: string;
  href: string | null;
  boundingBox: { x: number; y: number; width: number; height: number } | null;
  actionability: BrowserActionability[];
  visible: boolean;
  enabled: boolean;
  confidence: number;
};

export type BrowserFormFieldKind =
  | 'text'
  | 'email'
  | 'password'
  | 'search'
  | 'tel'
  | 'url'
  | 'number'
  | 'checkbox'
  | 'radio'
  | 'select'
  | 'textarea'
  | 'hidden'
  | 'unknown';

export type BrowserFormFieldModel = {
  id: string;
  ref: BrowserPrimitiveRef;
  kind: BrowserFormFieldKind;
  label: string;
  name: string;
  placeholder: string;
  required: boolean;
  visible: boolean;
  valuePreview: string;
};

export type BrowserFormModel = {
  id: string;
  formRef: BrowserPrimitiveRef | null;
  purpose: string;
  method: string;
  action: string;
  fields: BrowserFormFieldModel[];
  submitLabels: string[];
};

export type BrowserFrameNode = {
  id: string;
  name: string;
  url: string;
  parentId: string | null;
};

export type BrowserViewportModel = {
  url: string;
  title: string;
  mainHeading: string;
  visibleTextExcerpt: string;
  modalPresent: boolean;
  foregroundUiType: 'none' | 'dropdown' | 'drawer' | 'dialog' | 'popover' | 'overlay' | 'panel';
  foregroundUiLabel: string;
  foregroundUiSelector: string;
  foregroundUiConfidence: number;
  activeSurfaceType: 'feed' | 'panel' | 'section' | 'modal' | 'drawer' | 'form' | 'unknown';
  activeSurfaceLabel: string;
  activeSurfaceSelector: string;
  activeSurfaceConfidence: number;
  isPrimarySurface: boolean;
  actionableCount: number;
};

export type BrowserSiteStrategy = {
  origin: string;
  createdAt: number;
  updatedAt: number;
  primaryRoutes: string[];
  primaryLabels: string[];
  panelKeywords: string[];
  notes: string[];
};

export type BrowserSurfaceEvalFixture = {
  name: string;
  evidence: {
    url: string;
    pathname: string;
    title: string;
    mainHeading: string;
    visibleTextExcerpt: string;
    expandedTriggerLabels: string[];
    panelCandidates: Array<{
      selector: string;
      label: string;
      area: number;
      position: 'fixed' | 'absolute' | 'sticky' | 'flow';
      fromExpandedTrigger: boolean;
    }>;
    hasFeedMarkers: boolean;
    hasMessagesMarkers: boolean;
    hasNotificationsMarkers: boolean;
    hasActivityMarkers: boolean;
    hasVisibleForm: boolean;
    strategy?: {
      primaryRoutes?: string[];
      primaryLabels?: string[];
      panelKeywords?: string[];
    };
  };
  resolved: {
    foregroundUiType: BrowserViewportModel['foregroundUiType'];
    foregroundUiLabel: string;
    foregroundUiConfidence: number;
    activeSurfaceType: BrowserViewportModel['activeSurfaceType'];
    activeSurfaceLabel: string;
    activeSurfaceConfidence: number;
    isPrimarySurface: boolean;
  };
};

export type BrowserSnapshot = {
  id: string;
  tabId: string;
  capturedAt: number;
  url: string;
  title: string;
  mainHeading: string;
  visibleTextExcerpt: string;
  actionableElements: BrowserActionableElement[];
  forms: BrowserFormModel[];
  viewport: BrowserViewportModel;
};

export type BrowserConsoleLevel = 'log' | 'warn' | 'error' | 'info' | 'debug';

export type BrowserConsoleEvent = {
  id: string;
  tabId: string;
  level: BrowserConsoleLevel;
  message: string;
  sourceId: string;
  lineNumber: number;
  timestamp: number;
};

export type BrowserNetworkEvent = {
  id: string;
  tabId: string;
  method: string;
  url: string;
  resourceType: string;
  statusCode: number | null;
  status: 'completed' | 'failed';
  timestamp: number;
  error?: string;
};

export type BrowserBranchId = string;

export type BrowserFindingSeverity = 'info' | 'warning' | 'critical';

export type BrowserFinding = {
  id: string;
  taskId: string;
  tabId: string;
  snapshotId: string | null;
  title: string;
  summary: string;
  severity: BrowserFindingSeverity;
  evidence: string[];
  createdAt: number;
};

export type BrowserTaskMemory = {
  taskId: string;
  lastUpdatedAt: number | null;
  findings: BrowserFinding[];
  tabsTouched: string[];
  snapshotIds: string[];
};

export function createEmptyBrowserTaskMemory(taskId: string): BrowserTaskMemory {
  return {
    taskId,
    lastUpdatedAt: null,
    findings: [],
    tabsTouched: [],
    snapshotIds: [],
  };
}
