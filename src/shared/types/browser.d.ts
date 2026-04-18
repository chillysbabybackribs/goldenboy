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
export type TabInfo = {
    id: string;
    navigation: BrowserNavigationState;
    status: BrowserSurfaceStatus;
    zoomLevel: number;
    muted: boolean;
    isAudible: boolean;
    createdAt: number;
};
export type BrowserHistoryEntry = {
    url: string;
    title: string;
    visitedAt: number;
    favicon: string;
};
export type BookmarkEntry = {
    id: string;
    url: string;
    title: string;
    favicon: string;
    createdAt: number;
};
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
    completedAt?: number | null;
    sourceTabId?: string | null;
    sourcePageUrl?: string | null;
    existsOnDisk?: boolean;
    fileSize?: number | null;
    error?: string | null;
};
export type BrowserPermissionType = 'media' | 'geolocation' | 'notifications' | 'midi' | 'pointerLock' | 'fullscreen' | 'openExternal' | 'clipboard-read' | 'clipboard-sanitized-write' | 'window-management' | 'unknown';
export type BrowserPermissionDecision = 'granted' | 'denied';
export type BrowserPermissionRequest = {
    id: string;
    permission: BrowserPermissionType;
    origin: string;
    decision: BrowserPermissionDecision | null;
    requestedAt: number;
    resolvedAt: number | null;
};
export type ExtensionInfo = {
    id: string;
    name: string;
    version: string;
    path: string;
    enabled: boolean;
};
export type FindInPageState = {
    active: boolean;
    query: string;
    activeMatch: number;
    totalMatches: number;
};
export type BrowserSettings = {
    homepage: string;
    searchEngine: 'google' | 'duckduckgo' | 'bing';
    defaultZoom: number;
    javascript: boolean;
    images: boolean;
    popups: boolean;
    importChromeCookies: boolean | null;
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
export type BrowserJavaScriptDialogType = 'alert' | 'confirm' | 'prompt' | 'beforeunload' | 'unknown';
export type BrowserJavaScriptDialog = {
    id: string;
    tabId: string;
    url: string;
    type: BrowserJavaScriptDialogType;
    backend?: 'cdp' | 'shim';
    message: string;
    defaultPrompt: string;
    openedAt: number;
};
export type BrowserErrorInfo = {
    code: number;
    description: string;
    url: string;
    timestamp: number;
};
export type BrowserState = {
    surfaceStatus: BrowserSurfaceStatus;
    navigation: BrowserNavigationState;
    profile: BrowserProfile;
    tabs: TabInfo[];
    activeTabId: string;
    splitLeftTabId: string | null;
    splitRightTabId: string | null;
    history: BrowserHistoryEntry[];
    bookmarks: BookmarkEntry[];
    activeDownloads: BrowserDownloadState[];
    completedDownloads: BrowserDownloadState[];
    recentPermissions: BrowserPermissionRequest[];
    pendingDialogs: BrowserJavaScriptDialog[];
    extensions: ExtensionInfo[];
    findInPage: FindInPageState;
    settings: BrowserSettings;
    lastError: BrowserErrorInfo | null;
    createdAt: number | null;
};
export declare function createDefaultSettings(): BrowserSettings;
export declare function createDefaultBrowserState(): BrowserState;
