"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const IPC_CHANNELS = {
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
    ATTACHMENTS_IMPORT_DOCUMENTS: 'attachments:import-documents',
    ARTIFACT_CREATE: 'artifact:create',
    ARTIFACT_GET: 'artifact:get',
    ARTIFACT_LIST: 'artifact:list',
    ARTIFACT_SET_ACTIVE: 'artifact:set-active',
    ARTIFACT_GET_ACTIVE: 'artifact:get-active',
    ARTIFACT_DELETE: 'artifact:delete',
    ARTIFACT_REPLACE_CONTENT: 'artifact:replace-content',
    ARTIFACT_APPEND_CONTENT: 'artifact:append-content',
    DOCUMENT_OPEN_ARTIFACT: 'document:open-artifact',
    DOCUMENT_GET_CURRENT: 'document:get-current',
    DOCUMENT_GET_ARTIFACT: 'document:get-artifact',
    DOCUMENT_LIST_ARTIFACTS: 'document:list-artifacts',
    DOCUMENT_SET_CURRENT: 'document:set-current',
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
    BROWSER_GET_OPERATION_LEDGER: 'browser:get-operation-ledger',
    BROWSER_REPLAY_OPERATION: 'browser:replay-operation',
    BROWSER_RECORD_FINDING: 'browser:record-finding',
    BROWSER_GET_TASK_MEMORY: 'browser:get-task-memory',
    BROWSER_GET_SITE_STRATEGY: 'browser:get-site-strategy',
    BROWSER_SAVE_SITE_STRATEGY: 'browser:save-site-strategy',
    BROWSER_EXPORT_SURFACE_EVAL_FIXTURE: 'browser:export-surface-eval-fixture',
    BROWSER_ADD_BOOKMARK: 'browser:add-bookmark',
    BROWSER_REMOVE_BOOKMARK: 'browser:remove-bookmark',
    BROWSER_GET_BOOKMARKS: 'browser:get-bookmarks',
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
    MODEL_RUN_INTENT_PROGRAM: 'model:run-intent-program',
    MODEL_PROGRESS: 'model:progress',
    TERMINAL_START_SESSION: 'terminal:start-session',
    TERMINAL_GET_SESSION: 'terminal:get-session',
    TERMINAL_WRITE: 'terminal:write',
    TERMINAL_RESIZE: 'terminal:resize',
    TERMINAL_OUTPUT: 'terminal:output',
    TERMINAL_STATUS: 'terminal:status',
    TERMINAL_EXIT: 'terminal:exit',
};
const api = {
    getState() {
        return electron_1.ipcRenderer.invoke(IPC_CHANNELS.GET_STATE);
    },
    getRole() {
        return electron_1.ipcRenderer.invoke(IPC_CHANNELS.GET_ROLE);
    },
    createTask(title) {
        return electron_1.ipcRenderer.invoke(IPC_CHANNELS.CREATE_TASK, title);
    },
    deleteTask(taskId) {
        return electron_1.ipcRenderer.invoke(IPC_CHANNELS.DELETE_TASK, taskId);
    },
    updateTaskStatus(taskId, status) {
        return electron_1.ipcRenderer.invoke(IPC_CHANNELS.UPDATE_TASK_STATUS, taskId, status);
    },
    setActiveTask(taskId) {
        return electron_1.ipcRenderer.invoke(IPC_CHANNELS.SET_ACTIVE_TASK, taskId);
    },
    resetTokenUsage() {
        return electron_1.ipcRenderer.invoke(IPC_CHANNELS.RESET_TOKEN_USAGE);
    },
    addLog(level, source, message, taskId) {
        return electron_1.ipcRenderer.invoke(IPC_CHANNELS.ADD_LOG, level, source, message, taskId);
    },
    artifacts: {
        create(input) {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.ARTIFACT_CREATE, input);
        },
        get(artifactId) {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.ARTIFACT_GET, artifactId);
        },
        list() {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.ARTIFACT_LIST);
        },
        setActive(artifactId) {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.ARTIFACT_SET_ACTIVE, artifactId);
        },
        getActive() {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.ARTIFACT_GET_ACTIVE);
        },
        delete(artifactId, deletedBy) {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.ARTIFACT_DELETE, { artifactId, deletedBy });
        },
        replaceContent(input) {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.ARTIFACT_REPLACE_CONTENT, input);
        },
        appendContent(input) {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.ARTIFACT_APPEND_CONTENT, input);
        },
    },
    document: {
        openArtifact(artifactId) {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.DOCUMENT_OPEN_ARTIFACT, artifactId);
        },
        getCurrent() {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.DOCUMENT_GET_CURRENT);
        },
        getArtifact(artifactId) {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.DOCUMENT_GET_ARTIFACT, artifactId);
        },
        listArtifacts() {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.DOCUMENT_LIST_ARTIFACTS);
        },
        setCurrent(artifactId) {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.DOCUMENT_SET_CURRENT, artifactId);
        },
    },
    attachments: {
        importDocuments(taskId, documents) {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.ATTACHMENTS_IMPORT_DOCUMENTS, taskId, documents);
        },
    },
    // Execution split control
    applyExecutionPreset(preset) {
        return electron_1.ipcRenderer.invoke(IPC_CHANNELS.APPLY_EXECUTION_PRESET, preset);
    },
    setSplitRatio(ratio) {
        return electron_1.ipcRenderer.invoke(IPC_CHANNELS.SET_SPLIT_RATIO, ratio);
    },
    // ── Surface actions (single authoritative execution path) ───────────────
    actions: {
        submit(input) {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.SUBMIT_SURFACE_ACTION, input);
        },
        cancelQueued(actionId) {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.CANCEL_QUEUED_ACTION, actionId);
        },
        listRecent(limit) {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.GET_RECENT_ACTIONS, limit);
        },
        listByTarget(target, limit) {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.GET_ACTIONS_BY_TARGET, target, limit);
        },
        listByTask(taskId) {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.GET_ACTIONS_BY_TASK, taskId);
        },
        getQueueDiagnostics() {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.GET_QUEUE_DIAGNOSTICS);
        },
        onUpdate(callback) {
            electron_1.ipcRenderer.on(IPC_CHANNELS.SURFACE_ACTION_UPDATE, (_event, record) => {
                callback(record);
            });
        },
    },
    onStateUpdate(callback) {
        electron_1.ipcRenderer.on(IPC_CHANNELS.STATE_UPDATE, (_event, state) => {
            callback(state);
        });
    },
    onEvent(callback) {
        electron_1.ipcRenderer.on(IPC_CHANNELS.EVENT_BROADCAST, (_event, type, payload) => {
            callback(type, payload);
        });
    },
    // ── Browser (queries, management, diagnostics, subscriptions) ────────────
    // Operational browser actions should go through actions.submit so they are
    // routed through the canonical browser-operation/ledger path.
    browser: {
        getState() {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_STATE);
        },
        getHistory() {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_HISTORY);
        },
        clearHistory() {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CLEAR_HISTORY);
        },
        clearData() {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CLEAR_DATA);
        },
        clearSiteData(origin) {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CLEAR_SITE_DATA, origin);
        },
        reportBounds(bounds) {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_REPORT_BOUNDS, bounds);
        },
        getTabs() { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_TABS); },
        captureTabSnapshot(tabId) { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CAPTURE_TAB_SNAPSHOT, tabId); },
        getActionableElements(tabId) { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_ACTIONABLE_ELEMENTS, tabId); },
        getFormModel(tabId) { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_FORM_MODEL, tabId); },
        getConsoleEvents(tabId, since) { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_CONSOLE_EVENTS, tabId, since); },
        getNetworkEvents(tabId, since) { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_NETWORK_EVENTS, tabId, since); },
        getOperationLedger(limit) { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_OPERATION_LEDGER, limit); },
        replayOperation(request) { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_REPLAY_OPERATION, request); },
        recordFinding(input) { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_RECORD_FINDING, input); },
        getTaskMemory(taskId) { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_TASK_MEMORY, taskId); },
        getSiteStrategy(origin) { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_SITE_STRATEGY, origin); },
        saveSiteStrategy(input) { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_SAVE_SITE_STRATEGY, input); },
        exportSurfaceEvalFixture(input) { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_EXPORT_SURFACE_EVAL_FIXTURE, input); },
        // Bookmarks
        addBookmark(url, title) { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_ADD_BOOKMARK, url, title); },
        removeBookmark(bookmarkId) { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_REMOVE_BOOKMARK, bookmarkId); },
        getBookmarks() { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_BOOKMARKS); },
        // Zoom
        zoomIn() { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_ZOOM_IN); },
        zoomOut() { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_ZOOM_OUT); },
        zoomReset() { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_ZOOM_RESET); },
        // Find in page
        findInPage(query) { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_FIND_IN_PAGE, query); },
        findNext() { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_FIND_NEXT); },
        findPrevious() { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_FIND_PREVIOUS); },
        stopFind() { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_STOP_FIND); },
        // DevTools
        toggleDevTools() { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_TOGGLE_DEVTOOLS); },
        // Settings
        getSettings() { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_SETTINGS); },
        updateSettings(settings) { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_UPDATE_SETTINGS, settings); },
        getAuthDiagnostics() { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_AUTH_DIAGNOSTICS); },
        clearGoogleAuthState() { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CLEAR_GOOGLE_AUTH_STATE); },
        // Extensions
        loadExtension(extPath) { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_LOAD_EXTENSION, extPath); },
        removeExtension(extensionId) { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_REMOVE_EXTENSION, extensionId); },
        getExtensions() { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_EXTENSIONS); },
        // Downloads
        getDownloads() { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_DOWNLOADS); },
        cancelDownload(downloadId) { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CANCEL_DOWNLOAD, downloadId); },
        clearDownloads() { return electron_1.ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CLEAR_DOWNLOADS); },
        // Cookie sync
        reimportCookies() { return electron_1.ipcRenderer.invoke('browser:reimport-cookies'); },
        // Subscriptions
        onStateUpdate(callback) {
            electron_1.ipcRenderer.on(IPC_CHANNELS.BROWSER_STATE_UPDATE, (_event, state) => { callback(state); });
        },
        onNavUpdate(callback) {
            electron_1.ipcRenderer.on(IPC_CHANNELS.BROWSER_NAV_UPDATE, (_event, nav) => { callback(nav); });
        },
        onFindUpdate(callback) {
            electron_1.ipcRenderer.on(IPC_CHANNELS.BROWSER_FIND_UPDATE, (_event, find) => { callback(find); });
        },
    },
    // ── Agent model API ─────────────────────────────────────────────────────
    model: {
        invoke(taskId, prompt, owner, options) {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.MODEL_INVOKE, taskId, prompt, owner, options);
        },
        cancel(taskId) {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.MODEL_CANCEL, taskId);
        },
        getProviders() {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.MODEL_GET_PROVIDERS);
        },
        getTaskMemory(taskId) {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.MODEL_GET_TASK_MEMORY, taskId);
        },
        resolve(prompt, explicitOwner, options) {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.MODEL_RESOLVE, prompt, explicitOwner, options);
        },
        runIntentProgram(taskId, input) {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.MODEL_RUN_INTENT_PROGRAM, taskId, input);
        },
        onProgress(callback) {
            electron_1.ipcRenderer.on(IPC_CHANNELS.MODEL_PROGRESS, (_event, progress) => {
                callback(progress);
            });
        },
    },
    // ── Terminal (raw PTY transport, queries, subscriptions) ────────────────
    // Orchestrated terminal actions belong on actions.submit / terminal tools.
    terminal: {
        startSession(cols, rows) {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_START_SESSION, cols, rows);
        },
        getSession() {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_GET_SESSION);
        },
        write(data) {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_WRITE, data);
        },
        resize(cols, rows) {
            return electron_1.ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_RESIZE, cols, rows);
        },
        onOutput(callback) {
            electron_1.ipcRenderer.on(IPC_CHANNELS.TERMINAL_OUTPUT, (_event, data) => {
                callback(data);
            });
        },
        onStatus(callback) {
            electron_1.ipcRenderer.on(IPC_CHANNELS.TERMINAL_STATUS, (_event, session) => {
                callback(session);
            });
        },
        onExit(callback) {
            electron_1.ipcRenderer.on(IPC_CHANNELS.TERMINAL_EXIT, (_event, exitCode) => {
                callback(exitCode);
            });
        },
    },
    removeAllListeners() {
        electron_1.ipcRenderer.removeAllListeners(IPC_CHANNELS.STATE_UPDATE);
        electron_1.ipcRenderer.removeAllListeners(IPC_CHANNELS.EVENT_BROADCAST);
        electron_1.ipcRenderer.removeAllListeners(IPC_CHANNELS.TERMINAL_OUTPUT);
        electron_1.ipcRenderer.removeAllListeners(IPC_CHANNELS.TERMINAL_STATUS);
        electron_1.ipcRenderer.removeAllListeners(IPC_CHANNELS.TERMINAL_EXIT);
        electron_1.ipcRenderer.removeAllListeners(IPC_CHANNELS.BROWSER_STATE_UPDATE);
        electron_1.ipcRenderer.removeAllListeners(IPC_CHANNELS.BROWSER_NAV_UPDATE);
        electron_1.ipcRenderer.removeAllListeners(IPC_CHANNELS.BROWSER_FIND_UPDATE);
        electron_1.ipcRenderer.removeAllListeners(IPC_CHANNELS.SURFACE_ACTION_UPDATE);
        electron_1.ipcRenderer.removeAllListeners(IPC_CHANNELS.MODEL_PROGRESS);
    },
};
// Debug: test disk extraction and disk tools
api.testDiskExtract = () => electron_1.ipcRenderer.invoke(IPC_CHANNELS.DEBUG_TEST_DISK_EXTRACT);
electron_1.contextBridge.exposeInMainWorld('workspaceAPI', api);
//# sourceMappingURL=preload.js.map