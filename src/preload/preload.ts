import { contextBridge, ipcRenderer } from 'electron';
import type { AgentInvocationOptions } from '../shared/types/model';

const IPC_CHANNELS = {
  GET_STATE: 'workspace:get-state',
  GET_ROLE: 'workspace:get-role',
  EMIT_EVENT: 'workspace:emit-event',
  STATE_UPDATE: 'workspace:state-update',
  EVENT_BROADCAST: 'workspace:event-broadcast',
  CREATE_TASK: 'workspace:create-task',
  UPDATE_TASK_STATUS: 'workspace:update-task-status',
  SET_ACTIVE_TASK: 'workspace:set-active-task',
  RESET_TOKEN_USAGE: 'workspace:reset-token-usage',
  ADD_LOG: 'workspace:add-log',

  APPLY_EXECUTION_PRESET: 'workspace:apply-execution-preset',
  SET_SPLIT_RATIO: 'workspace:set-split-ratio',

  SUBMIT_SURFACE_ACTION: 'workspace:submit-surface-action',
  CANCEL_QUEUED_ACTION: 'workspace:cancel-queued-action',
  GET_RECENT_ACTIONS: 'workspace:get-recent-actions',
  GET_ACTIONS_BY_TARGET: 'workspace:get-actions-by-target',
  GET_ACTIONS_BY_TASK: 'workspace:get-actions-by-task',
  GET_QUEUE_DIAGNOSTICS: 'workspace:get-queue-diagnostics',
  SURFACE_ACTION_UPDATE: 'workspace:surface-action-update',

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
  BROWSER_ADD_BOOKMARK: 'browser:add-bookmark',
  BROWSER_REMOVE_BOOKMARK: 'browser:remove-bookmark',
  BROWSER_GET_BOOKMARKS: 'browser:get-bookmarks',
  BROWSER_SPLIT_TAB: 'browser:split-tab',
  BROWSER_CLEAR_SPLIT_VIEW: 'browser:clear-split-view',
  BROWSER_ZOOM_IN: 'browser:zoom-in',
  BROWSER_ZOOM_OUT: 'browser:zoom-out',
  BROWSER_ZOOM_RESET: 'browser:zoom-reset',
  BROWSER_FIND_IN_PAGE: 'browser:find-in-page',
  BROWSER_FIND_NEXT: 'browser:find-next',
  BROWSER_FIND_PREVIOUS: 'browser:find-previous',
  BROWSER_STOP_FIND: 'browser:stop-find',
  BROWSER_TOGGLE_DEVTOOLS: 'browser:toggle-devtools',
  BROWSER_GET_SETTINGS: 'browser:get-settings',
  BROWSER_UPDATE_SETTINGS: 'browser:update-settings',
  BROWSER_GET_AUTH_DIAGNOSTICS: 'browser:get-auth-diagnostics',
  BROWSER_CLEAR_GOOGLE_AUTH_STATE: 'browser:clear-google-auth-state',
  BROWSER_LOAD_EXTENSION: 'browser:load-extension',
  BROWSER_REMOVE_EXTENSION: 'browser:remove-extension',
  BROWSER_GET_EXTENSIONS: 'browser:get-extensions',
  BROWSER_GET_DOWNLOADS: 'browser:get-downloads',
  BROWSER_CANCEL_DOWNLOAD: 'browser:cancel-download',
  BROWSER_CLEAR_DOWNLOADS: 'browser:clear-downloads',
  BROWSER_STATE_UPDATE: 'browser:state-update',
  BROWSER_NAV_UPDATE: 'browser:nav-update',
  BROWSER_FIND_UPDATE: 'browser:find-update',
  DEBUG_TEST_DISK_EXTRACT: 'debug:test-disk-extract',

  MODEL_INVOKE: 'model:invoke',
  MODEL_CANCEL: 'model:cancel',
  MODEL_GET_PROVIDERS: 'model:get-providers',
  MODEL_GET_TASK_MEMORY: 'model:get-task-memory',
  MODEL_RESOLVE: 'model:resolve',
  MODEL_HANDOFF: 'model:handoff',
  MODEL_RUN_INTENT_PROGRAM: 'model:run-intent-program',
  MODEL_PROGRESS: 'model:progress',

  TERMINAL_START_SESSION: 'terminal:start-session',
  TERMINAL_GET_SESSION: 'terminal:get-session',
  TERMINAL_WRITE: 'terminal:write',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_OUTPUT: 'terminal:output',
  TERMINAL_STATUS: 'terminal:status',
  TERMINAL_EXIT: 'terminal:exit',
  TERMINAL_CAPTURE_SCROLLBACK: 'terminal:capture-scrollback',
} as const;

const api = {
  getState() {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_STATE);
  },

  getRole() {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_ROLE);
  },

  createTask(title: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.CREATE_TASK, title);
  },

  updateTaskStatus(taskId: string, status: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.UPDATE_TASK_STATUS, taskId, status);
  },

  setActiveTask(taskId: string | null) {
    return ipcRenderer.invoke(IPC_CHANNELS.SET_ACTIVE_TASK, taskId);
  },

  resetTokenUsage() {
    return ipcRenderer.invoke(IPC_CHANNELS.RESET_TOKEN_USAGE);
  },

  addLog(level: string, source: string, message: string, taskId?: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.ADD_LOG, level, source, message, taskId);
  },

  // Execution split control
  applyExecutionPreset(preset: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.APPLY_EXECUTION_PRESET, preset);
  },

  setSplitRatio(ratio: number) {
    return ipcRenderer.invoke(IPC_CHANNELS.SET_SPLIT_RATIO, ratio);
  },

  // ── Surface actions (single authoritative execution path) ───────────────

  actions: {
    submit(input: any) {
      return ipcRenderer.invoke(IPC_CHANNELS.SUBMIT_SURFACE_ACTION, input);
    },
    cancelQueued(actionId: string) {
      return ipcRenderer.invoke(IPC_CHANNELS.CANCEL_QUEUED_ACTION, actionId);
    },
    listRecent(limit?: number) {
      return ipcRenderer.invoke(IPC_CHANNELS.GET_RECENT_ACTIONS, limit);
    },
    listByTarget(target: string, limit?: number) {
      return ipcRenderer.invoke(IPC_CHANNELS.GET_ACTIONS_BY_TARGET, target, limit);
    },
    listByTask(taskId: string) {
      return ipcRenderer.invoke(IPC_CHANNELS.GET_ACTIONS_BY_TASK, taskId);
    },
    getQueueDiagnostics() {
      return ipcRenderer.invoke(IPC_CHANNELS.GET_QUEUE_DIAGNOSTICS);
    },
    onUpdate(callback: (record: any) => void) {
      ipcRenderer.on(IPC_CHANNELS.SURFACE_ACTION_UPDATE, (_event: any, record: any) => {
        callback(record);
      });
    },
  },

  onStateUpdate(callback: (state: any) => void) {
    ipcRenderer.on(IPC_CHANNELS.STATE_UPDATE, (_event: any, state: any) => {
      callback(state);
    });
  },

  onEvent(callback: (type: string, payload: any) => void) {
    ipcRenderer.on(IPC_CHANNELS.EVENT_BROADCAST, (_event: any, type: string, payload: any) => {
      callback(type, payload);
    });
  },

  // ── Browser (queries, management, UI features, subscriptions) ───────────

  browser: {
    getState() {
      return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_STATE);
    },
    getHistory() {
      return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_HISTORY);
    },
    clearHistory() {
      return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CLEAR_HISTORY);
    },
    clearData() {
      return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CLEAR_DATA);
    },
    clearSiteData(origin?: string) {
      return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CLEAR_SITE_DATA, origin);
    },
    reportBounds(bounds: { x: number; y: number; width: number; height: number }) {
      return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_REPORT_BOUNDS, bounds);
    },
    getTabs() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_TABS); },
    captureTabSnapshot(tabId?: string) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CAPTURE_TAB_SNAPSHOT, tabId); },
    getActionableElements(tabId?: string) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_ACTIONABLE_ELEMENTS, tabId); },
    getFormModel(tabId?: string) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_FORM_MODEL, tabId); },
    getConsoleEvents(tabId?: string, since?: number) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_CONSOLE_EVENTS, tabId, since); },
    getNetworkEvents(tabId?: string, since?: number) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_NETWORK_EVENTS, tabId, since); },
    recordFinding(input: any) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_RECORD_FINDING, input); },
    getTaskMemory(taskId: string) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_TASK_MEMORY, taskId); },
    getSiteStrategy(origin: string) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_SITE_STRATEGY, origin); },
    saveSiteStrategy(input: any) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_SAVE_SITE_STRATEGY, input); },
    exportSurfaceEvalFixture(input: any) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_EXPORT_SURFACE_EVAL_FIXTURE, input); },
    // Bookmarks
    addBookmark(url: string, title: string) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_ADD_BOOKMARK, url, title); },
    removeBookmark(bookmarkId: string) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_REMOVE_BOOKMARK, bookmarkId); },
    getBookmarks() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_BOOKMARKS); },
    // Zoom
    zoomIn() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_ZOOM_IN); },
    zoomOut() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_ZOOM_OUT); },
    zoomReset() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_ZOOM_RESET); },
    // Find in page
    findInPage(query: string) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_FIND_IN_PAGE, query); },
    findNext() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_FIND_NEXT); },
    findPrevious() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_FIND_PREVIOUS); },
    stopFind() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_STOP_FIND); },
    // DevTools
    toggleDevTools() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_TOGGLE_DEVTOOLS); },
    // Settings
    getSettings() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_SETTINGS); },
    updateSettings(settings: any) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_UPDATE_SETTINGS, settings); },
    getAuthDiagnostics() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_AUTH_DIAGNOSTICS); },
    clearGoogleAuthState() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CLEAR_GOOGLE_AUTH_STATE); },
    // Extensions
    loadExtension(extPath: string) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_LOAD_EXTENSION, extPath); },
    removeExtension(extensionId: string) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_REMOVE_EXTENSION, extensionId); },
    getExtensions() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_EXTENSIONS); },
    splitTab(tabId?: string) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_SPLIT_TAB, tabId); },
    clearSplitView() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CLEAR_SPLIT_VIEW); },
    // Downloads
    getDownloads() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_DOWNLOADS); },
    cancelDownload(downloadId: string) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CANCEL_DOWNLOAD, downloadId); },
    clearDownloads() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CLEAR_DOWNLOADS); },
    // Cookie sync
    reimportCookies() { return ipcRenderer.invoke('browser:reimport-cookies'); },
    // Subscriptions
    onStateUpdate(callback: (state: any) => void) {
      ipcRenderer.on(IPC_CHANNELS.BROWSER_STATE_UPDATE, (_event: any, state: any) => { callback(state); });
    },
    onNavUpdate(callback: (nav: any) => void) {
      ipcRenderer.on(IPC_CHANNELS.BROWSER_NAV_UPDATE, (_event: any, nav: any) => { callback(nav); });
    },
    onFindUpdate(callback: (find: any) => void) {
      ipcRenderer.on(IPC_CHANNELS.BROWSER_FIND_UPDATE, (_event: any, find: any) => { callback(find); });
    },
  },

  // ── Agent model API ─────────────────────────────────────────────────────

  model: {
    invoke(taskId: string, prompt: string, owner?: string, options?: AgentInvocationOptions) {
      return ipcRenderer.invoke(IPC_CHANNELS.MODEL_INVOKE, taskId, prompt, owner, options);
    },
    cancel(taskId: string) {
      return ipcRenderer.invoke(IPC_CHANNELS.MODEL_CANCEL, taskId);
    },
    getProviders() {
      return ipcRenderer.invoke(IPC_CHANNELS.MODEL_GET_PROVIDERS);
    },
    getTaskMemory(taskId: string) {
      return ipcRenderer.invoke(IPC_CHANNELS.MODEL_GET_TASK_MEMORY, taskId);
    },
    resolve(prompt: string, explicitOwner?: string, options?: AgentInvocationOptions) {
      return ipcRenderer.invoke(IPC_CHANNELS.MODEL_RESOLVE, prompt, explicitOwner, options);
    },
    handoff(taskId: string, from: string, to: string) {
      return ipcRenderer.invoke(IPC_CHANNELS.MODEL_HANDOFF, taskId, from, to);
    },
    runIntentProgram(taskId: string, input: { instructions: Array<Record<string, unknown>>; tabId?: string; failFast?: boolean }) {
      return ipcRenderer.invoke(IPC_CHANNELS.MODEL_RUN_INTENT_PROGRAM, taskId, input);
    },
    onProgress(callback: (progress: any) => void) {
      ipcRenderer.on(IPC_CHANNELS.MODEL_PROGRESS, (_event: any, progress: any) => {
        callback(progress);
      });
    },
  },

  // ── Terminal (raw PTY I/O, queries, subscriptions) ──────────────────────

  terminal: {
    startSession(cols?: number, rows?: number) {
      return ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_START_SESSION, cols, rows);
    },
    getSession() {
      return ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_GET_SESSION);
    },
    write(data: string) {
      return ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_WRITE, data);
    },
    resize(cols: number, rows: number) {
      return ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_RESIZE, cols, rows);
    },
    captureScrollback() {
      return ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_CAPTURE_SCROLLBACK);
    },
    onOutput(callback: (data: string) => void) {
      ipcRenderer.on(IPC_CHANNELS.TERMINAL_OUTPUT, (_event: any, data: string) => {
        callback(data);
      });
    },
    onStatus(callback: (session: any) => void) {
      ipcRenderer.on(IPC_CHANNELS.TERMINAL_STATUS, (_event: any, session: any) => {
        callback(session);
      });
    },
    onExit(callback: (exitCode: number) => void) {
      ipcRenderer.on(IPC_CHANNELS.TERMINAL_EXIT, (_event: any, exitCode: number) => {
        callback(exitCode);
      });
    },
  },

  removeAllListeners() {
    ipcRenderer.removeAllListeners(IPC_CHANNELS.STATE_UPDATE);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.EVENT_BROADCAST);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.TERMINAL_OUTPUT);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.TERMINAL_STATUS);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.TERMINAL_EXIT);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.BROWSER_STATE_UPDATE);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.BROWSER_NAV_UPDATE);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.BROWSER_FIND_UPDATE);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.SURFACE_ACTION_UPDATE);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.MODEL_PROGRESS);
  },
};

// Debug: test disk extraction and disk tools
(api as any).testDiskExtract = () => ipcRenderer.invoke(IPC_CHANNELS.DEBUG_TEST_DISK_EXTRACT);

contextBridge.exposeInMainWorld('workspaceAPI', api);
