// ═══════════════════════════════════════════════════════════════════════════
// Browser Service — Multi-tab browser runtime with full feature set
// ═══════════════════════════════════════════════════════════════════════════
//
// Manages multiple tabs (each a WebContentsView), bookmarks, extensions,
// settings, zoom, find-in-page, downloads, and permissions.

import { BrowserWindow, WebContentsView, session, DownloadItem, Event as ElectronEvent, Menu, MenuItem, clipboard } from 'electron';
import * as path from 'path';
import {
  BrowserState, BrowserNavigationState, BrowserSurfaceStatus,
  BrowserHistoryEntry, BrowserDownloadState, BrowserPermissionRequest,
  BrowserErrorInfo, BrowserProfile, TabInfo, BookmarkEntry, ExtensionInfo,
  FindInPageState, BrowserSettings, BrowserAuthDiagnostics,
  BrowserJavaScriptDialog, BrowserJavaScriptDialogType,
  createDefaultBrowserState, createDefaultSettings,
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
import { createDownloadEntry, resolveDownloadPath } from './browserDownloads';
import { importChromeCookies, isChromeAvailable, promptCookieImport } from './chromeCookieImporter';
import { BrowserInstrumentation } from './BrowserInstrumentation';
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

const PROFILE_ID = 'workspace-browser';
const PARTITION = 'persist:workspace-browser';
const MAX_HISTORY = 2000;
const MAX_RECENT_PERMISSIONS = 50;
const HISTORY_PERSIST_DEBOUNCE = 2000;
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

type TabEntry = {
  id: string;
  view: WebContentsView;
  info: TabInfo;
};

type PromptDialogResolution = {
  dialogId: string;
  resolved: boolean;
  value: string | null;
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
  private hostWindow: BrowserWindow | null = null;
  private profile: BrowserProfile;
  private history: BrowserHistoryEntry[] = [];
  private bookmarks: BookmarkEntry[] = [];
  private activeDownloads: Map<string, { entry: BrowserDownloadState; item: DownloadItem }> = new Map();
  private completedDownloads: BrowserDownloadState[] = [];
  private recentPermissions: BrowserPermissionRequest[] = [];
  private pendingDialogs: Map<string, BrowserJavaScriptDialog> = new Map();
  private promptDialogResolutions: Map<string, PromptDialogResolution> = new Map();
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
  private instrumentation = new BrowserInstrumentation();
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

    ses.on('will-download', (_event: ElectronEvent, item: DownloadItem) => {
      const filename = item.getFilename();
      const savePath = resolveDownloadPath(filename);
      item.setSavePath(savePath);
      const entry = createDownloadEntry(item.getURL(), filename, savePath);
      this.activeDownloads.set(entry.id, { entry, item });
      eventBus.emit(AppEventType.BROWSER_DOWNLOAD_STARTED, { download: { ...entry } });
      this.emitLog('info', `Download started: ${filename}`);
      this.syncState();

      item.on('updated', (_e: ElectronEvent, state: string) => {
        entry.receivedBytes = item.getReceivedBytes();
        entry.totalBytes = item.getTotalBytes();
        entry.state = state === 'progressing' ? 'progressing' : 'interrupted';
        eventBus.emit(AppEventType.BROWSER_DOWNLOAD_UPDATED, { download: { ...entry } });
        this.syncState();
      });

      item.once('done', (_e: ElectronEvent, state: string) => {
        entry.receivedBytes = item.getReceivedBytes();
        entry.totalBytes = item.getTotalBytes();
        entry.state = state === 'completed' ? 'completed' : 'cancelled';
        eventBus.emit(AppEventType.BROWSER_DOWNLOAD_COMPLETED, { download: { ...entry } });
        this.emitLog(entry.state === 'completed' ? 'info' : 'warn', `Download ${entry.state}: ${filename}`);
        this.activeDownloads.delete(entry.id);
        this.completedDownloads.push({ ...entry });
        if (this.completedDownloads.length > 100) this.completedDownloads = this.completedDownloads.slice(-100);
        this.syncState();
      });
    });
  }

  // ─── Tab Management ──────────────────────────────────────────────────────

  createTab(url?: string): TabInfo {
    const tab = this.createTabInternal(url || this.settings.homepage, true);
    this.activateTabInternal(tab.id);
    this.syncState();
    return tab.info;
  }

  private createTabInternal(url: string, notify: boolean): TabEntry {
    if (!this.hostWindow || !this.sessionInstance) throw new Error('Browser not initialized');
    const id = generateId('tab');

    const view = new WebContentsView({
      webPreferences: {
        session: this.sessionInstance,
        preload: getBrowserTabPreloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        spellcheck: true,
        javascript: this.settings.javascript,
        images: this.settings.images,
      },
    });

    const currentUserAgent = view.webContents.getUserAgent();
    const effectiveUserAgent = sanitizeBrowserUserAgent(currentUserAgent);
    if (effectiveUserAgent && effectiveUserAgent !== currentUserAgent) {
      view.webContents.setUserAgent(effectiveUserAgent);
    }

    // Set zoom from settings
    view.webContents.setZoomFactor(this.settings.defaultZoom);

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

    this.wireTabEvents(entry);
    this.instrumentation.attachTab(id, view.webContents);
    this.attachDialogDebugger(entry);

    // Don't add to contentView yet — only the active tab is visible
    if (url && url !== 'about:blank') {
      this.navigateTab(id, url);
    }

    if (notify) {
      eventBus.emit(AppEventType.BROWSER_TAB_CREATED, { tab: { ...info } });
      this.emitLog('info', `New tab created`);
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

    // Remove from contentView and destroy
    if (this.hostWindow && !this.hostWindow.isDestroyed()) {
      try { this.hostWindow.contentView.removeChildView(entry.view); } catch {}
    }
    this.instrumentation.detachTab(tabId, entry.view.webContents.id);
    this.clearPendingDialogsForTab(tabId);
    try { if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close(); } catch {}
    this.tabs.delete(tabId);

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

    // Hide current active tab
    if (this.activeTabId && this.activeTabId !== tabId) {
      const prev = this.tabs.get(this.activeTabId);
      if (prev && this.hostWindow && !this.hostWindow.isDestroyed()) {
        try { this.hostWindow.contentView.removeChildView(prev.view); } catch {}
      }
    }

    // Show new active tab
    this.activeTabId = tabId;
    this.hostWindow.contentView.addChildView(entry.view);
    entry.view.setBounds({
      x: Math.round(this.currentBounds.x),
      y: Math.round(this.currentBounds.y),
      width: Math.round(Math.max(1, this.currentBounds.width)),
      height: Math.round(Math.max(1, this.currentBounds.height)),
    });

    // Update find state to match active tab
    this.findState = { active: false, query: '', activeMatch: 0, totalMatches: 0 };

    eventBus.emit(AppEventType.BROWSER_TAB_ACTIVATED, { tabId });
  }

  getTabs(): TabInfo[] {
    return Array.from(this.tabs.values()).map(e => ({ ...e.info }));
  }

  private getActiveEntry(): TabEntry | undefined {
    return this.tabs.get(this.activeTabId);
  }

  private wireTabEvents(entry: TabEntry): void {
    const wc = entry.view.webContents;
    const info = entry.info;
    const nav = info.navigation;

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

      // Auto-cache cleaned page knowledge for token-efficient retrieval.
      this.cachePageKnowledge(entry.id).catch(() => {});

      // Auto-extract to disk if disk cache is active
      if (this.diskCache && this.activeTaskId) {
        this.extractToDisk(entry.id).catch(() => {});
      }
    });

    wc.on('did-navigate', (_e: ElectronEvent, url: string) => {
      this.clearPendingDialogsForTab(entry.id);
      nav.url = url;
      nav.canGoBack = wc.navigationHistory.canGoBack();
      nav.canGoForward = wc.navigationHistory.canGoForward();
      nav.lastNavigationAt = Date.now();
      this.addHistoryEntry(url, nav.title, nav.favicon);
      this.syncTabAndMaybeNavigation(entry);
      void this.handleGoogleAuthNavigation(entry, url);
    });

    wc.on('did-navigate-in-page', (_e: ElectronEvent, url: string) => {
      this.clearPendingDialogsForTab(entry.id);
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
          click: () => this.createTab(params.linkURL),
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
          click: () => this.createTab(params.srcURL),
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

    wc.setWindowOpenHandler(({ url }) => {
      // Open in new tab
      this.createTab(url);
      return { action: 'deny' };
    });
  }

  private attachDialogDebugger(entry: TabEntry): void {
    const wc = entry.view.webContents;
    const dbg = wc.debugger;
    try {
      if (!dbg.isAttached()) {
        dbg.attach('1.3');
      }
      void dbg.sendCommand('Page.enable').catch(() => {});
    } catch (err) {
      this.emitLog('warn', `Browser dialog debugger unavailable: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    dbg.on('detach', () => {
      for (const [id, dialog] of this.pendingDialogs.entries()) {
        if (dialog.tabId === entry.id) this.pendingDialogs.delete(id);
      }
      this.syncState();
    });

    dbg.on('message', (_event, method: string, params: any) => {
      if (method === 'Page.javascriptDialogClosed') {
        this.clearPendingDialogsForTab(entry.id);
        return;
      }
      if (method !== 'Page.javascriptDialogOpening') return;
      const type = this.normalizeJavaScriptDialogType(params?.type);
      const dialog: BrowserJavaScriptDialog = {
        id: generateId('dialog'),
        tabId: entry.id,
        url: typeof params?.url === 'string' ? params.url : entry.info.navigation.url,
        type,
        backend: 'cdp',
        message: typeof params?.message === 'string' ? params.message : '',
        defaultPrompt: typeof params?.defaultPrompt === 'string' ? params.defaultPrompt : '',
        openedAt: Date.now(),
      };
      this.pendingDialogs.set(dialog.id, dialog);
      this.emitLog('info', `JavaScript ${dialog.type} dialog opened: ${dialog.message || '(empty)'}`);
      this.syncState();
    });
  }

  private normalizeJavaScriptDialogType(value: unknown): BrowserJavaScriptDialogType {
    switch (value) {
      case 'alert':
      case 'confirm':
      case 'prompt':
      case 'beforeunload':
        return value;
      default:
        return 'unknown';
    }
  }

  private clearPendingDialogsForTab(tabId: string): void {
    let changed = false;
    for (const [id, dialog] of this.pendingDialogs.entries()) {
      if (dialog.tabId !== tabId) continue;
      this.pendingDialogs.delete(id);
      const resolution = this.promptDialogResolutions.get(id);
      if (resolution && !resolution.resolved) {
        resolution.resolved = true;
        resolution.value = null;
      }
      changed = true;
    }
    if (changed) this.syncState();
  }

  private resolveTabIdByWebContentsId(webContentsId: number): string | null {
    for (const [tabId, entry] of this.tabs.entries()) {
      if (entry.view.webContents.id === webContentsId) return tabId;
    }
    return null;
  }

  private syncTabAndMaybeNavigation(entry: TabEntry): void {
    eventBus.emit(AppEventType.BROWSER_TAB_UPDATED, { tab: { ...entry.info } });
    if (entry.id === this.activeTabId) {
      this.syncNavigation();
    }
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

  // ─── Navigation ──────────────────────────────────────────────────────────

  navigate(url: string): void {
    this.navigateTab(this.activeTabId, url);
  }

  private navigateTab(tabId: string, url: string): void {
    const entry = this.tabs.get(tabId);
    if (!entry) return;
    const normalized = normalizeNavigationTarget(url, {
      searchEngine: this.settings.searchEngine,
      cwd: process.cwd(),
    });
    entry.info.navigation.url = normalized.url;
    entry.view.webContents.loadURL(normalized.url);
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
    entry.view.webContents.on('found-in-page', (_e: ElectronEvent, result: Electron.FoundInPageResult) => {
      this.findState.activeMatch = result.activeMatchOrdinal;
      this.findState.totalMatches = result.matches;
      this.broadcastFind();
    });
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
    this.clearHistory();
    this.emitLog('info', 'Browser data cleared (cache, storage, history)');
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

  getDownloads(): BrowserDownloadState[] {
    const active = Array.from(this.activeDownloads.values()).map(d => ({ ...d.entry }));
    return [...active, ...this.completedDownloads];
  }

  cancelDownload(downloadId: string): void {
    const dl = this.activeDownloads.get(downloadId);
    if (dl) {
      dl.item.cancel();
      this.activeDownloads.delete(downloadId);
      this.syncState();
    }
  }

  clearDownloads(): void {
    this.completedDownloads = [];
    this.syncState();
  }

  // ─── Bounds ──────────────────────────────────────────────────────────────

  setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.currentBounds = bounds;
    const entry = this.getActiveEntry();
    if (entry) {
      entry.view.setBounds({
        x: Math.round(bounds.x), y: Math.round(bounds.y),
        width: Math.round(Math.max(1, bounds.width)),
        height: Math.round(Math.max(1, bounds.height)),
      });
    }
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
      history: this.getRecentHistory(),
      bookmarks: [...this.bookmarks],
      activeDownloads: Array.from(this.activeDownloads.values()).map(d => ({ ...d.entry })),
      completedDownloads: [...this.completedDownloads],
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
    const state = this.getState();
    appStateStore.dispatch({ type: ActionType.SET_BROWSER_RUNTIME, browserRuntime: state });
    eventBus.emit(AppEventType.BROWSER_STATE_CHANGED, { state });
    eventBus.emit(AppEventType.BROWSER_STATUS_UPDATED, {
      status: state.surfaceStatus,
      detail: state.navigation.url,
    });
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
    return this.pageInteraction.hoverElement(selector, tabId);
  }

  getPendingDialogs(tabId?: string): BrowserJavaScriptDialog[] {
    const dialogs = Array.from(this.pendingDialogs.values());
    return tabId ? dialogs.filter(dialog => dialog.tabId === tabId) : dialogs;
  }

  openPromptDialogFallback(input: {
    webContentsId: number;
    message: string;
    defaultPrompt?: string;
    url?: string;
  }): { dialogId: string; created: boolean } {
    const tabId = this.resolveTabIdByWebContentsId(input.webContentsId);
    if (!tabId) {
      return { dialogId: '', created: false };
    }

    const existing = this.getPendingDialogs(tabId).find(dialog => dialog.type === 'prompt' && dialog.backend === 'shim');
    if (existing) {
      return { dialogId: existing.id, created: false };
    }

    const dialog: BrowserJavaScriptDialog = {
      id: generateId('dialog'),
      tabId,
      url: input.url || this.tabs.get(tabId)?.info.navigation.url || '',
      type: 'prompt',
      backend: 'shim',
      message: input.message || '',
      defaultPrompt: input.defaultPrompt || '',
      openedAt: Date.now(),
    };
    this.pendingDialogs.set(dialog.id, dialog);
    this.promptDialogResolutions.set(dialog.id, {
      dialogId: dialog.id,
      resolved: false,
      value: null,
    });
    this.emitLog('info', `JavaScript prompt dialog opened via shim: ${dialog.message || '(empty)'}`);
    this.syncState();
    return { dialogId: dialog.id, created: true };
  }

  pollPromptDialogFallback(dialogId: string): { done: boolean; value: string | null } {
    const resolution = this.promptDialogResolutions.get(dialogId);
    if (!resolution) {
      return { done: true, value: null };
    }
    if (resolution.resolved) {
      this.promptDialogResolutions.delete(dialogId);
      return { done: true, value: resolution.value };
    }
    return {
      done: false,
      value: null,
    };
  }

  async acceptDialog(input: {
    tabId?: string;
    dialogId?: string;
    promptText?: string;
  } = {}): Promise<{ accepted: boolean; error: string | null; dialog: BrowserJavaScriptDialog | null }> {
    return this.resolveJavaScriptDialog({ ...input, accept: true });
  }

  async dismissDialog(input: {
    tabId?: string;
    dialogId?: string;
  } = {}): Promise<{ dismissed: boolean; error: string | null; dialog: BrowserJavaScriptDialog | null }> {
    const result = await this.resolveJavaScriptDialog({ ...input, accept: false });
    return { dismissed: result.accepted, error: result.error, dialog: result.dialog };
  }

  private async resolveJavaScriptDialog(input: {
    accept: boolean;
    tabId?: string;
    dialogId?: string;
    promptText?: string;
  }): Promise<{ accepted: boolean; error: string | null; dialog: BrowserJavaScriptDialog | null }> {
    const dialog = input.dialogId
      ? this.pendingDialogs.get(input.dialogId) || null
      : this.getPendingDialogs(input.tabId || this.activeTabId)[0] || null;
    const entry = this.resolveEntry(dialog?.tabId || input.tabId || this.activeTabId);
    if (!entry) {
      return { accepted: false, error: 'No active tab', dialog };
    }
    try {
      if (dialog?.backend === 'shim' && dialog.type === 'prompt') {
        const resolution = this.promptDialogResolutions.get(dialog.id);
        if (!resolution) {
          return { accepted: false, error: 'Prompt dialog resolution missing', dialog };
        }
        resolution.resolved = true;
        resolution.value = input.accept ? (input.promptText ?? dialog.defaultPrompt ?? '') : null;
        this.pendingDialogs.delete(dialog.id);
        this.syncState();
        return { accepted: true, error: null, dialog };
      }
      if (!entry.view.webContents.debugger.isAttached()) {
        entry.view.webContents.debugger.attach('1.3');
        await entry.view.webContents.debugger.sendCommand('Page.enable');
      }
      await entry.view.webContents.debugger.sendCommand('Page.handleJavaScriptDialog', {
        accept: input.accept,
        promptText: input.promptText || '',
      });
      if (dialog) this.pendingDialogs.delete(dialog.id);
      else this.clearPendingDialogsForTab(entry.id);
      this.syncState();
      return { accepted: true, error: null, dialog };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { accepted: false, error: message, dialog };
    }
  }

  async typeInElement(
    selector: string,
    text: string,
    tabId?: string,
  ): Promise<{ typed: boolean; error: string | null }> {
    return this.pageInteraction.typeInElement(selector, text, tabId);
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

    if (this.historyPersistTimer) clearTimeout(this.historyPersistTimer);
    this.persistNow();
    flushAll();

    for (const [, entry] of this.tabs) {
      if (this.hostWindow && !this.hostWindow.isDestroyed()) {
        try { this.hostWindow.contentView.removeChildView(entry.view); } catch {}
      }
      entry.view.webContents.close();
    }
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
