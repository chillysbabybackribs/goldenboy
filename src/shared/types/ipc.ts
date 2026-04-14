import { AppState, ExecutionLayoutPreset, LogLevel, LogSource, TaskStatus } from './appState';
import { AppEventType } from './events';
import { PhysicalWindowRole } from './windowRoles';
import { TerminalSessionInfo } from './terminal';
import { BrowserState, BrowserHistoryEntry, BrowserNavigationState, TabInfo, BookmarkEntry, ExtensionInfo, BrowserSettings, BrowserDownloadState, BrowserAuthDiagnostics } from './browser';
import { BrowserActionableElement, BrowserConsoleEvent, BrowserFinding, BrowserFormModel, BrowserNetworkEvent, BrowserSiteStrategy, BrowserSnapshot, BrowserSurfaceEvalFixture, BrowserTaskMemory } from './browserIntelligence';
import { SurfaceActionInput, SurfaceActionRecord, SurfaceActionKind } from '../actions/surfaceActionTypes';
import { AgentInvocationOptions, TaskMemoryRecord } from './model';

export const IPC_CHANNELS = {
  GET_STATE: 'workspace:get-state',
  GET_ROLE: 'workspace:get-role',
  EMIT_EVENT: 'workspace:emit-event',
  STATE_UPDATE: 'workspace:state-update',
  EVENT_BROADCAST: 'workspace:event-broadcast',
  CREATE_TASK: 'workspace:create-task',
  DELETE_TASK: 'workspace:delete-task',
  UPDATE_TASK_STATUS: 'workspace:update-task-status',
  SET_ACTIVE_TASK: 'workspace:set-active-task',
  RESET_TOKEN_USAGE: 'workspace:reset-token-usage',
  ADD_LOG: 'workspace:add-log',

  // Execution split control (replaces old layout channels)
  APPLY_EXECUTION_PRESET: 'workspace:apply-execution-preset',
  SET_SPLIT_RATIO: 'workspace:set-split-ratio',

  // Surface action channels
  SUBMIT_SURFACE_ACTION: 'workspace:submit-surface-action',
  CANCEL_QUEUED_ACTION: 'workspace:cancel-queued-action',
  GET_RECENT_ACTIONS: 'workspace:get-recent-actions',
  GET_ACTIONS_BY_TARGET: 'workspace:get-actions-by-target',
  GET_ACTIONS_BY_TASK: 'workspace:get-actions-by-task',
  GET_QUEUE_DIAGNOSTICS: 'workspace:get-queue-diagnostics',
  SURFACE_ACTION_UPDATE: 'workspace:surface-action-update',

  // Browser runtime channels (queries, management, UI features)
  BROWSER_GET_STATE: 'browser:get-state',
  BROWSER_GET_HISTORY: 'browser:get-history',
  BROWSER_CLEAR_HISTORY: 'browser:clear-history',
  BROWSER_CLEAR_DATA: 'browser:clear-data',
  BROWSER_CLEAR_SITE_DATA: 'browser:clear-site-data',
  BROWSER_REPORT_BOUNDS: 'browser:report-bounds',
  BROWSER_GET_TABS: 'browser:get-tabs',
  BROWSER_CAPTURE_TAB_SNAPSHOT: 'browser:capture-tab-snapshot',
  BROWSER_GET_ACTIONABLE_ELEMENTS: 'browser:get-actionable-elements',
  BROWSER_GET_FORM_MODEL: 'browser:get-form-model',
  BROWSER_GET_CONSOLE_EVENTS: 'browser:get-console-events',
  BROWSER_GET_NETWORK_EVENTS: 'browser:get-network-events',
  BROWSER_RECORD_FINDING: 'browser:record-finding',
  BROWSER_GET_TASK_MEMORY: 'browser:get-task-memory',
  BROWSER_GET_SITE_STRATEGY: 'browser:get-site-strategy',
  BROWSER_SAVE_SITE_STRATEGY: 'browser:save-site-strategy',
  BROWSER_EXPORT_SURFACE_EVAL_FIXTURE: 'browser:export-surface-eval-fixture',

  // Bookmarks
  BROWSER_ADD_BOOKMARK: 'browser:add-bookmark',
  BROWSER_REMOVE_BOOKMARK: 'browser:remove-bookmark',
  BROWSER_GET_BOOKMARKS: 'browser:get-bookmarks',
  BROWSER_SPLIT_TAB: 'browser:split-tab',
  BROWSER_CLEAR_SPLIT_VIEW: 'browser:clear-split-view',

  // Zoom
  BROWSER_ZOOM_IN: 'browser:zoom-in',
  BROWSER_ZOOM_OUT: 'browser:zoom-out',
  BROWSER_ZOOM_RESET: 'browser:zoom-reset',

  // Find in page
  BROWSER_FIND_IN_PAGE: 'browser:find-in-page',
  BROWSER_FIND_NEXT: 'browser:find-next',
  BROWSER_FIND_PREVIOUS: 'browser:find-previous',
  BROWSER_STOP_FIND: 'browser:stop-find',

  // DevTools
  BROWSER_TOGGLE_DEVTOOLS: 'browser:toggle-devtools',

  // Settings
  BROWSER_GET_SETTINGS: 'browser:get-settings',
  BROWSER_UPDATE_SETTINGS: 'browser:update-settings',
  BROWSER_GET_AUTH_DIAGNOSTICS: 'browser:get-auth-diagnostics',
  BROWSER_CLEAR_GOOGLE_AUTH_STATE: 'browser:clear-google-auth-state',

  // Extensions
  BROWSER_LOAD_EXTENSION: 'browser:load-extension',
  BROWSER_REMOVE_EXTENSION: 'browser:remove-extension',
  BROWSER_GET_EXTENSIONS: 'browser:get-extensions',

  // Downloads
  BROWSER_GET_DOWNLOADS: 'browser:get-downloads',
  BROWSER_CANCEL_DOWNLOAD: 'browser:cancel-download',
  BROWSER_CLEAR_DOWNLOADS: 'browser:clear-downloads',

  // Browser state push channels (main -> renderer)
  BROWSER_STATE_UPDATE: 'browser:state-update',
  BROWSER_NAV_UPDATE: 'browser:nav-update',
  BROWSER_FIND_UPDATE: 'browser:find-update',

  // Debug: disk cache test
  DEBUG_TEST_DISK_EXTRACT: 'debug:test-disk-extract',

  // Model channels
  MODEL_INVOKE: 'model:invoke',
  MODEL_CANCEL: 'model:cancel',
  MODEL_GET_PROVIDERS: 'model:get-providers',
  MODEL_GET_TASK_MEMORY: 'model:get-task-memory',
  MODEL_RESOLVE: 'model:resolve',
  MODEL_HANDOFF: 'model:handoff',
  MODEL_RUN_INTENT_PROGRAM: 'model:run-intent-program',
  MODEL_PROGRESS: 'model:progress',

  // Terminal session channels
  TERMINAL_START_SESSION: 'terminal:start-session',
  TERMINAL_GET_SESSION: 'terminal:get-session',
  TERMINAL_WRITE: 'terminal:write',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_OUTPUT: 'terminal:output',
  TERMINAL_STATUS: 'terminal:status',
  TERMINAL_EXIT: 'terminal:exit',
  TERMINAL_CAPTURE_SCROLLBACK: 'terminal:capture-scrollback',
} as const;

export interface WorkspaceAPI {
  getState(): Promise<AppState>;
  getRole(): Promise<PhysicalWindowRole>;

  createTask(title: string): Promise<{ id: string; title: string }>;
  deleteTask(taskId: string): Promise<void>;
  updateTaskStatus(taskId: string, status: TaskStatus): Promise<void>;
  setActiveTask(taskId: string | null): Promise<void>;
  resetTokenUsage(): Promise<void>;

  addLog(level: LogLevel, source: LogSource, message: string, taskId?: string): Promise<void>;

  // Execution split control
  applyExecutionPreset(preset: ExecutionLayoutPreset): Promise<void>;
  setSplitRatio(ratio: number): Promise<void>;

  // Surface actions
  actions: {
    submit(input: SurfaceActionInput): Promise<SurfaceActionRecord>;
    cancelQueued(actionId: string): Promise<SurfaceActionRecord>;
    listRecent(limit?: number): Promise<SurfaceActionRecord[]>;
    listByTarget(target: 'browser' | 'terminal', limit?: number): Promise<SurfaceActionRecord[]>;
    listByTask(taskId: string): Promise<SurfaceActionRecord[]>;
    getQueueDiagnostics(): Promise<{ browser: { active: string | null; queueLength: number }; terminal: { active: string | null; queueLength: number } }>;
    onUpdate(callback: (record: SurfaceActionRecord) => void): void;
  };

  onStateUpdate(callback: (state: AppState) => void): void;
  onEvent(callback: (type: AppEventType, payload: unknown) => void): void;

  // Browser runtime API (queries, management, UI features, subscriptions)
  browser: {
    getState(): Promise<BrowserState>;
    getHistory(): Promise<BrowserHistoryEntry[]>;
    clearHistory(): Promise<void>;
    clearData(): Promise<void>;
    clearSiteData(origin?: string): Promise<{ origin: string; cookiesCleared: number }>;
    reportBounds(bounds: { x: number; y: number; width: number; height: number }): Promise<void>;
    getTabs(): Promise<TabInfo[]>;
    captureTabSnapshot(tabId?: string): Promise<BrowserSnapshot>;
    getActionableElements(tabId?: string): Promise<BrowserActionableElement[]>;
    getFormModel(tabId?: string): Promise<BrowserFormModel[]>;
    getConsoleEvents(tabId?: string, since?: number): Promise<BrowserConsoleEvent[]>;
    getNetworkEvents(tabId?: string, since?: number): Promise<BrowserNetworkEvent[]>;
    recordFinding(input: { taskId: string; tabId?: string; title: string; summary: string; severity?: BrowserFinding['severity']; evidence?: string[]; snapshotId?: string | null }): Promise<BrowserFinding>;
    getTaskMemory(taskId: string): Promise<BrowserTaskMemory>;
    getSiteStrategy(origin: string): Promise<BrowserSiteStrategy | null>;
    saveSiteStrategy(input: Partial<BrowserSiteStrategy> & { origin: string }): Promise<BrowserSiteStrategy>;
    exportSurfaceEvalFixture(input: { name: string; tabId?: string }): Promise<BrowserSurfaceEvalFixture>;
    // Bookmarks
    addBookmark(url: string, title: string): Promise<BookmarkEntry>;
    removeBookmark(bookmarkId: string): Promise<void>;
    getBookmarks(): Promise<BookmarkEntry[]>;
    // Zoom
    zoomIn(): Promise<void>;
    zoomOut(): Promise<void>;
    zoomReset(): Promise<void>;
    // Find in page
    findInPage(query: string): Promise<void>;
    findNext(): Promise<void>;
    findPrevious(): Promise<void>;
    stopFind(): Promise<void>;
    // DevTools
    toggleDevTools(): Promise<void>;
    // Settings
    getSettings(): Promise<BrowserSettings>;
    updateSettings(settings: Partial<BrowserSettings>): Promise<void>;
    getAuthDiagnostics(): Promise<BrowserAuthDiagnostics>;
    clearGoogleAuthState(): Promise<{ cleared: number }>;
    // Extensions
    loadExtension(path: string): Promise<ExtensionInfo | null>;
    removeExtension(extensionId: string): Promise<void>;
    getExtensions(): Promise<ExtensionInfo[]>;
    // Downloads
    getDownloads(): Promise<BrowserDownloadState[]>;
    cancelDownload(downloadId: string): Promise<void>;
    clearDownloads(): Promise<void>;
    splitTab(tabId?: string): Promise<TabInfo>;
    clearSplitView(): Promise<void>;
    // Cookie sync
    reimportCookies(): Promise<{ imported: number; failed: number; domains: string[] }>;
    // Subscriptions
    onStateUpdate(callback: (state: BrowserState) => void): void;
    onNavUpdate(callback: (nav: BrowserNavigationState) => void): void;
    onFindUpdate(callback: (find: { activeMatch: number; totalMatches: number }) => void): void;
  };

  // Model API (invocation, routing, handoff)
  model: {
    invoke(taskId: string, prompt: string, owner?: string, options?: AgentInvocationOptions): Promise<any>;
    cancel(taskId: string): Promise<boolean>;
    getProviders(): Promise<Record<string, any>>;
    getTaskMemory(taskId: string): Promise<TaskMemoryRecord>;
    resolve(prompt: string, explicitOwner?: string, options?: AgentInvocationOptions): Promise<string>;
    handoff(taskId: string, from: string, to: string): Promise<any>;
    runIntentProgram(taskId: string, input: { instructions: Array<Record<string, unknown>>; tabId?: string; failFast?: boolean }): Promise<any>;
    onProgress(callback: (progress: any) => void): void;
  };

  // Terminal session API (raw PTY I/O, queries, subscriptions)
  terminal: {
    startSession(cols?: number, rows?: number): Promise<TerminalSessionInfo>;
    getSession(): Promise<TerminalSessionInfo | null>;
    write(data: string): Promise<void>;
    resize(cols: number, rows: number): Promise<void>;
    captureScrollback(): Promise<string>;
    onOutput(callback: (data: string) => void): void;
    onStatus(callback: (session: TerminalSessionInfo) => void): void;
    onExit(callback: (exitCode: number) => void): void;
  };

  removeAllListeners(): void;
}
