// ═══════════════════════════════════════════════════════════════════════════
// Browser Runtime Types — Full browser subsystem with tabs, bookmarks,
// extensions, settings, zoom, find-in-page, downloads, permissions
// ═══════════════════════════════════════════════════════════════════════════

export type BrowserSurfaceStatus = 'idle' | 'loading' | 'ready' | 'error';

export type BrowserNavigationState = {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  loadingProgress: number | null;
  favicon: string;
  lastNavigationAt: number | null;
};

export type BrowserProfile = {
  id: string;
  partition: string;
  persistent: boolean;
  userAgent: string | null;
};

// ─── Tabs ───────────────────────────────────────────────────────────────────

export type TabInfo = {
  id: string;
  navigation: BrowserNavigationState;
  status: BrowserSurfaceStatus;
  zoomLevel: number;
  muted: boolean;
  isAudible: boolean;
  createdAt: number;
};

// ─── History ────────────────────────────────────────────────────────────────

export type BrowserHistoryEntry = {
  url: string;
  title: string;
  visitedAt: number;
  favicon: string;
};

// ─── Bookmarks ──────────────────────────────────────────────────────────────

export type BookmarkEntry = {
  id: string;
  url: string;
  title: string;
  favicon: string;
  createdAt: number;
};

// ─── Downloads ──────────────────────────────────────────────────────────────

export type BrowserDownloadStatus = 'progressing' | 'completed' | 'cancelled' | 'interrupted';

export type BrowserDownloadState = {
  id: string;
  filename: string;
  url: string;
  savePath: string;
  state: BrowserDownloadStatus;
  receivedBytes: number;
  totalBytes: number;
  startedAt: number;
};

// ─── Permissions ────────────────────────────────────────────────────────────

export type BrowserPermissionType =
  | 'media'
  | 'geolocation'
  | 'notifications'
  | 'midi'
  | 'pointerLock'
  | 'fullscreen'
  | 'openExternal'
  | 'clipboard-read'
  | 'clipboard-sanitized-write'
  | 'window-management'
  | 'unknown';

export type BrowserPermissionDecision = 'granted' | 'denied';

export type BrowserPermissionRequest = {
  id: string;
  permission: BrowserPermissionType;
  origin: string;
  decision: BrowserPermissionDecision | null;
  requestedAt: number;
  resolvedAt: number | null;
};

// ─── Extensions ─────────────────────────────────────────────────────────────

export type ExtensionInfo = {
  id: string;
  name: string;
  version: string;
  path: string;
  enabled: boolean;
};

// ─── Find In Page ───────────────────────────────────────────────────────────

export type FindInPageState = {
  active: boolean;
  query: string;
  activeMatch: number;
  totalMatches: number;
};

// ─── Settings ───────────────────────────────────────────────────────────────

export type BrowserSettings = {
  homepage: string;
  searchEngine: 'google' | 'duckduckgo' | 'bing';
  defaultZoom: number;
  javascript: boolean;
  images: boolean;
  popups: boolean;
  importChromeCookies: boolean | null; // null = never asked, true = opted in, false = opted out
};

export type BrowserAuthDiagnostics = {
  totalCookies: number;
  googleCookieCount: number;
  importChromeCookies: boolean | null;
  googleAuthCompatibilityActive: boolean;
  lastGoogleCookieMismatchAt: number | null;
  activeTabUserAgent: string;
  activeTabHasElectronUA: boolean;
};

// ─── Errors ─────────────────────────────────────────────────────────────────

export type BrowserErrorInfo = {
  code: number;
  description: string;
  url: string;
  timestamp: number;
};

// ─── Composite State ────────────────────────────────────────────────────────

export type BrowserState = {
  surfaceStatus: BrowserSurfaceStatus;
  navigation: BrowserNavigationState;
  profile: BrowserProfile;
  tabs: TabInfo[];
  activeTabId: string;
  history: BrowserHistoryEntry[];
  bookmarks: BookmarkEntry[];
  activeDownloads: BrowserDownloadState[];
  completedDownloads: BrowserDownloadState[];
  recentPermissions: BrowserPermissionRequest[];
  extensions: ExtensionInfo[];
  findInPage: FindInPageState;
  settings: BrowserSettings;
  lastError: BrowserErrorInfo | null;
  createdAt: number | null;
};

export function createDefaultSettings(): BrowserSettings {
  return {
    homepage: 'https://www.google.com',
    searchEngine: 'google',
    defaultZoom: 1.0,
    javascript: true,
    images: true,
    popups: false,
    importChromeCookies: null,
  };
}

export function createDefaultBrowserState(): BrowserState {
  return {
    surfaceStatus: 'idle',
    navigation: {
      url: '',
      title: '',
      canGoBack: false,
      canGoForward: false,
      isLoading: false,
      loadingProgress: null,
      favicon: '',
      lastNavigationAt: null,
    },
    profile: {
      id: 'workspace-browser',
      partition: 'persist:workspace-browser',
      persistent: true,
      userAgent: null,
    },
    tabs: [],
    activeTabId: '',
    history: [],
    bookmarks: [],
    activeDownloads: [],
    completedDownloads: [],
    recentPermissions: [],
    extensions: [],
    findInPage: { active: false, query: '', activeMatch: 0, totalMatches: 0 },
    settings: createDefaultSettings(),
    lastError: null,
    createdAt: null,
  };
}
