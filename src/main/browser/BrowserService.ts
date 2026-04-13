// ═══════════════════════════════════════════════════════════════════════════
// Browser Service — Multi-tab browser runtime with full feature set
// ═══════════════════════════════════════════════════════════════════════════
//
// Manages multiple tabs (each a WebContentsView), bookmarks, extensions,
// settings, zoom, find-in-page, downloads, and permissions.

import { BrowserWindow, WebContentsView, session, shell, Event as ElectronEvent, Menu, MenuItem, clipboard, WebContents } from 'electron';
import * as path from 'path';
import {
  BrowserState, BrowserNavigationState, BrowserSurfaceStatus,
  BrowserHistoryEntry, BrowserDownloadState, BrowserPermissionRequest,
  BrowserErrorInfo, BrowserProfile, TabInfo, BookmarkEntry, ExtensionInfo,
  FindInPageState, BrowserSettings, BrowserAuthDiagnostics,
  BrowserJavaScriptDialog, createDefaultSettings,
} from '../../shared/types/browser';
import {
  BrowserActionableElement,
  BrowserConsoleEvent,
  BrowserSurfaceEvalFixture,
  BrowserFinding,
  BrowserFormModel,
  BrowserNetworkEvent,
  BrowserSiteStrategy,
  BrowserSnapshot,
  BrowserTaskMemory,
} from '../../shared/types/browserIntelligence';
import { appStateStore } from '../state/appStateStore';
import { ActionType } from '../state/actions';
import { eventBus } from '../events/eventBus';
import { AppEventType } from '../../shared/types/events';
import { generateId } from '../../shared/utils/ids';
import {
  loadBrowserHistory, loadLastUrls, loadActiveTabIndex, saveBrowserHistory,
  loadBookmarks, saveBookmarks, loadSettings, saveSettings, flushAll,
} from './browserSessionStore';
import { resolvePermission, classifyPermission } from './browserPermissions';
import { importChromeCookies, isChromeAvailable, promptCookieImport } from './chromeCookieImporter';
import { BrowserInstrumentation } from './BrowserInstrumentation';
import { BrowserDownloadManager } from './BrowserDownloadManager';
import { BrowserDialogManager } from './BrowserDialogManager';
import { BrowserPerception } from './BrowserPerception';
import { BrowserSiteStrategyStore } from './BrowserSiteStrategies';
import { appendSurfaceFixture } from './BrowserIntelligenceStore';
import { taskMemoryStore } from '../models/taskMemoryStore';
import { BrowserPageInteraction } from './BrowserPageInteraction';
import type { BrowserPointerHitTestResult } from './BrowserPageInteraction';
import { BrowserPageAnalysis } from './BrowserPageAnalysis';
import type { SearchResultCandidate, PageEvidence } from './BrowserPageAnalysis';
import { BrowserOverlayManager } from './BrowserOverlayManager';
import { PageExtractor } from '../context/pageExtractor';
import type { DiskCache } from '../context/diskCache';
import { pageKnowledgeStore } from '../browserKnowledge/PageKnowledgeStore';
import { normalizeNavigationTarget } from './navigationTarget';
import { APP_WORKSPACE_ROOT } from '../workspaceRoot';

const PROFILE_ID = 'workspace-browser';
const PARTITION = 'persist:workspace-browser';
const MAX_HISTORY = 2000;
const MAX_RECENT_PERMISSIONS = 50;
const HISTORY_PERSIST_DEBOUNCE = 2000;
const BROWSER_STATE_SYNC_DEBOUNCE = 48;
const ENABLE_BACKGROUND_PAGE_EXTRACTION = false;
const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 5.0;
const GOOGLE_AUTH_MISMATCH_PATH = '/CookieMismatch';
const GOOGLE_AUTH_START_URL = 'https://accounts.google.com/';
const GOOGLE_COOKIE_DOMAIN_SUFFIXES = [
  'google.com',
  'youtube.com',
  'googleusercontent.com',
];

/** Paths on accounts.google.com that indicate an OAuth / sign-in flow. */
const GOOGLE_OAUTH_PATH_PATTERNS = [
  '/o/oauth2/',
  '/signin/oauth',
  '/AccountChooser',
  '/ServiceLogin',
  '/v3/signin/',
  '/signin/v2/',
];

/** How long to keep the local OAuth relay server alive (ms). */
const OAUTH_RELAY_TIMEOUT_MS = 5 * 60 * 1000;
const ALLOWED_POPUP_PROTOCOLS = new Set(['http:', 'https:']);
const ALLOWED_NAVIGATION_PROTOCOLS = new Set(['http:', 'https:', 'file:']);

function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return ALLOWED_POPUP_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

function isSafeNavigationUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed === 'about:blank') return false;
  try {
    const parsed = new URL(trimmed);
    return ALLOWED_NAVIGATION_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

function isSafeUrlForTabOpen(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  if (trimmed === 'about:blank') return true;
  return isSafeNavigationUrl(trimmed);
}

type TabEntry = {
  id: string;
  view: WebContentsView;
  info: TabInfo;
};

function getBrowserTabPreloadPath(): string {
  return path.join(__dirname, '..', '..', '..', 'preload', 'preload', 'browserTabPreload.js');
}

function sanitizeBrowserUserAgent(userAgent: string): string {
  return userAgent
    .replace(/\s*Electron\/[\d.]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isGoogleCookieDomain(domain: string): boolean {
  const normalized = domain.replace(/^\./, '').toLowerCase();
  return GOOGLE_COOKIE_DOMAIN_SUFFIXES.some(suffix => normalized === suffix || normalized.endsWith(`.${suffix}`));
}

export class BrowserService {
  private tabs: Map<string, TabEntry> = new Map();
  private activeTabId: string = '';
  private splitLeftTabId: string | null = null;
  private splitRightTabId: string | null = null;
  private hostWindow: BrowserWindow | null = null;
  private profile: BrowserProfile;
  private history: BrowserHistoryEntry[] = [];
  private bookmarks: BookmarkEntry[] = [];
  private recentPermissions: BrowserPermissionRequest[] = [];
  private extensions: ExtensionInfo[] = [];
  private findState: FindInPageState = { active: false, query: '', activeMatch: 0, totalMatches: 0 };
  private settings: BrowserSettings;
  private lastError: BrowserErrorInfo | null = null;
  private createdAt: number | null = null;
  private disposed = false;
  private historyPersistTimer: ReturnType<typeof setTimeout> | null = null;
  private currentBounds = { x: 0, y: 0, width: 0, height: 0 };
  private sessionInstance: Electron.Session | null = null;
  private lastGoogleCookieMismatchAt: number | null = null;
  private oauthRelayTimer: ReturnType<typeof setTimeout> | null = null;
  private instrumentation = new BrowserInstrumentation();
  private downloadManager = new BrowserDownloadManager({
    resolveTabIdByWebContentsId: (webContentsId) => this.resolveTabIdByWebContentsId(webContentsId),
    emitLog: (level, message) => this.emitLog(level, message),
    syncState: () => this.syncState(),
  });
  private dialogManager = new BrowserDialogManager({
    resolveEntry: (tabId) => this.resolveEntry(tabId),
    resolveTabIdByWebContentsId: (webContentsId) => this.resolveTabIdByWebContentsId(webContentsId),
    emitLog: (level, message) => this.emitLog(level, message),
    syncState: () => this.syncState(),
  });
  private perception = new BrowserPerception((expression, tabId) => this.executeInPage(expression, tabId));
  private siteStrategies = new BrowserSiteStrategyStore();
  private pageInteraction = new BrowserPageInteraction((tabId) => this.resolveEntry(tabId));
  private pageAnalysis = new BrowserPageAnalysis({
    resolveEntry: (tabId) => this.resolveEntry(tabId),
    getTabs: () => this.getTabs(),
    createTab: (url) => this.createTab(url),
    activateTab: (tabId) => this.activateTab(tabId),
    executeInPage: (expression, tabId) => this.executeInPage(expression, tabId),
    captureTabSnapshot: (tabId) => this.captureTabSnapshot(tabId),
    activeTabId: () => this.activeTabId,
  });
  private overlayManager = new BrowserOverlayManager({
    resolveEntry: (tabId) => this.resolveEntry(tabId),
    captureTabSnapshot: (tabId) => this.captureTabSnapshot(tabId),
    executeInPage: (expression, tabId) => this.executeInPage(expression, tabId),
    clickElement: (selector, tabId) => this.clickElement(selector, tabId),
    rankActionableElements: (snapshot, options) => this.pageAnalysis.rankActionableElements(snapshot, options),
  });
  private pageExtractor: PageExtractor = new PageExtractor(
    (expression, tabId) => this.executeInPage(expression, tabId),
  );
  private diskCache: DiskCache | null = null;
  private activeTaskId: string | null = null;
  private stateSyncTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.profile = { id: PROFILE_ID, partition: PARTITION, persistent: true, userAgent: null };
    this.settings = createDefaultSettings();
  }

  // ─── Disk Cache Integration ─────────────────────────────────────────────

  setDiskCache(diskCache: DiskCache, taskId: string): void {
    this.diskCache = diskCache;
    this.activeTaskId = taskId;
  }

  clearDiskCache(): void {
    this.diskCache = null;
    this.activeTaskId = null;
  }

  private async extractToDisk(tabId: string): Promise<void> {
    if (!this.diskCache || !this.activeTaskId) return;
    const entry = this.tabs.get(tabId);
    if (!entry) return;
    try {
      const [content, elements] = await Promise.all([
        this.pageExtractor.extractContent(tabId),
        this.pageExtractor.extractElements(tabId),
      ]);
      this.diskCache.writePageContent(this.activeTaskId, tabId, content);
      this.diskCache.writePageElements(this.activeTaskId, tabId, {
        url: content.url,
        elements: elements.elements,
        forms: elements.forms,
      });
      console.log(`[browser] Extracted to disk: ${tabId} (${content.tier}, ${content.content.length} chars)`);
    } catch (err) {
      console.log(`[browser] Disk extraction failed for ${tabId}: ${err}`);
    }
  }

  private async cachePageKnowledge(tabId: string): Promise<void> {
    const entry = this.tabs.get(tabId);
    if (!entry) return;
    const url = entry.info.navigation.url || entry.view.webContents.getURL();
    if (!url || url === 'about:blank' || url.startsWith('devtools://')) return;

    try {
      const content = await this.pageExtractor.extractContent(tabId);
      if (!content.content.trim()) return;
      pageKnowledgeStore.cachePage({
        tabId,
        url: content.url || url,
        title: content.title || entry.info.navigation.title || '',
        content: content.content,
        tier: content.tier,
      });
      this.emitLog('info', `Cached page knowledge: ${content.title || content.url || tabId}`);
    } catch (err) {
      this.emitLog('warn', `Page knowledge cache failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  createSurface(hostWindow: BrowserWindow): void {
    if (this.tabs.size > 0) return;
    this.hostWindow = hostWindow;

    this.history = loadBrowserHistory();
    this.bookmarks = loadBookmarks();
    this.settings = loadSettings();

    const ses = session.fromPartition(PARTITION);
    this.sessionInstance = ses;
    this.initSession(ses);
    this.downloadManager.attachSession(ses);
    this.instrumentation.attachSession(ses);

    this.createdAt = Date.now();

    eventBus.emit(AppEventType.BROWSER_SURFACE_CREATED, { profileId: PROFILE_ID, partition: PARTITION });
    this.emitLog('info', 'Browser runtime initialized with persistent session');

    // Import Chrome cookies (async, non-blocking — sessions are persistent so this supplements)
    this.handleChromeSessionImport(ses, hostWindow);

    // Restore tabs from last session or create a single default tab
    const lastUrls = loadLastUrls();
    const activeIdx = loadActiveTabIndex();
    if (lastUrls.length > 0) {
      const tabIds: string[] = [];
      for (const url of lastUrls) {
        const tab = this.createTabInternal(url, false);
        tabIds.push(tab.id);
      }
      const targetId = tabIds[Math.min(activeIdx, tabIds.length - 1)] || tabIds[0];
      this.activateTabInternal(targetId);
    } else {
      const tab = this.createTabInternal(this.settings.homepage, false);
      this.activateTabInternal(tab.id);
    }

    this.syncState();
  }

  async reimportChromeCookies(): Promise<{ imported: number; failed: number; domains: string[] }> {
    if (!this.sessionInstance) throw new Error('Browser not initialized');
    if (!isChromeAvailable()) throw new Error('Chrome not available');
    const result = await importChromeCookies(this.sessionInstance);
    this.emitLog('info', `Chrome sessions re-imported: ${result.imported} cookies from ${result.domains.length} domains`);
    return result;
  }

  private async handleChromeSessionImport(ses: Electron.Session, hostWindow: BrowserWindow): Promise<void> {
    if (!isChromeAvailable()) return;

    if (this.settings.importChromeCookies === null) {
      const optIn = await promptCookieImport(hostWindow);
      this.settings.importChromeCookies = optIn;
      saveSettings(this.settings);
      if (!optIn) return;
    }

    if (!this.settings.importChromeCookies) return;

    try {
      const result = await importChromeCookies(ses);
      this.emitLog('info', `Chrome sessions imported: ${result.imported} cookies from ${result.domains.length} domains`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emitLog('warn', `Chrome cookie import failed: ${msg}`);
    }
  }

  private initSession(ses: Electron.Session): void {
    // Present the embedded browser as a standard Chromium browser for Google flows.
    ses.setPermissionCheckHandler((_webContents, permission) => {
      const permType = classifyPermission(permission);
      const decision = resolvePermission(permType);
      return decision === 'granted';
    });

    ses.webRequest.onBeforeSendHeaders({ urls: ['*://*.google.com/*', '*://*.youtube.com/*'] }, (details, callback) => {
      const ua = details.requestHeaders['User-Agent'];
      if (ua && ua.includes('Electron')) {
        details.requestHeaders['User-Agent'] = sanitizeBrowserUserAgent(ua);
      }
      callback({ requestHeaders: details.requestHeaders });
    });

    ses.setPermissionRequestHandler((webContents, permission, callback) => {
      const permType = classifyPermission(permission);
      const decision = resolvePermission(permType);
      const request: BrowserPermissionRequest = {
        id: generateId('perm'), permission: permType,
        origin: webContents.getURL(), decision,
        requestedAt: Date.now(), resolvedAt: Date.now(),
      };
      this.recentPermissions.push(request);
      if (this.recentPermissions.length > MAX_RECENT_PERMISSIONS) {
        this.recentPermissions = this.recentPermissions.slice(-MAX_RECENT_PERMISSIONS);
      }
      eventBus.emit(AppEventType.BROWSER_PERMISSION_REQUESTED, { request });
      eventBus.emit(AppEventType.BROWSER_PERMISSION_RESOLVED, { request });
      this.emitLog('info', `Permission ${permission}: ${decision} (${webContents.getURL()})`);
      callback(decision === 'granted');
      this.syncState();
    });

  }

  // ─── Tab Management ──────────────────────────────────────────────────────

  createTab(url?: string, insertAfterTabId?: string): TabInfo {
    const tab = this.createTabInternal(url || this.settings.homepage, true, insertAfterTabId);
    this.activateTabInternal(tab.id);
    this.syncState();
    return tab.info;
  }

  private createTabInternal(url: string, notify: boolean, insertAfterTabId?: string): TabEntry {
    if (!this.hostWindow || !this.sessionInstance) throw new Error('Browser not initialized');
    const view = this.createBrowserTabView();
    const entry = this.registerTab(view, notify, insertAfterTabId);
    if (url && url !== 'about:blank') {
      this.navigateTab(entry.id, url);
    }
    return entry;
  }

  private createBrowserTabView(existingWebContents?: WebContents): WebContentsView {
    if (!this.sessionInstance) throw new Error('Browser not initialized');
    const view = existingWebContents
      ? new WebContentsView({ webContents: existingWebContents })
      : new WebContentsView({
        webPreferences: {
            session: this.sessionInstance,
            preload: getBrowserTabPreloadPath(),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            webviewTag: false,
            allowRunningInsecureContent: false,
            spellcheck: false,
            javascript: this.settings.javascript,
            images: this.settings.images,
          },
        });

    const currentUserAgent = view.webContents.getUserAgent();
    const effectiveUserAgent = sanitizeBrowserUserAgent(currentUserAgent);
    if (effectiveUserAgent && effectiveUserAgent !== currentUserAgent) {
      view.webContents.setUserAgent(effectiveUserAgent);
    }

    view.webContents.setZoomFactor(this.settings.defaultZoom);
    return view;
  }

  private registerTab(view: WebContentsView, notify: boolean, insertAfterTabId?: string): TabEntry {
    const id = generateId('tab');
    const info: TabInfo = {
      id,
      navigation: {
        url: '', title: 'New Tab', canGoBack: false, canGoForward: false,
        isLoading: false, loadingProgress: null, favicon: '', lastNavigationAt: null,
      },
      status: 'idle',
      zoomLevel: this.settings.defaultZoom,
      muted: false,
      isAudible: false,
      createdAt: Date.now(),
    };

    const entry: TabEntry = { id, view, info };
    this.tabs.set(id, entry);
    if (insertAfterTabId) {
      this.placeTabAfter(id, insertAfterTabId);
    }

    this.wireTabEvents(entry);
    this.instrumentation.attachTab(id, view.webContents);

    if (notify) {
      eventBus.emit(AppEventType.BROWSER_TAB_CREATED, { tab: { ...info } });
      this.emitLog('info', 'New tab created');
    }

    return entry;
  }

  closeTab(tabId: string): void {
    const entry = this.tabs.get(tabId);
    if (!entry) return;

    // Don't close last tab — create a new one instead
    if (this.tabs.size === 1) {
      this.navigateTab(tabId, this.settings.homepage);
      return;
    }

    // If closing the active tab, switch to an adjacent tab
    if (this.activeTabId === tabId) {
      const tabIds = Array.from(this.tabs.keys());
      const idx = tabIds.indexOf(tabId);
      const nextId = tabIds[idx + 1] || tabIds[idx - 1];
      if (nextId) this.activateTabInternal(nextId);
    }

    if (this.splitLeftTabId === tabId) {
      this.splitLeftTabId = null;
    }
    if (this.splitRightTabId === tabId) {
      this.splitRightTabId = null;
    }

    this.destroyTabEntry(entry);
    this.tabs.delete(tabId);
    this.normalizeSplitState();
    this.applyTabLayout();

    eventBus.emit(AppEventType.BROWSER_TAB_CLOSED, { tabId });
    this.syncState();
  }

  activateTab(tabId: string): void {
    this.activateTabInternal(tabId);
    this.syncState();
  }

  private activateTabInternal(tabId: string): void {
    const entry = this.tabs.get(tabId);
    if (!entry || !this.hostWindow) return;
    this.activeTabId = tabId;
    this.applyTabLayout();

    // Update find state to match active tab
    this.findState = { active: false, query: '', activeMatch: 0, totalMatches: 0 };

    eventBus.emit(AppEventType.BROWSER_TAB_ACTIVATED, { tabId });
  }

  getTabs(): TabInfo[] {
    return Array.from(this.tabs.values()).map(e => ({ ...e.info }));
  }

  splitTab(tabId?: string): TabInfo {
    const source = this.resolveEntry(tabId);
    if (!source) {
      throw new Error('No tab available to split');
    }
    const sourceUrl = source.info.navigation.url || source.view.webContents.getURL();
    const urlToOpen = isSafeUrlForTabOpen(sourceUrl) ? sourceUrl : this.settings.homepage;

    if (this.splitRightTabId) {
      const oldRight = this.tabs.get(this.splitRightTabId);
      if (oldRight) this.closeTab(this.splitRightTabId);
      this.splitRightTabId = null;
    }

    const rightTab = this.createTabInternal(urlToOpen, true, source.id);
    this.splitLeftTabId = source.id;
    this.splitRightTabId = rightTab.id;
    this.activateTabInternal(source.id);
    this.syncState();
    return rightTab.info;
  }

  clearSplitView(): void {
    if (!this.splitRightTabId) {
      return;
    }

    const rightId = this.splitRightTabId;
    const rightEntry = this.tabs.get(rightId);
    this.splitRightTabId = null;

    if (!rightEntry) {
      this.applyTabLayout();
      this.syncState();
      return;
    }

    this.tabs.delete(rightId);
    this.destroyTabEntry(rightEntry);
    this.normalizeSplitState();
    this.applyTabLayout();
    this.syncState();
  }

  private placeTabAfter(tabId: string, insertAfterTabId: string): void {
    const entries = Array.from(this.tabs.entries());
    const fromIndex = entries.findIndex(([id]) => id === tabId);
    const afterIndex = entries.findIndex(([id]) => id === insertAfterTabId);
    if (fromIndex === -1 || afterIndex === -1) return;
    if (fromIndex === afterIndex + 1) return;

    const [entry] = entries.splice(fromIndex, 1);
    entries.splice(afterIndex + 1, 0, entry);
    this.tabs = new Map(entries);
  }

  private normalizeSplitState(): void {
    if (this.splitLeftTabId && !this.tabs.has(this.splitLeftTabId)) this.splitLeftTabId = null;
    if (this.splitRightTabId && !this.tabs.has(this.splitRightTabId)) this.splitRightTabId = null;
    if (this.splitLeftTabId && this.splitRightTabId && this.splitLeftTabId === this.splitRightTabId) {
      this.splitRightTabId = null;
    }

    if (!this.activeTabId || !this.tabs.has(this.activeTabId)) {
      this.activeTabId = Array.from(this.tabs.keys())[0] || '';
    }

    if (!this.splitLeftTabId && this.tabs.size > 0) {
      this.splitLeftTabId = this.activeTabId || Array.from(this.tabs.keys())[0];
    }

    if (this.tabs.size <= 1 || !this.splitRightTabId) {
      this.splitRightTabId = null;
      return;
    }

    if (this.splitLeftTabId && !this.tabs.has(this.splitLeftTabId)) {
      this.splitLeftTabId = this.activeTabId || Array.from(this.tabs.keys())[0] || null;
    }
  }

  private destroyTabEntry(entry: TabEntry): void {
    if (this.hostWindow && !this.hostWindow.isDestroyed()) {
      try { this.hostWindow.contentView.removeChildView(entry.view); } catch {}
    }
    this.instrumentation.detachTab(entry.id, entry.view.webContents.id);
    pageKnowledgeStore.removePagesForTab(entry.id);
    this.dialogManager.detachTab(entry.id);
    try { if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close(); } catch {}
  }

  private applyTabLayout(): void {
    if (!this.hostWindow || this.hostWindow.isDestroyed()) return;
    if (this.tabs.size === 0) return;

    this.normalizeSplitState();

    for (const [, entry] of this.tabs.entries()) {
      try { this.hostWindow.contentView.removeChildView(entry.view); } catch {}
    }

    const x = Math.round(this.currentBounds.x);
    const y = Math.round(this.currentBounds.y);
    const width = Math.max(1, Math.round(this.currentBounds.width));
    const height = Math.max(1, Math.round(this.currentBounds.height));

    if (this.splitLeftTabId && this.splitRightTabId) {
      const leftEntry = this.tabs.get(this.splitLeftTabId);
      const rightEntry = this.tabs.get(this.splitRightTabId);
      if (leftEntry && rightEntry) {
        const dividerWidth = width >= 220 ? 2 : 0;
        const availableWidth = Math.max(1, width - dividerWidth);
        const leftWidth = Math.max(1, Math.floor(availableWidth / 2));
        const rightWidth = Math.max(1, availableWidth - leftWidth);
        leftEntry.view.setBounds({ x, y, width: leftWidth, height });
        rightEntry.view.setBounds({ x: x + leftWidth + dividerWidth, y, width: rightWidth, height });
        this.hostWindow.contentView.addChildView(leftEntry.view);
        if (rightEntry.id !== leftEntry.id) {
          this.hostWindow.contentView.addChildView(rightEntry.view);
        }
        return;
      }
    }

    const entry = this.getActiveEntry();
    if (!entry) return;
    this.hostWindow.contentView.addChildView(entry.view);
    entry.view.setBounds({ x, y, width, height });
  }

  private getActiveEntry(): TabEntry | undefined {
    return this.tabs.get(this.activeTabId);
  }

  private wireTabEvents(entry: TabEntry): void {
    const wc = entry.view.webContents;
    const info = entry.info;
    const nav = info.navigation;

    wc.on('focus', () => {
      if (this.activeTabId !== entry.id) {
        this.activateTabInternal(entry.id);
      }
    });

    wc.on('dom-ready', () => {
      void this.dialogManager.installPromptShimInPage(entry);
    });

    wc.on('did-start-loading', () => {
      nav.isLoading = true;
      nav.loadingProgress = 0.1;
      info.status = 'loading';
      this.syncTabAndMaybeNavigation(entry);
    });

    wc.on('did-stop-loading', () => {
      nav.isLoading = false;
      nav.loadingProgress = null;
      info.status = 'ready';
      this.syncTabAndMaybeNavigation(entry);

      // Background extraction is expensive because it clones and parses the
      // full page DOM after every navigation. Keep browser analysis on-demand.
      if (ENABLE_BACKGROUND_PAGE_EXTRACTION) {
        this.cachePageKnowledge(entry.id).catch(() => {});
        if (this.diskCache && this.activeTaskId) {
          this.extractToDisk(entry.id).catch(() => {});
        }
      }
    });

    wc.on('will-navigate', (e: ElectronEvent, url: string) => {
      if (url !== 'about:blank' && !isSafeNavigationUrl(url)) {
        e.preventDefault();
        this.emitLog('warn', `Blocked unsafe navigation target in tab ${entry.id}: ${url}`);
        return;
      }

      if (this.isGoogleOAuthUrl(url)) {
        e.preventDefault();
        this.emitLog('info', `Intercepted Google sign-in — opening in system browser`);
        void this.openGoogleSignInExternally(entry, url);
      }
    });

    wc.on('did-navigate', (_e: ElectronEvent, url: string) => {
      this.dialogManager.clearPendingDialogsForTab(entry.id);
      nav.url = url;
      nav.canGoBack = wc.navigationHistory.canGoBack();
      nav.canGoForward = wc.navigationHistory.canGoForward();
      nav.lastNavigationAt = Date.now();
      this.addHistoryEntry(url, nav.title, nav.favicon);
      this.syncTabAndMaybeNavigation(entry);
      void this.handleGoogleAuthNavigation(entry, url);

      // Fallback: catch Google OAuth URLs that arrived via server-side
      // redirects (302) which bypass will-navigate.
      if (this.isGoogleOAuthUrl(url)) {
        this.emitLog('info', `Intercepted Google sign-in (redirect) — opening in system browser`);
        void this.openGoogleSignInExternally(entry, url);
      }
    });

    wc.on('did-navigate-in-page', (_e: ElectronEvent, url: string) => {
      this.dialogManager.clearPendingDialogsForTab(entry.id);
      nav.url = url;
      nav.canGoBack = wc.navigationHistory.canGoBack();
      nav.canGoForward = wc.navigationHistory.canGoForward();
      this.syncTabAndMaybeNavigation(entry);
    });

    wc.on('page-title-updated', (_e: ElectronEvent, title: string) => {
      nav.title = title;
      const recent = this.history[this.history.length - 1];
      if (recent && recent.url === nav.url) recent.title = title;
      this.syncTabAndMaybeNavigation(entry);
      if (entry.id === this.activeTabId) {
        eventBus.emit(AppEventType.BROWSER_TITLE_UPDATED, { title, url: nav.url });
      }
    });

    wc.on('page-favicon-updated', (_e: ElectronEvent, favicons: string[]) => {
      if (favicons.length > 0) {
        nav.favicon = favicons[0];
        const recent = this.history[this.history.length - 1];
        if (recent && recent.url === nav.url) recent.favicon = favicons[0];
        this.syncTabAndMaybeNavigation(entry);
      }
    });

    wc.on('did-fail-load', (_e: ElectronEvent, errorCode: number, errorDescription: string, validatedURL: string) => {
      if (errorCode === -3) return; // aborted
      this.lastError = { code: errorCode, description: errorDescription, url: validatedURL, timestamp: Date.now() };
      info.status = 'error';
      this.syncTabAndMaybeNavigation(entry);
      this.emitLog('error', `Navigation failed: ${errorDescription} (${validatedURL})`);
    });

    wc.on('found-in-page', (_e: ElectronEvent, result: Electron.FoundInPageResult) => {
      if (!this.findState.active) return;
      if (!this.activeTabId || entry.id !== this.activeTabId) return;
      this.findState.activeMatch = result.activeMatchOrdinal;
      this.findState.totalMatches = result.matches;
      this.broadcastFind();
    });

    wc.on('audio-state-changed', () => {
      info.isAudible = wc.isCurrentlyAudible();
      this.syncTabAndMaybeNavigation(entry);
    });

    wc.on('context-menu', (_e: ElectronEvent, params: Electron.ContextMenuParams) => {
      const menu = new Menu();
      const currentUrl = wc.getURL();
      const canViewSource = !!currentUrl
        && currentUrl !== 'about:blank'
        && !currentUrl.startsWith('devtools://')
        && !currentUrl.startsWith('view-source:');

      // ── Text editing actions ──
      if (params.isEditable) {
        menu.append(new MenuItem({ label: 'Undo', role: 'undo', enabled: params.editFlags.canUndo }));
        menu.append(new MenuItem({ label: 'Redo', role: 'redo', enabled: params.editFlags.canRedo }));
        menu.append(new MenuItem({ type: 'separator' }));
        menu.append(new MenuItem({ label: 'Cut', role: 'cut', enabled: params.editFlags.canCut }));
        menu.append(new MenuItem({ label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy }));
        menu.append(new MenuItem({ label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste }));
        menu.append(new MenuItem({ label: 'Delete', role: 'delete', enabled: params.editFlags.canDelete }));
        menu.append(new MenuItem({ type: 'separator' }));
        menu.append(new MenuItem({ label: 'Select All', role: 'selectAll', enabled: params.editFlags.canSelectAll }));
      } else {
        // ── Selection actions (non-editable) ──
        if (params.selectionText) {
          menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
          menu.append(new MenuItem({ type: 'separator' }));
        }
        menu.append(new MenuItem({ label: 'Select All', role: 'selectAll' }));
      }

      // ── Link actions ──
      if (params.linkURL) {
        menu.append(new MenuItem({ type: 'separator' }));
        menu.append(new MenuItem({
          label: 'Open Link in New Tab',
          click: () => this.createTabIfSafe(params.linkURL),
        }));
        menu.append(new MenuItem({
          label: 'Copy Link Address',
          click: () => clipboard.writeText(params.linkURL),
        }));
      }

      // ── Image actions ──
      if (params.hasImageContents && params.srcURL) {
        menu.append(new MenuItem({ type: 'separator' }));
        menu.append(new MenuItem({
          label: 'Open Image in New Tab',
          click: () => this.createTabIfSafe(params.srcURL),
        }));
        menu.append(new MenuItem({
          label: 'Copy Image Address',
          click: () => clipboard.writeText(params.srcURL),
        }));
      }

      // ── Page actions ──
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() }));
      menu.append(new MenuItem({ label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() }));
      menu.append(new MenuItem({ label: 'Reload', click: () => wc.reload() }));
      menu.append(new MenuItem({
        label: 'View Page Source',
        enabled: canViewSource,
        click: () => { if (canViewSource) void this.openPageSource(currentUrl); },
      }));
      menu.append(new MenuItem({
        label: 'Inspect Element',
        click: () => wc.inspectElement(params.x, params.y),
      }));

      menu.popup();
    });

    wc.setWindowOpenHandler((details) => {
      const requestedUrl = typeof details.url === 'string' ? details.url.trim() : '';
      if (requestedUrl && requestedUrl !== 'about:blank' && !isSafeExternalUrl(requestedUrl)) {
        this.emitLog('warn', `Blocked unsafe popup URL: ${requestedUrl}`);
        return { action: 'deny' };
      }

      return {
        action: 'allow',
        createWindow: (options: Electron.BrowserWindowConstructorOptions) => {
          const adoptedWebContents = (options as Electron.BrowserWindowConstructorOptions & { webContents?: WebContents }).webContents;
          const childView = this.createBrowserTabView(adoptedWebContents);
          const childEntry = this.registerTab(childView, true);
          const shouldActivate = details.disposition !== 'background-tab';
          if (!adoptedWebContents && details.url && details.url !== 'about:blank') {
            if (isSafeExternalUrl(details.url)) {
              childEntry.info.navigation.url = details.url;
              childEntry.view.webContents.loadURL(details.url);
            } else {
              childEntry.view.webContents.loadURL('about:blank');
              return childEntry.view.webContents;
            }
          } else if (adoptedWebContents) {
            const initialUrl = adoptedWebContents.getURL();
            if (initialUrl && initialUrl !== 'about:blank' && !isSafeExternalUrl(initialUrl)) {
              adoptedWebContents.loadURL('about:blank');
            }
          }
          const existingUrl = childEntry.view.webContents.getURL();
          if (existingUrl && existingUrl !== 'about:blank') {
            childEntry.info.navigation.url = existingUrl;
          }
          const existingTitle = childEntry.view.webContents.getTitle();
          if (existingTitle) {
            childEntry.info.navigation.title = existingTitle;
          }
          if (shouldActivate) {
            this.activateTabInternal(childEntry.id);
          }
          this.emitLog(
            'info',
            `Opened ${details.disposition || 'new window'} request in ${shouldActivate ? 'active' : 'background'} tab`,
          );
          this.syncState();
          return childEntry.view.webContents;
        },
      };
    });
  }

  private resolveTabIdByWebContentsId(webContentsId: number): string | null {
    for (const [tabId, entry] of this.tabs.entries()) {
      if (entry.view.webContents.id === webContentsId) return tabId;
    }
    return null;
  }

  isKnownTabWebContents(webContentsId: number): boolean {
    return this.resolveTabIdByWebContentsId(webContentsId) !== null;
  }

  private syncTabAndMaybeNavigation(entry: TabEntry): void {
    eventBus.emit(AppEventType.BROWSER_TAB_UPDATED, { tab: { ...entry.info } });
    if (entry.id === this.activeTabId) {
      this.syncNavigation();
      return;
    }

    // Background tabs can still be in transient states during navigation.
    // Emit a full state sync so renderers refresh tab-level loading/error status
    // without requiring activation.
    this.syncState();
  }

  private async handleGoogleAuthNavigation(entry: TabEntry, rawUrl: string): Promise<void> {
    if (!this.sessionInstance) return;

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return;
    }

    if (parsed.hostname !== 'accounts.google.com' || parsed.pathname !== GOOGLE_AUTH_MISMATCH_PATH) {
      return;
    }

    this.lastGoogleCookieMismatchAt = Date.now();
    const cleared = await this.clearGoogleAuthCookies();
    this.emitLog(
      'warn',
      `Detected Google CookieMismatch; cleared ${cleared} Google-family cookies and restarted auth flow`,
    );

    if (!entry.view.webContents.isDestroyed()) {
      entry.view.webContents.loadURL(GOOGLE_AUTH_START_URL);
    }
  }

  private async clearGoogleAuthCookies(): Promise<number> {
    if (!this.sessionInstance) return 0;

    const cookies = await this.sessionInstance.cookies.get({});
    let cleared = 0;

    for (const cookie of cookies) {
      if (!cookie.domain || !cookie.name || !isGoogleCookieDomain(cookie.domain)) {
        continue;
      }

      const url = `http${cookie.secure ? 's' : ''}://${cookie.domain.replace(/^\./, '')}${cookie.path}`;
      try {
        await this.sessionInstance.cookies.remove(url, cookie.name);
        cleared++;
      } catch {
        // Ignore individual removal failures and continue clearing the jar.
      }
    }

    return cleared;
  }

  // ─── Google OAuth System-Browser Relay ────────────────────────────────────

  /**
   * Returns true if the URL is a Google sign-in / OAuth page that should be
   * opened in the system browser instead of the embedded one.
   */
  private isGoogleOAuthUrl(rawUrl: string): boolean {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return false;
    }
    if (parsed.hostname !== 'accounts.google.com') return false;
    return GOOGLE_OAUTH_PATH_PATTERNS.some(p => parsed.pathname.startsWith(p));
  }

  /**
   * Intercepts a Google OAuth navigation, opens it in the system browser,
   * and polls for the resulting cookies to appear in Chrome's cookie store.
   * Once detected, imports them into the Electron session so the embedded
   * browser ends up authenticated.
   */
  private async openGoogleSignInExternally(entry: TabEntry, oauthUrl: string): Promise<void> {
    if (!this.sessionInstance) return;

    // Prevent duplicate relays
    this.stopOAuthRelay();

    const ses = this.sessionInstance;
    const tabWc = entry.view.webContents;

    // Extract the original destination the user was trying to reach
    let continueUrl: string | null = null;
    try {
      const parsed = new URL(oauthUrl);
      continueUrl = parsed.searchParams.get('continue')
        || parsed.searchParams.get('redirect_uri')
        || null;
    } catch { /* ignore */ }

    // Show a placeholder in the embedded tab while the user authenticates
    if (!tabWc.isDestroyed()) {
      tabWc.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(
        `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;
justify-content:center;height:100vh;margin:0;background:#0a0a0a;color:#ccc}
.card{text-align:center;padding:40px}
h2{margin-bottom:8px;color:#fff}
p{color:#888;max-width:340px;line-height:1.6}
.spinner{width:24px;height:24px;border:2px solid #333;border-top-color:#aaa;
border-radius:50%;animation:spin 0.8s linear infinite;margin:16px auto 0}
@keyframes spin{to{transform:rotate(360deg)}}
</style></head><body><div class="card">
<h2>Sign in with Google</h2>
<p>Your system browser has been opened. Complete sign-in there, then return here — this page will update automatically.</p>
<div class="spinner"></div>
</div></body></html>`,
      )}`);
    }

    if (!isSafeExternalUrl(oauthUrl)) {
      this.emitLog('warn', `Blocked unsafe OAuth URL for external launch: ${oauthUrl}`);
      return;
    }

    // Open the original OAuth URL in the system browser
    void shell.openExternal(oauthUrl);

    // Poll Chrome's cookie database for fresh Google session cookies.
    // Once they appear, import them and navigate to the destination.
    const POLL_INTERVAL = 3000;
    let elapsed = 0;

    const poll = async () => {
      elapsed += POLL_INTERVAL;
      if (elapsed > OAUTH_RELAY_TIMEOUT_MS) {
        this.stopOAuthRelay();
        this.emitLog('warn', 'Google sign-in polling timed out after 5 minutes');
        return;
      }

      try {
        const result = await importChromeCookies(ses, true);
        // Check if we got any Google cookies this round
        const hasGoogleCookies = result.domains.some(d => {
          const norm = d.replace(/^\./, '').toLowerCase();
          return GOOGLE_COOKIE_DOMAIN_SUFFIXES.some(s => norm === s || norm.endsWith(`.${s}`));
        });

        if (hasGoogleCookies && result.imported > 0) {
          this.emitLog('info', `Google sign-in complete: imported ${result.imported} cookies (${result.domains.length} domains)`);
          this.stopOAuthRelay();

          // Navigate to the original destination
          const destination = (continueUrl && isSafeNavigationUrl(continueUrl))
            ? continueUrl
            : 'https://myaccount.google.com/';
          if (!tabWc.isDestroyed()) {
            tabWc.loadURL(destination);
          }
          return;
        }
      } catch (err) {
        this.emitLog('warn', `OAuth poll: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Keep polling
      this.oauthRelayTimer = setTimeout(() => void poll(), POLL_INTERVAL);
    };

    // Start polling after initial delay to let the system browser load
    this.oauthRelayTimer = setTimeout(() => void poll(), POLL_INTERVAL);
  }

  private stopOAuthRelay(): void {
    if (this.oauthRelayTimer) {
      clearTimeout(this.oauthRelayTimer);
      this.oauthRelayTimer = null;
    }
  }

  // ─── Navigation ──────────────────────────────────────────────────────────

  navigate(url: string): void {
    this.navigateTab(this.activeTabId, url);
  }

  private navigateTab(tabId: string, url: string): void {
    const entry = this.tabs.get(tabId);
    if (!entry) return;
    const normalized = normalizeNavigationTarget(url, {
      searchEngine: this.settings.searchEngine,
      cwd: APP_WORKSPACE_ROOT,
    });
    if (!isSafeUrlForTabOpen(normalized.url)) {
      this.emitLog('warn', `Blocked unsafe navigation target: ${normalized.url}`);
      return;
    }
    entry.info.navigation.url = normalized.url;
    entry.view.webContents.loadURL(normalized.url);
  }

  private createTabIfSafe(rawUrl: string): void {
    if (!isSafeUrlForTabOpen(rawUrl)) {
      this.emitLog('warn', `Blocked unsafe context link URL: ${rawUrl}`);
      return;
    }
    this.createTab(rawUrl);
  }

  goBack(): void {
    const entry = this.getActiveEntry();
    if (!entry || !entry.view.webContents.navigationHistory.canGoBack()) return;
    entry.view.webContents.navigationHistory.goBack();
  }

  goForward(): void {
    const entry = this.getActiveEntry();
    if (!entry || !entry.view.webContents.navigationHistory.canGoForward()) return;
    entry.view.webContents.navigationHistory.goForward();
  }

  reload(): void {
    const entry = this.getActiveEntry();
    if (entry) entry.view.webContents.reload();
  }

  stop(): void {
    const entry = this.getActiveEntry();
    if (entry) entry.view.webContents.stop();
  }

  // ─── Zoom ────────────────────────────────────────────────────────────────

  zoomIn(): void {
    const entry = this.getActiveEntry();
    if (!entry) return;
    const current = entry.view.webContents.getZoomFactor();
    const next = Math.min(ZOOM_MAX, current + ZOOM_STEP);
    entry.view.webContents.setZoomFactor(next);
    entry.info.zoomLevel = next;
    this.syncState();
  }

  zoomOut(): void {
    const entry = this.getActiveEntry();
    if (!entry) return;
    const current = entry.view.webContents.getZoomFactor();
    const next = Math.max(ZOOM_MIN, current - ZOOM_STEP);
    entry.view.webContents.setZoomFactor(next);
    entry.info.zoomLevel = next;
    this.syncState();
  }

  zoomReset(): void {
    const entry = this.getActiveEntry();
    if (!entry) return;
    entry.view.webContents.setZoomFactor(1.0);
    entry.info.zoomLevel = 1.0;
    this.syncState();
  }

  // ─── Find In Page ────────────────────────────────────────────────────────

  findInPage(query: string): void {
    const entry = this.getActiveEntry();
    if (!entry || !query) return;
    this.findState = { active: true, query, activeMatch: 0, totalMatches: 0 };
    entry.view.webContents.findInPage(query);
    this.syncState();
  }

  findNext(): void {
    const entry = this.getActiveEntry();
    if (!entry || !this.findState.active || !this.findState.query) return;
    entry.view.webContents.findInPage(this.findState.query, { findNext: true, forward: true });
  }

  findPrevious(): void {
    const entry = this.getActiveEntry();
    if (!entry || !this.findState.active || !this.findState.query) return;
    entry.view.webContents.findInPage(this.findState.query, { findNext: true, forward: false });
  }

  stopFind(): void {
    const entry = this.getActiveEntry();
    if (entry) entry.view.webContents.stopFindInPage('clearSelection');
    this.findState = { active: false, query: '', activeMatch: 0, totalMatches: 0 };
    this.broadcastFind();
    this.syncState();
  }

  private broadcastFind(): void {
    // Broadcast via dedicated channel handled in eventRouter
    if (this.hostWindow && !this.hostWindow.isDestroyed()) {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && win.webContents) {
          win.webContents.send('browser:find-update', {
            activeMatch: this.findState.activeMatch,
            totalMatches: this.findState.totalMatches,
          });
        }
      }
    }
  }

  // ─── DevTools ────────────────────────────────────────────────────────────

  toggleDevTools(): void {
    const entry = this.getActiveEntry();
    if (!entry) return;
    if (entry.view.webContents.isDevToolsOpened()) {
      entry.view.webContents.closeDevTools();
    } else {
      entry.view.webContents.openDevTools({ mode: 'detach' });
    }
  }

  private async openPageSource(url: string): Promise<void> {
    if (!this.sessionInstance) return;

    const tab = this.createTabInternal('about:blank', true);
    this.activateTabInternal(tab.id);
    this.syncState();

    try {
      const response = await this.sessionInstance.fetch(url);
      const source = await response.text();
      const contentType = response.headers.get('content-type') || 'unknown';
      await tab.view.webContents.loadURL(this.renderSourceDocument({
        url,
        source,
        title: `Source: ${url}`,
        meta: `HTTP ${response.status} ${response.statusText || ''}`.trim(),
        contentType,
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await tab.view.webContents.loadURL(this.renderSourceDocument({
        url,
        source: `Unable to load page source.\n\n${message}`,
        title: `Source Error: ${url}`,
        meta: 'Fetch failed',
        contentType: 'text/plain',
      }));
      this.emitLog('warn', `View page source failed for ${url}: ${message}`);
    }
  }

  private renderSourceDocument(input: {
    url: string;
    source: string;
    title: string;
    meta: string;
    contentType: string;
  }): string {
    const escapedTitle = this.escapeHtml(input.title);
    const escapedUrl = this.escapeHtml(input.url);
    const escapedMeta = this.escapeHtml(input.meta);
    const escapedContentType = this.escapeHtml(input.contentType);
    const escapedSource = this.escapeHtml(input.source);

    return `data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'" />
    <title>${escapedTitle}</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      body {
        margin: 0;
        background: #111827;
        color: #e5e7eb;
      }
      header {
        padding: 12px 16px;
        border-bottom: 1px solid #374151;
        background: #0f172a;
      }
      h1 {
        margin: 0 0 6px;
        font-size: 14px;
        font-weight: 600;
      }
      p {
        margin: 2px 0;
        font-size: 12px;
        color: #9ca3af;
        word-break: break-all;
      }
      pre {
        margin: 0;
        padding: 16px;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 12px;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <header>
      <h1>${escapedTitle}</h1>
      <p>${escapedUrl}</p>
      <p>${escapedMeta}</p>
      <p>Content-Type: ${escapedContentType}</p>
    </header>
    <pre>${escapedSource}</pre>
  </body>
</html>`)}`;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ─── Bookmarks ──────────────────────────────────────────────────────────

  addBookmark(url: string, title: string): BookmarkEntry {
    const entry: BookmarkEntry = {
      id: generateId('bm'),
      url, title,
      favicon: '',
      createdAt: Date.now(),
    };
    // Get favicon from active tab if URL matches
    const active = this.getActiveEntry();
    if (active && active.info.navigation.url === url) {
      entry.favicon = active.info.navigation.favicon;
    }
    this.bookmarks.push(entry);
    saveBookmarks(this.bookmarks);
    eventBus.emit(AppEventType.BROWSER_BOOKMARK_ADDED, { bookmark: { ...entry } });
    this.emitLog('info', `Bookmark added: ${title}`);
    this.syncState();
    return { ...entry };
  }

  removeBookmark(bookmarkId: string): void {
    this.bookmarks = this.bookmarks.filter(b => b.id !== bookmarkId);
    saveBookmarks(this.bookmarks);
    eventBus.emit(AppEventType.BROWSER_BOOKMARK_REMOVED, { bookmarkId });
    this.syncState();
  }

  getBookmarks(): BookmarkEntry[] {
    return [...this.bookmarks];
  }

  // ─── History ──────────────────────────────────────────────────────────────

  private addHistoryEntry(url: string, title: string, favicon: string): void {
    if (!url || url === 'about:blank' || url.startsWith('devtools://')) return;
    const last = this.history[this.history.length - 1];
    if (last && last.url === url) return;
    this.history.push({ url, title: title || url, visitedAt: Date.now(), favicon: favicon || '' });
    if (this.history.length > MAX_HISTORY) this.history = this.history.slice(-MAX_HISTORY);
    this.scheduleHistoryPersist();
    eventBus.emit(AppEventType.BROWSER_HISTORY_UPDATED, { entries: this.getRecentHistory() });
  }

  getHistory(): BrowserHistoryEntry[] { return [...this.history]; }
  getRecentHistory(count: number = 50): BrowserHistoryEntry[] { return this.history.slice(-count); }

  clearHistory(): void {
    this.history = [];
    this.persistNow();
    eventBus.emit(AppEventType.BROWSER_HISTORY_UPDATED, { entries: [] });
    this.emitLog('info', 'Browser history cleared');
    this.syncState();
  }

  async clearData(): Promise<void> {
    const entry = this.getActiveEntry();
    if (entry?.view?.webContents && !entry.view.webContents.isDestroyed()) {
      const ses = entry.view.webContents.session;
      await ses.clearStorageData();
      await ses.clearCache();
    }
    pageKnowledgeStore.clearAll();
    this.clearHistory();
    this.emitLog('info', 'Browser data cleared (cache, storage, history)');
  }

  async clearSiteData(origin?: string): Promise<{ origin: string; cookiesCleared: number }> {
    const entry = this.getActiveEntry();
    const targetOrigin = this.resolveOriginForSiteData(origin, entry?.info.navigation.url || entry?.view.webContents.getURL() || '');
    if (!targetOrigin) {
      throw new Error('No valid site origin available to clear');
    }

    const ses = entry?.view?.webContents?.session || this.sessionInstance;
    if (!ses) {
      throw new Error('Browser session is not initialized');
    }

    await ses.clearStorageData({
      origin: targetOrigin,
      storages: [
        'cookies',
        'filesystem',
        'indexdb',
        'localstorage',
        'websql',
        'shadercache',
        'serviceworkers',
        'cachestorage',
      ],
      quotas: ['temporary'],
    });

    const parsedOrigin = new URL(targetOrigin);
    const hostname = parsedOrigin.hostname.toLowerCase();
    const cookies = await ses.cookies.get({});
    let cookiesCleared = 0;

    for (const cookie of cookies) {
      const cookieDomain = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
      if (!cookieDomain) continue;
      const matches = cookieDomain === hostname || hostname.endsWith(`.${cookieDomain}`) || cookieDomain.endsWith(`.${hostname}`);
      if (!matches) continue;
      const cookieUrl = `http${cookie.secure ? 's' : ''}://${cookieDomain}${cookie.path}`;
      try {
        await ses.cookies.remove(cookieUrl, cookie.name);
        cookiesCleared++;
      } catch {
        // Best-effort cookie cleanup.
      }
    }

    this.emitLog('info', `Cleared site data for ${targetOrigin} (${cookiesCleared} cookies removed)`);
    return { origin: targetOrigin, cookiesCleared };
  }

  private resolveOriginForSiteData(inputOrigin: string | undefined, fallbackUrl: string): string | null {
    const candidate = (inputOrigin || fallbackUrl || '').trim();
    if (!candidate) return null;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      return parsed.origin;
    } catch {
      return null;
    }
  }

  private scheduleHistoryPersist(): void {
    if (this.historyPersistTimer) clearTimeout(this.historyPersistTimer);
    this.historyPersistTimer = setTimeout(() => {
      this.persistNow();
      this.historyPersistTimer = null;
    }, HISTORY_PERSIST_DEBOUNCE);
  }

  private persistNow(): void {
    const lastUrls = Array.from(this.tabs.values()).map(e => e.info.navigation.url).filter(u => u && u !== 'about:blank');
    const tabIds = Array.from(this.tabs.keys());
    const activeIdx = tabIds.indexOf(this.activeTabId);
    saveBrowserHistory(this.history, lastUrls, Math.max(0, activeIdx));
  }

  // ─── Settings ────────────────────────────────────────────────────────────

  getSettings(): BrowserSettings { return { ...this.settings }; }

  updateSettings(partial: Partial<BrowserSettings>): void {
    this.settings = { ...this.settings, ...partial };
    saveSettings(this.settings);
    this.emitLog('info', 'Browser settings updated');
    this.syncState();
  }

  async getAuthDiagnostics(): Promise<BrowserAuthDiagnostics> {
    const cookies = this.sessionInstance ? await this.sessionInstance.cookies.get({}) : [];
    const activeEntry = this.getActiveEntry();
    const activeTabUserAgent = activeEntry && !activeEntry.view.webContents.isDestroyed()
      ? activeEntry.view.webContents.getUserAgent()
      : '';

    return {
      totalCookies: cookies.length,
      googleCookieCount: cookies.filter(cookie => cookie.domain && isGoogleCookieDomain(cookie.domain)).length,
      importChromeCookies: this.settings.importChromeCookies,
      googleAuthCompatibilityActive: true,
      lastGoogleCookieMismatchAt: this.lastGoogleCookieMismatchAt,
      activeTabUserAgent,
      activeTabHasElectronUA: /Electron\/[\d.]+/i.test(activeTabUserAgent),
    };
  }

  async clearGoogleAuthState(): Promise<{ cleared: number }> {
    const cleared = await this.clearGoogleAuthCookies();
    this.emitLog('info', `Cleared ${cleared} Google-family cookies from the app session`);
    return { cleared };
  }

  // ─── Extensions ──────────────────────────────────────────────────────────

  async loadExtension(extPath: string): Promise<ExtensionInfo | null> {
    if (!this.sessionInstance) return null;
    try {
      const ext = await this.sessionInstance.loadExtension(extPath);
      const info: ExtensionInfo = {
        id: ext.id, name: ext.name, version: ext.version || '0.0.0',
        path: ext.path, enabled: true,
      };
      this.extensions.push(info);
      eventBus.emit(AppEventType.BROWSER_EXTENSION_LOADED, { extension: info });
      this.emitLog('info', `Extension loaded: ${ext.name}`);
      this.syncState();
      return info;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emitLog('error', `Failed to load extension: ${msg}`);
      return null;
    }
  }

  async removeExtension(extensionId: string): Promise<void> {
    if (!this.sessionInstance) return;
    try {
      await this.sessionInstance.removeExtension(extensionId);
      this.extensions = this.extensions.filter(e => e.id !== extensionId);
      eventBus.emit(AppEventType.BROWSER_EXTENSION_REMOVED, { extensionId });
      this.emitLog('info', `Extension removed: ${extensionId}`);
      this.syncState();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emitLog('error', `Failed to remove extension: ${msg}`);
    }
  }

  getExtensions(): ExtensionInfo[] {
    // Sync with session's actual loaded extensions
    if (this.sessionInstance) {
      const loaded = this.sessionInstance.getAllExtensions();
      this.extensions = loaded.map(e => ({
        id: e.id, name: e.name, version: e.version || '0.0.0',
        path: e.path, enabled: true,
      }));
    }
    return [...this.extensions];
  }

  // ─── Downloads ──────────────────────────────────────────────────────────

  async downloadUrl(
    url: string,
    tabId?: string,
  ): Promise<{
    started: boolean;
    error: string | null;
    url: string;
    tabId?: string;
    download?: BrowserDownloadState;
    method?: string;
  }> {
    const entry = this.resolveEntry(tabId || this.activeTabId);
    if (!entry) {
      return { started: false, error: 'No active tab', url };
    }
    return this.downloadManager.downloadFromWebContents(entry.id, entry.view.webContents, url);
  }

  async downloadLink(
    selector: string,
    tabId?: string,
  ): Promise<{
    started: boolean;
    error: string | null;
    selector: string;
    href?: string;
    tabId?: string;
    download?: BrowserDownloadState;
    method?: string;
  }> {
    const safeSelector = JSON.stringify(selector);
    const hrefResult = await this.executeInPage(`
      (() => {
        const node = document.querySelector(${safeSelector});
        if (!node) return { ok: false, reason: 'Element not found' };
        const candidate = node instanceof HTMLAnchorElement ? node : node.closest('a[href]');
        if (!(candidate instanceof HTMLAnchorElement)) {
          return { ok: false, reason: 'Element is not a download link or inside an anchor' };
        }
        candidate.scrollIntoView({ block: 'center', inline: 'center' });
        return {
          ok: true,
          href: candidate.href || '',
          text: (candidate.innerText || candidate.textContent || '').trim().slice(0, 200),
        };
      })()
    `, tabId);
    if (hrefResult.error) {
      return { started: false, error: hrefResult.error, selector };
    }
    const raw = hrefResult.result as { ok?: boolean; reason?: string; href?: string } | null;
    if (!raw?.ok || typeof raw.href !== 'string' || raw.href.trim() === '') {
      return {
        started: false,
        error: raw?.reason || 'Could not resolve download link href',
        selector,
      };
    }
    const started = await this.downloadUrl(raw.href, tabId);
    return {
      started: started.started,
      error: started.error,
      selector,
      href: raw.href,
      tabId: started.tabId,
      download: started.download,
      method: started.method,
    };
  }

  getDownloads(): BrowserDownloadState[] {
    return this.downloadManager.getDownloads();
  }

  async waitForDownload(input: {
    downloadId?: string;
    filename?: string;
    tabId?: string;
    timeoutMs?: number;
  } = {}): Promise<{
    found: boolean;
    completed: boolean;
    timedOut: boolean;
    download: BrowserDownloadState | null;
  }> {
    return this.downloadManager.waitForDownload(input);
  }

  cancelDownload(downloadId: string): void {
    this.downloadManager.cancelDownload(downloadId);
  }

  clearDownloads(): void {
    this.downloadManager.clearDownloads();
  }

  // ─── Bounds ──────────────────────────────────────────────────────────────

  setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.currentBounds = bounds;
    this.applyTabLayout();
  }

  // ─── State ────────────────────────────────────────────────────────────────

  getState(): BrowserState {
    const active = this.getActiveEntry();
    const nav = active ? { ...active.info.navigation } : {
      url: '', title: '', canGoBack: false, canGoForward: false,
      isLoading: false, loadingProgress: null, favicon: '', lastNavigationAt: null,
    };
    const status = active ? active.info.status : 'idle' as BrowserSurfaceStatus;
    return {
      surfaceStatus: status,
      navigation: nav,
      profile: { ...this.profile },
      tabs: this.getTabs(),
      activeTabId: this.activeTabId,
      splitLeftTabId: this.splitLeftTabId,
      splitRightTabId: this.splitRightTabId,
      history: this.getRecentHistory(),
      bookmarks: [...this.bookmarks],
      activeDownloads: this.downloadManager.getActiveDownloads(),
      completedDownloads: this.downloadManager.getCompletedDownloads(),
      recentPermissions: [...this.recentPermissions],
      pendingDialogs: this.getPendingDialogs(),
      extensions: [...this.extensions],
      findInPage: { ...this.findState },
      settings: { ...this.settings },
      lastError: this.lastError ? { ...this.lastError } : null,
      createdAt: this.createdAt,
    };
  }

  private syncState(): void {
    if (this.stateSyncTimer) return;
    this.stateSyncTimer = setTimeout(() => {
      this.stateSyncTimer = null;
      const state = this.getState();
      appStateStore.dispatch({ type: ActionType.SET_BROWSER_RUNTIME, browserRuntime: state });
      eventBus.emit(AppEventType.BROWSER_STATE_CHANGED, { state });
      eventBus.emit(AppEventType.BROWSER_STATUS_UPDATED, {
        status: state.surfaceStatus,
        detail: state.navigation.url,
      });
    }, BROWSER_STATE_SYNC_DEBOUNCE);
  }

  private syncNavigation(): void {
    const active = this.getActiveEntry();
    if (!active) return;
    const nav = { ...active.info.navigation };
    eventBus.emit(AppEventType.BROWSER_NAVIGATION_UPDATED, { navigation: nav });

    const surfaceMap: Record<BrowserSurfaceStatus, 'idle' | 'running' | 'done' | 'error'> = {
      idle: 'idle', loading: 'running', ready: 'done', error: 'error',
    };
    appStateStore.dispatch({
      type: ActionType.SET_SURFACE_STATUS,
      surface: 'browser',
      status: { status: surfaceMap[active.info.status], lastUpdatedAt: Date.now(), detail: nav.title || nav.url || '' },
    });
    this.syncState();
  }

  isCreated(): boolean { return this.tabs.size > 0; }

  async getPageText(maxLength: number = 8000): Promise<string> {
    return this.pageInteraction.getPageText(maxLength);
  }

  async executeInPage(
    expression: string,
    tabId?: string,
  ): Promise<{ result: unknown; error: string | null }> {
    return this.pageInteraction.executeInPage(expression, tabId);
  }

  async querySelectorAll(
    selector: string,
    tabId?: string,
    limit: number = 20,
  ): Promise<Array<{ tag: string; text: string; href: string | null; id: string; classes: string[] }>> {
    return this.pageInteraction.querySelectorAll(selector, tabId, limit);
  }

  async clickElement(
    selector: string,
    tabId?: string,
  ): Promise<{
    clicked: boolean;
    error: string | null;
    method?: string;
    x?: number;
    y?: number;
    globalX?: number;
    globalY?: number;
    hitTest?: BrowserPointerHitTestResult;
  }> {
    const entry = this.resolveEntry(tabId);
    if (entry) this.dialogManager.ensureDebugger(entry);
    return this.pageInteraction.clickElement(selector, tabId);
  }

  async hitTestElement(selector: string, tabId?: string): Promise<BrowserPointerHitTestResult> {
    return this.pageInteraction.hitTestElement(selector, tabId);
  }

  async hoverElement(
    selector: string,
    tabId?: string,
  ): Promise<{
    hovered: boolean;
    error: string | null;
    method?: string;
    selector?: string;
    x?: number;
    y?: number;
    globalX?: number;
    globalY?: number;
    hitTest?: BrowserPointerHitTestResult;
  }> {
    const entry = this.resolveEntry(tabId);
    if (entry) this.dialogManager.ensureDebugger(entry);
    return this.pageInteraction.hoverElement(selector, tabId);
  }

  getPendingDialogs(tabId?: string): BrowserJavaScriptDialog[] {
    return this.dialogManager.getPendingDialogs(tabId);
  }

  openPromptDialogFallback(input: {
    webContentsId: number;
    message: string;
    defaultPrompt?: string;
    url?: string;
  }): { dialogId: string; created: boolean } {
    return this.dialogManager.openPromptDialogFallback(input);
  }

  pollPromptDialogFallback(dialogId: string): { done: boolean; value: string | null } {
    return this.dialogManager.pollPromptDialogFallback(dialogId);
  }

  async acceptDialog(input: {
    tabId?: string;
    dialogId?: string;
    promptText?: string;
  } = {}): Promise<{ accepted: boolean; error: string | null; dialog: BrowserJavaScriptDialog | null }> {
    return this.dialogManager.acceptDialog(input, this.activeTabId);
  }

  async dismissDialog(input: {
    tabId?: string;
    dialogId?: string;
  } = {}): Promise<{ dismissed: boolean; error: string | null; dialog: BrowserJavaScriptDialog | null }> {
    return this.dialogManager.dismissDialog(input, this.activeTabId);
  }

  async typeInElement(
    selector: string,
    text: string,
    tabId?: string,
  ): Promise<{ typed: boolean; error: string | null }> {
    const entry = this.resolveEntry(tabId);
    if (entry) this.dialogManager.ensureDebugger(entry);
    return this.pageInteraction.typeInElement(selector, text, tabId);
  }

  async uploadFileToElement(
    selector: string,
    filePath: string,
    tabId?: string,
  ): Promise<{
    uploaded: boolean;
    error: string | null;
    method?: string;
    selector?: string;
    filePath?: string;
    fileName?: string;
  }> {
    const entry = this.resolveEntry(tabId);
    if (entry) this.dialogManager.ensureDebugger(entry);
    return this.pageInteraction.uploadFile(selector, filePath, tabId);
  }

  async dragElement(
    sourceSelector: string,
    targetSelector: string,
    tabId?: string,
  ): Promise<{
    dragged: boolean;
    error: string | null;
    sourceSelector?: string;
    targetSelector?: string;
    method?: string;
    from?: { x: number; y: number };
    to?: { x: number; y: number };
  }> {
    const entry = this.resolveEntry(tabId);
    if (entry) this.dialogManager.ensureDebugger(entry);
    return this.pageInteraction.dragElement(sourceSelector, targetSelector, tabId);
  }

  async getPageMetadata(tabId?: string): Promise<Record<string, unknown>> {
    return this.pageInteraction.getPageMetadata(tabId);
  }

  async extractSearchResults(tabId?: string, limit: number = 10): Promise<SearchResultCandidate[]> {
    return this.pageAnalysis.extractSearchResults(tabId, limit);
  }

  async openSearchResultsTabs(input: {
    tabId?: string;
    indices?: number[];
    limit?: number;
    activateFirst?: boolean;
  }): Promise<{ success: boolean; openedTabIds: string[]; urls: string[]; sourceResults: SearchResultCandidate[]; error: string | null }> {
    return this.pageAnalysis.openSearchResultsTabs(input);
  }

  async summarizeTabWorkingSet(tabIds?: string[]): Promise<Array<Record<string, unknown>>> {
    return this.pageAnalysis.summarizeTabWorkingSet(tabIds);
  }

  async extractPageEvidence(tabId?: string): Promise<PageEvidence | null> {
    return this.pageAnalysis.extractPageEvidence(tabId);
  }

  async compareTabs(tabIds?: string[]): Promise<Record<string, unknown>> {
    return this.pageAnalysis.compareTabs(tabIds);
  }

  async synthesizeResearchBrief(input?: { tabIds?: string[]; question?: string }): Promise<Record<string, unknown>> {
    return this.pageAnalysis.synthesizeResearchBrief(input);
  }

  async captureTabSnapshot(tabId?: string): Promise<BrowserSnapshot> {
    const entry = tabId ? this.tabs.get(tabId) : this.getActiveEntry();
    if (!entry) {
      return {
        id: generateId('snap'),
        tabId: tabId || '',
        capturedAt: Date.now(),
        url: '',
        title: '',
        mainHeading: '',
        visibleTextExcerpt: '',
        actionableElements: [],
        forms: [],
        viewport: {
          url: '',
          title: '',
          mainHeading: '',
          visibleTextExcerpt: '',
          modalPresent: false,
          foregroundUiType: 'none',
          foregroundUiLabel: '',
          foregroundUiSelector: '',
          foregroundUiConfidence: 0,
          activeSurfaceType: 'unknown',
          activeSurfaceLabel: '',
          activeSurfaceSelector: '',
          activeSurfaceConfidence: 0,
          isPrimarySurface: false,
          actionableCount: 0,
        },
      };
    }
    return this.perception.captureTabSnapshot(entry.id, this.getSiteStrategyForUrl(entry.info.navigation.url));
  }

  async getActionableElements(tabId?: string): Promise<BrowserActionableElement[]> {
    const entry = tabId ? this.tabs.get(tabId) : this.getActiveEntry();
    if (!entry) return [];
    return this.perception.getActionableElements(entry.id, this.getSiteStrategyForUrl(entry.info.navigation.url));
  }

  async getFormModel(tabId?: string): Promise<BrowserFormModel[]> {
    const entry = tabId ? this.tabs.get(tabId) : this.getActiveEntry();
    if (!entry) return [];
    return this.perception.getFormModel(entry.id, this.getSiteStrategyForUrl(entry.info.navigation.url));
  }

  private getSiteStrategyForUrl(rawUrl: string): BrowserSiteStrategy | null {
    try {
      const origin = new URL(rawUrl).origin;
      return this.siteStrategies.get(origin);
    } catch {
      return null;
    }
  }

  getSiteStrategy(origin: string): BrowserSiteStrategy | null {
    return this.siteStrategies.get(origin);
  }

  saveSiteStrategy(input: Partial<BrowserSiteStrategy> & { origin: string }): BrowserSiteStrategy {
    return this.siteStrategies.upsert(input);
  }

  async exportSurfaceEvalFixture(input: { name: string; tabId?: string }): Promise<BrowserSurfaceEvalFixture> {
    const entry = input.tabId ? this.tabs.get(input.tabId) : this.getActiveEntry();
    if (!entry) {
      throw new Error('No active tab');
    }
    const fixture = await this.perception.exportSurfaceEvalFixture(
      entry.id,
      input.name,
      this.getSiteStrategyForUrl(entry.info.navigation.url),
    );
    appendSurfaceFixture(fixture);
    return fixture;
  }

  private resolveEntry(tabId?: string): TabEntry | undefined {
    return tabId ? this.tabs.get(tabId) : this.getActiveEntry();
  }

  private rankActionableElements(
    snapshot: BrowserSnapshot,
    options?: { preferDismiss?: boolean },
  ): Array<BrowserActionableElement & { rankScore: number; rankReason: string }> {
    return this.pageAnalysis.rankActionableElements(snapshot, options);
  }

  async clickRankedAction(input: {
    tabId?: string;
    index?: number;
    actionId?: string;
    preferDismiss?: boolean;
  }): Promise<{
    success: boolean;
    clickedAction: (BrowserActionableElement & { rankScore?: number; rankReason?: string }) | null;
    error: string | null;
  }> {
    return this.overlayManager.clickRankedAction(input);
  }

  async waitForOverlayState(
    state: 'open' | 'closed',
    timeoutMs: number = 3000,
    tabId?: string,
  ): Promise<{
    success: boolean;
    state: 'open' | 'closed';
    observed: boolean;
    foregroundUiType: BrowserSnapshot['viewport']['foregroundUiType'];
    foregroundUiLabel: string;
    error: string | null;
  }> {
    return this.overlayManager.waitForOverlayState(state, timeoutMs, tabId);
  }

  async dismissForegroundUI(tabId?: string): Promise<{
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
  }> {
    return this.overlayManager.dismissForegroundUI(tabId);
  }

  async returnToPrimarySurface(tabId?: string): Promise<{
    success: boolean;
    restored: boolean;
    steps: string[];
    error: string | null;
  }> {
    return this.overlayManager.returnToPrimarySurface(tabId);
  }

  getConsoleEvents(tabId?: string, since?: number): BrowserConsoleEvent[] {
    return this.instrumentation.getConsoleEvents(tabId, since);
  }

  getNetworkEvents(tabId?: string, since?: number): BrowserNetworkEvent[] {
    return this.instrumentation.getNetworkEvents(tabId, since);
  }

  async recordTabFinding(input: {
    taskId: string;
    tabId?: string;
    title: string;
    summary: string;
    severity?: BrowserFinding['severity'];
    evidence?: string[];
    snapshotId?: string | null;
  }): Promise<BrowserFinding> {
    const entry = input.tabId ? this.tabs.get(input.tabId) : this.getActiveEntry();
    const tabId = entry?.id || input.tabId || '';
    const snapshotId = input.snapshotId === undefined
      ? (await this.captureTabSnapshot(tabId || undefined)).id
      : input.snapshotId;
    const finding: BrowserFinding = {
      id: generateId('finding'),
      taskId: input.taskId,
      tabId,
      snapshotId,
      title: input.title,
      summary: input.summary,
      severity: input.severity || 'info',
      evidence: input.evidence || [],
      createdAt: Date.now(),
    };
    taskMemoryStore.recordBrowserFinding(finding);
    return finding;
  }

  getTaskBrowserMemory(taskId: string): BrowserTaskMemory {
    const record = taskMemoryStore.get(taskId);
    const findings: BrowserFinding[] = [];
    const tabsTouched: string[] = [];
    const snapshotIds: string[] = [];
    let lastUpdatedAt: number | null = null;

    for (const entry of record.entries) {
      if (entry.kind !== 'browser_finding') continue;
      const meta = entry.metadata as Record<string, unknown> | undefined;
      const finding: BrowserFinding = {
        id: entry.id,
        taskId,
        tabId: typeof meta?.tabId === 'string' ? meta.tabId : '',
        snapshotId: typeof meta?.snapshotId === 'string' ? meta.snapshotId : null,
        title: entry.text.split(': ')[0] || '',
        summary: entry.text.split(': ').slice(1).join(': ') || entry.text,
        severity: (typeof meta?.severity === 'string' ? meta.severity : 'info') as BrowserFinding['severity'],
        evidence: Array.isArray(meta?.evidence) ? meta.evidence as string[] : [],
        createdAt: entry.createdAt,
      };
      findings.push(finding);
      if (finding.tabId && !tabsTouched.includes(finding.tabId)) tabsTouched.push(finding.tabId);
      if (finding.snapshotId && !snapshotIds.includes(finding.snapshotId)) snapshotIds.push(finding.snapshotId);
      if (lastUpdatedAt === null || finding.createdAt > lastUpdatedAt) lastUpdatedAt = finding.createdAt;
    }

    return { taskId, lastUpdatedAt, findings, tabsTouched, snapshotIds };
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.stopOAuthRelay();
    if (this.stateSyncTimer) {
      clearTimeout(this.stateSyncTimer);
      this.stateSyncTimer = null;
    }
    this.downloadManager.dispose();
    this.dialogManager.dispose();
    if (this.historyPersistTimer) clearTimeout(this.historyPersistTimer);
    this.persistNow();
    flushAll();

    for (const [, entry] of this.tabs) {
      this.destroyTabEntry(entry);
    }
    this.splitLeftTabId = null;
    this.splitRightTabId = null;
    this.tabs.clear();
    this.hostWindow = null;
  }

  private emitLog(level: 'info' | 'warn' | 'error', message: string): void {
    appStateStore.dispatch({
      type: ActionType.ADD_LOG,
      log: { id: generateId('log'), timestamp: Date.now(), level, source: 'browser', message },
    });
  }
}

export const browserService = new BrowserService();
