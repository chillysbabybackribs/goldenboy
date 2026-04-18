import { BrowserWindow } from 'electron';
import { BrowserState, BrowserHistoryEntry, BrowserDownloadState, TabInfo, BookmarkEntry, ExtensionInfo, BrowserSettings, BrowserAuthDiagnostics, BrowserJavaScriptDialog } from '../../shared/types/browser';
import { BrowserActionableElement, BrowserConsoleEvent, BrowserSurfaceEvalFixture, BrowserFinding, BrowserFormModel, BrowserNetworkEvent, BrowserSiteStrategy, BrowserSnapshot, BrowserTaskMemory } from '../../shared/types/browserIntelligence';
import type { BrowserPointerHitTestResult } from './BrowserPageInteraction';
import type { SearchResultCandidate, PageEvidence } from './BrowserPageAnalysis';
import type { DiskCache } from '../context/diskCache';
import type { BrowserNetworkInterceptionPolicy, BrowserOperationNetworkCapture, BrowserOperationNetworkScope } from './browserNetworkSupport';
export declare class BrowserService {
    private readonly contextId;
    private tabs;
    private activeTabId;
    private splitLeftTabId;
    private splitRightTabId;
    private hostWindow;
    private profile;
    private history;
    private bookmarks;
    private recentPermissions;
    private extensions;
    private findState;
    private settings;
    private lastError;
    private createdAt;
    private disposed;
    private historyPersistTimer;
    private currentBounds;
    private attachedTabIds;
    private appliedBoundsByTabId;
    private sessionInstance;
    private lastGoogleCookieMismatchAt;
    private oauthRelayTimer;
    private instrumentation;
    private downloadManager;
    private dialogManager;
    private perception;
    private siteStrategies;
    private pageInteraction;
    private pageAnalysis;
    private overlayManager;
    private pageExtractor;
    private diskCache;
    private activeTaskId;
    private stateSyncTimer;
    constructor(contextId?: string);
    setDiskCache(diskCache: DiskCache, taskId: string): void;
    clearDiskCache(): void;
    private extractToDisk;
    private cachePageKnowledge;
    createSurface(hostWindow: BrowserWindow): void;
    reimportChromeCookies(): Promise<{
        imported: number;
        failed: number;
        domains: string[];
    }>;
    private handleChromeSessionImport;
    private initSession;
    createTab(url?: string, insertAfterTabId?: string): TabInfo;
    private createTabInternal;
    private createBrowserTabView;
    private registerTab;
    closeTab(tabId: string): void;
    activateTab(tabId: string): void;
    private activateTabInternal;
    getTabs(): TabInfo[];
    splitTab(tabId?: string): TabInfo;
    clearSplitView(): void;
    private placeTabAfter;
    private normalizeSplitState;
    private destroyTabEntry;
    private releaseTabEntry;
    private pruneDestroyedTabEntries;
    private handleUnexpectedTabDestroy;
    private applyTabLayout;
    private getActiveEntry;
    private wireTabEvents;
    private resolveTabIdByWebContentsId;
    isKnownTabWebContents(webContentsId: number): boolean;
    private syncTabAndMaybeNavigation;
    private handleGoogleAuthNavigation;
    private clearGoogleAuthCookies;
    /**
     * Returns true if the URL is a Google sign-in / OAuth page that should be
     * opened in the system browser instead of the embedded one.
     */
    private isGoogleOAuthUrl;
    /**
     * Intercepts a Google OAuth navigation, opens it in the system browser,
     * and polls for the resulting cookies to appear in Chrome's cookie store.
     * Once detected, imports them into the Electron session so the embedded
     * browser ends up authenticated.
     */
    private openGoogleSignInExternally;
    private stopOAuthRelay;
    navigate(url: string): void;
    private navigateTab;
    private createTabIfSafe;
    goBack(): void;
    goForward(): void;
    reload(): void;
    stop(): void;
    zoomIn(): void;
    zoomOut(): void;
    zoomReset(): void;
    findInPage(query: string): void;
    findNext(): void;
    findPrevious(): void;
    stopFind(): void;
    private broadcastFind;
    toggleDevTools(): void;
    private openPageSource;
    private renderSourceDocument;
    private escapeHtml;
    addBookmark(url: string, title: string): BookmarkEntry;
    removeBookmark(bookmarkId: string): void;
    getBookmarks(): BookmarkEntry[];
    private addHistoryEntry;
    getHistory(): BrowserHistoryEntry[];
    getRecentHistory(count?: number): BrowserHistoryEntry[];
    clearHistory(): void;
    clearData(): Promise<void>;
    clearSiteData(origin?: string): Promise<{
        origin: string;
        cookiesCleared: number;
    }>;
    private resolveOriginForSiteData;
    private scheduleHistoryPersist;
    private persistNow;
    getSettings(): BrowserSettings;
    updateSettings(partial: Partial<BrowserSettings>): void;
    getAuthDiagnostics(): Promise<BrowserAuthDiagnostics>;
    clearGoogleAuthState(): Promise<{
        cleared: number;
    }>;
    loadExtension(extPath: string): Promise<ExtensionInfo | null>;
    removeExtension(extensionId: string): Promise<void>;
    getExtensions(): ExtensionInfo[];
    downloadUrl(url: string, tabId?: string): Promise<{
        started: boolean;
        error: string | null;
        url: string;
        tabId?: string;
        download?: BrowserDownloadState;
        method?: string;
    }>;
    downloadLink(selector: string, tabId?: string): Promise<{
        started: boolean;
        error: string | null;
        selector: string;
        href?: string;
        tabId?: string;
        download?: BrowserDownloadState;
        method?: string;
    }>;
    getDownloads(): BrowserDownloadState[];
    waitForDownload(input?: {
        downloadId?: string;
        filename?: string;
        tabId?: string;
        timeoutMs?: number;
    }): Promise<{
        found: boolean;
        completed: boolean;
        timedOut: boolean;
        download: BrowserDownloadState | null;
    }>;
    cancelDownload(downloadId: string): void;
    clearDownloads(): void;
    setBounds(bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    }): void;
    getState(): BrowserState;
    private syncState;
    private syncNavigation;
    isCreated(): boolean;
    getPageText(maxLength?: number): Promise<string>;
    executeInPage(expression: string, tabId?: string): Promise<{
        result: unknown;
        error: string | null;
    }>;
    querySelectorAll(selector: string, tabId?: string, limit?: number): Promise<Array<{
        tag: string;
        text: string;
        href: string | null;
        id: string;
        classes: string[];
    }>>;
    clickElement(selector: string, tabId?: string): Promise<{
        clicked: boolean;
        error: string | null;
        method?: string;
        x?: number;
        y?: number;
        globalX?: number;
        globalY?: number;
        hitTest?: BrowserPointerHitTestResult;
    }>;
    hitTestElement(selector: string, tabId?: string): Promise<BrowserPointerHitTestResult>;
    hoverElement(selector: string, tabId?: string): Promise<{
        hovered: boolean;
        error: string | null;
        method?: string;
        selector?: string;
        x?: number;
        y?: number;
        globalX?: number;
        globalY?: number;
        hitTest?: BrowserPointerHitTestResult;
    }>;
    getPendingDialogs(tabId?: string): BrowserJavaScriptDialog[];
    openPromptDialogFallback(input: {
        webContentsId: number;
        message: string;
        defaultPrompt?: string;
        url?: string;
    }): {
        dialogId: string;
        created: boolean;
    };
    pollPromptDialogFallback(dialogId: string): {
        done: boolean;
        value: string | null;
    };
    acceptDialog(input?: {
        tabId?: string;
        dialogId?: string;
        promptText?: string;
    }): Promise<{
        accepted: boolean;
        error: string | null;
        dialog: BrowserJavaScriptDialog | null;
    }>;
    dismissDialog(input?: {
        tabId?: string;
        dialogId?: string;
    }): Promise<{
        dismissed: boolean;
        error: string | null;
        dialog: BrowserJavaScriptDialog | null;
    }>;
    typeInElement(selector: string, text: string, tabId?: string): Promise<{
        typed: boolean;
        error: string | null;
    }>;
    uploadFileToElement(selector: string, filePath: string, tabId?: string): Promise<{
        uploaded: boolean;
        error: string | null;
        method?: string;
        selector?: string;
        filePath?: string;
        fileName?: string;
    }>;
    dragElement(sourceSelector: string, targetSelector: string, tabId?: string): Promise<{
        dragged: boolean;
        error: string | null;
        sourceSelector?: string;
        targetSelector?: string;
        method?: string;
        from?: {
            x: number;
            y: number;
        };
        to?: {
            x: number;
            y: number;
        };
    }>;
    getPageMetadata(tabId?: string): Promise<Record<string, unknown>>;
    extractSearchResults(tabId?: string, limit?: number): Promise<SearchResultCandidate[]>;
    openSearchResultsTabs(input: {
        tabId?: string;
        indices?: number[];
        limit?: number;
        activateFirst?: boolean;
    }): Promise<{
        success: boolean;
        openedTabIds: string[];
        urls: string[];
        sourceResults: SearchResultCandidate[];
        error: string | null;
    }>;
    summarizeTabWorkingSet(tabIds?: string[]): Promise<Array<Record<string, unknown>>>;
    extractPageEvidence(tabId?: string): Promise<PageEvidence | null>;
    compareTabs(tabIds?: string[]): Promise<Record<string, unknown>>;
    synthesizeResearchBrief(input?: {
        tabIds?: string[];
        question?: string;
    }): Promise<Record<string, unknown>>;
    captureTabSnapshot(tabId?: string): Promise<BrowserSnapshot>;
    getActionableElements(tabId?: string): Promise<BrowserActionableElement[]>;
    getFormModel(tabId?: string): Promise<BrowserFormModel[]>;
    private getSiteStrategyForUrl;
    getSiteStrategy(origin: string): BrowserSiteStrategy | null;
    saveSiteStrategy(input: Partial<BrowserSiteStrategy> & {
        origin: string;
    }): BrowserSiteStrategy;
    exportSurfaceEvalFixture(input: {
        name: string;
        tabId?: string;
    }): Promise<BrowserSurfaceEvalFixture>;
    private resolveEntry;
    private rankActionableElements;
    clickRankedAction(input: {
        tabId?: string;
        index?: number;
        actionId?: string;
        preferDismiss?: boolean;
    }): Promise<{
        success: boolean;
        clickedAction: (BrowserActionableElement & {
            rankScore?: number;
            rankReason?: string;
        }) | null;
        error: string | null;
    }>;
    waitForOverlayState(state: 'open' | 'closed', timeoutMs?: number, tabId?: string): Promise<{
        success: boolean;
        state: 'open' | 'closed';
        observed: boolean;
        foregroundUiType: BrowserSnapshot['viewport']['foregroundUiType'];
        foregroundUiLabel: string;
        error: string | null;
    }>;
    dismissForegroundUI(tabId?: string): Promise<{
        success: boolean;
        method: string | null;
        target: string | null;
        targetSelector: string | null;
        beforeModalPresent: boolean;
        afterModalPresent: boolean;
        beforeForegroundUiType: BrowserSnapshot['viewport']['foregroundUiType'];
        beforeForegroundUiLabel: string;
        afterForegroundUiType: BrowserSnapshot['viewport']['foregroundUiType'];
        afterForegroundUiLabel: string;
        error: string | null;
    }>;
    returnToPrimarySurface(tabId?: string): Promise<{
        success: boolean;
        restored: boolean;
        steps: string[];
        error: string | null;
    }>;
    getConsoleEvents(tabId?: string, since?: number): BrowserConsoleEvent[];
    getNetworkEvents(tabId?: string, since?: number): BrowserNetworkEvent[];
    beginOperationNetworkScope(scope: BrowserOperationNetworkScope): void;
    completeOperationNetworkScope(operationId: string): BrowserOperationNetworkCapture | null;
    registerNetworkInterceptionPolicy(policy: BrowserNetworkInterceptionPolicy): void;
    recordTabFinding(input: {
        taskId: string;
        tabId?: string;
        title: string;
        summary: string;
        severity?: BrowserFinding['severity'];
        evidence?: string[];
        snapshotId?: string | null;
    }): Promise<BrowserFinding>;
    getTaskBrowserMemory(taskId: string): BrowserTaskMemory;
    dispose(): void;
    private emitLog;
}
export declare const browserService: BrowserService;
