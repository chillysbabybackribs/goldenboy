"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerIpc = registerIpc;
const electron_1 = require("electron");
const ipc_1 = require("../../shared/types/ipc");
const appStateStore_1 = require("../state/appStateStore");
const eventBus_1 = require("../events/eventBus");
const events_1 = require("../../shared/types/events");
const windowManager_1 = require("../windows/windowManager");
const ids_1 = require("../../shared/utils/ids");
const actions_1 = require("../state/actions");
const TerminalService_1 = require("../terminal/TerminalService");
const BrowserService_1 = require("../browser/BrowserService");
const browserOperationLedger_1 = require("../browser/browserOperationLedger");
const browserOperationReplay_1 = require("../browser/browserOperationReplay");
const SurfaceActionRouter_1 = require("../actions/SurfaceActionRouter");
const diskCache_1 = require("../context/diskCache");
const pageExtractor_1 = require("../context/pageExtractor");
const AgentModelService_1 = require("../agent/AgentModelService");
const AgentToolExecutor_1 = require("../agent/AgentToolExecutor");
const DocumentAttachmentStore_1 = require("../attachments/DocumentAttachmentStore");
const registerArtifactIpc_1 = require("./registerArtifactIpc");
const registerDocumentIpc_1 = require("./registerDocumentIpc");
const taskMemoryStore_1 = require("../models/taskMemoryStore");
const path = __importStar(require("path"));
const os = __importStar(require("os"));
function isTrustedIpcSender(event) {
    const senderId = event.sender.id;
    if ((0, windowManager_1.getRoleByWebContentsId)(senderId))
        return true;
    return BrowserService_1.browserService.isKnownTabWebContents(senderId);
}
function safeOn(channel, handler) {
    electron_1.ipcMain.on(channel, (event, ...args) => {
        if (!isTrustedIpcSender(event)) {
            event.returnValue = { error: 'Untrusted IPC sender' };
            return;
        }
        handler(event, ...args);
    });
}
function safeHandle(channel, handler) {
    electron_1.ipcMain.handle(channel, (event, ...args) => {
        if (!isTrustedIpcSender(event)) {
            throw new Error('Untrusted IPC sender');
        }
        return handler(event, ...args);
    });
}
function registerIpc() {
    (0, registerArtifactIpc_1.registerArtifactIpc)(safeHandle);
    (0, registerDocumentIpc_1.registerDocumentIpc)(safeHandle);
    safeOn('browser:prompt-open-sync', (event, payload) => {
        event.returnValue = BrowserService_1.browserService.openPromptDialogFallback({
            webContentsId: event.sender.id,
            message: typeof payload?.message === 'string' ? payload.message : '',
            defaultPrompt: typeof payload?.defaultPrompt === 'string' ? payload.defaultPrompt : '',
            url: typeof payload?.url === 'string' ? payload.url : '',
        });
    });
    safeOn('browser:prompt-poll-sync', (event, payload) => {
        const dialogId = typeof payload?.dialogId === 'string' ? payload.dialogId : '';
        event.returnValue = BrowserService_1.browserService.pollPromptDialogFallback(dialogId);
    });
    safeHandle(ipc_1.IPC_CHANNELS.GET_STATE, () => {
        return appStateStore_1.appStateStore.getState();
    });
    safeHandle(ipc_1.IPC_CHANNELS.GET_ROLE, (event) => {
        return (0, windowManager_1.getRoleByWebContentsId)(event.sender.id);
    });
    safeHandle(ipc_1.IPC_CHANNELS.CREATE_TASK, (_event, title) => {
        const task = {
            id: (0, ids_1.generateId)('task'),
            title,
            status: 'queued',
            owner: 'user',
            artifactIds: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        eventBus_1.eventBus.emit(events_1.AppEventType.TASK_CREATED, { task });
        return { id: task.id, title: task.title };
    });
    safeHandle(ipc_1.IPC_CHANNELS.ATTACHMENTS_IMPORT_DOCUMENTS, async (_event, taskId, documents) => {
        return DocumentAttachmentStore_1.documentAttachmentStore.importDocuments(taskId, documents);
    });
    safeHandle(ipc_1.IPC_CHANNELS.DELETE_TASK, (_event, taskId) => {
        const state = appStateStore_1.appStateStore.getState();
        const task = state.tasks.find((entry) => entry.id === taskId);
        if (!task)
            return;
        if (task.status === 'running') {
            throw new Error('Cannot delete a running chat');
        }
        DocumentAttachmentStore_1.documentAttachmentStore.clearTask(taskId);
        taskMemoryStore_1.taskMemoryStore.clearTask(taskId);
        appStateStore_1.appStateStore.dispatch({ type: actions_1.ActionType.DELETE_TASK, taskId });
    });
    safeHandle(ipc_1.IPC_CHANNELS.UPDATE_TASK_STATUS, (_event, taskId, status) => {
        const state = appStateStore_1.appStateStore.getState();
        const task = state.tasks.find((t) => t.id === taskId);
        if (!task)
            return;
        const updated = { ...task, status, updatedAt: Date.now() };
        eventBus_1.eventBus.emit(events_1.AppEventType.TASK_UPDATED, { task: updated });
        if (status === 'completed') {
            eventBus_1.eventBus.emit(events_1.AppEventType.TASK_COMPLETED, { taskId });
        }
    });
    safeHandle(ipc_1.IPC_CHANNELS.SET_ACTIVE_TASK, (_event, taskId) => {
        appStateStore_1.appStateStore.dispatch({ type: actions_1.ActionType.SET_ACTIVE_TASK, taskId });
    });
    safeHandle(ipc_1.IPC_CHANNELS.RESET_TOKEN_USAGE, () => {
        appStateStore_1.appStateStore.dispatch({ type: actions_1.ActionType.RESET_TOKEN_USAGE });
    });
    safeHandle(ipc_1.IPC_CHANNELS.ADD_LOG, (_event, level, source, message, taskId) => {
        const log = {
            id: (0, ids_1.generateId)('log'),
            timestamp: Date.now(),
            level,
            source,
            message,
            taskId,
        };
        eventBus_1.eventBus.emit(events_1.AppEventType.LOG_ADDED, { log });
    });
    // Execution split control
    safeHandle(ipc_1.IPC_CHANNELS.APPLY_EXECUTION_PRESET, (_event, preset) => {
        eventBus_1.eventBus.emit(events_1.AppEventType.EXECUTION_LAYOUT_APPLIED, { preset });
    });
    safeHandle(ipc_1.IPC_CHANNELS.SET_SPLIT_RATIO, (_event, ratio) => {
        const clamped = Math.max(0.15, Math.min(0.85, ratio));
        eventBus_1.eventBus.emit(events_1.AppEventType.EXECUTION_SPLIT_CHANGED, { ratio: clamped });
    });
    // ── Surface action IPC handlers ──────────────────────────────────────────
    safeHandle(ipc_1.IPC_CHANNELS.SUBMIT_SURFACE_ACTION, async (_event, input) => {
        return SurfaceActionRouter_1.surfaceActionRouter.submit(input);
    });
    safeHandle(ipc_1.IPC_CHANNELS.CANCEL_QUEUED_ACTION, (_event, actionId) => {
        return SurfaceActionRouter_1.surfaceActionRouter.cancelQueuedAction(actionId);
    });
    safeHandle(ipc_1.IPC_CHANNELS.GET_QUEUE_DIAGNOSTICS, () => {
        return SurfaceActionRouter_1.surfaceActionRouter.getQueueDiagnostics();
    });
    safeHandle(ipc_1.IPC_CHANNELS.GET_RECENT_ACTIONS, (_event, limit) => {
        return SurfaceActionRouter_1.surfaceActionRouter.getRecentActions(limit);
    });
    safeHandle(ipc_1.IPC_CHANNELS.GET_ACTIONS_BY_TARGET, (_event, target, limit) => {
        return SurfaceActionRouter_1.surfaceActionRouter.getActionsByTarget(target, limit);
    });
    safeHandle(ipc_1.IPC_CHANNELS.GET_ACTIONS_BY_TASK, (_event, taskId) => {
        return SurfaceActionRouter_1.surfaceActionRouter.getActionsByTask(taskId);
    });
    // Terminal session IPC handlers
    safeHandle(ipc_1.IPC_CHANNELS.TERMINAL_START_SESSION, (_event, cols, rows) => {
        return TerminalService_1.terminalService.startSession(cols, rows);
    });
    safeHandle(ipc_1.IPC_CHANNELS.TERMINAL_GET_SESSION, () => {
        return TerminalService_1.terminalService.getSession();
    });
    safeHandle(ipc_1.IPC_CHANNELS.TERMINAL_WRITE, (_event, data) => {
        TerminalService_1.terminalService.write(data);
    });
    safeHandle(ipc_1.IPC_CHANNELS.TERMINAL_RESIZE, (_event, cols, rows) => {
        TerminalService_1.terminalService.resize(cols, rows);
    });
    // ── Browser runtime IPC handlers ─────────────────────────────────────
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_GET_STATE, () => {
        return BrowserService_1.browserService.getState();
    });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_GET_HISTORY, () => {
        return BrowserService_1.browserService.getHistory();
    });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_CLEAR_HISTORY, () => {
        BrowserService_1.browserService.clearHistory();
    });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_CLEAR_DATA, async () => {
        await BrowserService_1.browserService.clearData();
    });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_CLEAR_SITE_DATA, async (_event, origin) => {
        return BrowserService_1.browserService.clearSiteData(origin);
    });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_REPORT_BOUNDS, (_event, bounds) => {
        BrowserService_1.browserService.setBounds(bounds);
    });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_GET_TABS, () => {
        return BrowserService_1.browserService.getTabs();
    });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_CAPTURE_TAB_SNAPSHOT, (_event, tabId) => {
        return BrowserService_1.browserService.captureTabSnapshot(tabId);
    });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_GET_ACTIONABLE_ELEMENTS, (_event, tabId) => {
        return BrowserService_1.browserService.getActionableElements(tabId);
    });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_GET_FORM_MODEL, (_event, tabId) => {
        return BrowserService_1.browserService.getFormModel(tabId);
    });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_GET_CONSOLE_EVENTS, (_event, tabId, since) => {
        return BrowserService_1.browserService.getConsoleEvents(tabId, since);
    });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_GET_NETWORK_EVENTS, (_event, tabId, since) => {
        return BrowserService_1.browserService.getNetworkEvents(tabId, since);
    });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_GET_OPERATION_LEDGER, (_event, limit) => {
        return (0, browserOperationLedger_1.getRecentBrowserOperationLedgerEntries)(limit);
    });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_REPLAY_OPERATION, (_event, request) => {
        return (0, browserOperationReplay_1.replayBrowserOperation)(request);
    });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_RECORD_FINDING, (_event, input) => {
        return BrowserService_1.browserService.recordTabFinding(input);
    });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_GET_TASK_MEMORY, (_event, taskId) => {
        return BrowserService_1.browserService.getTaskBrowserMemory(taskId);
    });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_GET_SITE_STRATEGY, (_event, origin) => {
        return BrowserService_1.browserService.getSiteStrategy(origin);
    });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_SAVE_SITE_STRATEGY, (_event, input) => {
        return BrowserService_1.browserService.saveSiteStrategy(input);
    });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_EXPORT_SURFACE_EVAL_FIXTURE, (_event, input) => {
        return BrowserService_1.browserService.exportSurfaceEvalFixture(input);
    });
    // Bookmarks
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_ADD_BOOKMARK, (_event, url, title) => {
        return BrowserService_1.browserService.addBookmark(url, title);
    });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_REMOVE_BOOKMARK, (_event, bookmarkId) => {
        BrowserService_1.browserService.removeBookmark(bookmarkId);
    });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_GET_BOOKMARKS, () => {
        return BrowserService_1.browserService.getBookmarks();
    });
    // Zoom
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_ZOOM_IN, () => { BrowserService_1.browserService.zoomIn(); });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_ZOOM_OUT, () => { BrowserService_1.browserService.zoomOut(); });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_ZOOM_RESET, () => { BrowserService_1.browserService.zoomReset(); });
    // Find in page
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_FIND_IN_PAGE, (_event, query) => { BrowserService_1.browserService.findInPage(query); });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_FIND_NEXT, () => { BrowserService_1.browserService.findNext(); });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_FIND_PREVIOUS, () => { BrowserService_1.browserService.findPrevious(); });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_STOP_FIND, () => { BrowserService_1.browserService.stopFind(); });
    // DevTools
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_TOGGLE_DEVTOOLS, () => { BrowserService_1.browserService.toggleDevTools(); });
    // Settings
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_GET_SETTINGS, () => { return BrowserService_1.browserService.getSettings(); });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_UPDATE_SETTINGS, (_event, settings) => { BrowserService_1.browserService.updateSettings(settings); });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_GET_AUTH_DIAGNOSTICS, () => { return BrowserService_1.browserService.getAuthDiagnostics(); });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_CLEAR_GOOGLE_AUTH_STATE, () => { return BrowserService_1.browserService.clearGoogleAuthState(); });
    // Extensions
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_LOAD_EXTENSION, async (_event, extPath) => { return BrowserService_1.browserService.loadExtension(extPath); });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_REMOVE_EXTENSION, async (_event, extensionId) => { BrowserService_1.browserService.removeExtension(extensionId); });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_GET_EXTENSIONS, () => { return BrowserService_1.browserService.getExtensions(); });
    // Downloads
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_GET_DOWNLOADS, () => { return BrowserService_1.browserService.getDownloads(); });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_CANCEL_DOWNLOAD, (_event, downloadId) => { BrowserService_1.browserService.cancelDownload(downloadId); });
    safeHandle(ipc_1.IPC_CHANNELS.BROWSER_CLEAR_DOWNLOADS, () => { BrowserService_1.browserService.clearDownloads(); });
    // Cookie re-import
    safeHandle('browser:reimport-cookies', async () => {
        return BrowserService_1.browserService.reimportChromeCookies();
    });
    // ── Agent model IPC handlers ───────────────────────────────────────
    safeHandle(ipc_1.IPC_CHANNELS.MODEL_INVOKE, async (_event, taskId, prompt, owner, options) => {
        return AgentModelService_1.agentModelService.invoke(taskId, prompt, owner, options);
    });
    safeHandle(ipc_1.IPC_CHANNELS.MODEL_CANCEL, (_event, taskId) => {
        return AgentModelService_1.agentModelService.cancel(taskId);
    });
    safeHandle(ipc_1.IPC_CHANNELS.MODEL_GET_PROVIDERS, () => {
        return AgentModelService_1.agentModelService.getProviderStatuses();
    });
    safeHandle(ipc_1.IPC_CHANNELS.MODEL_GET_TASK_MEMORY, (_event, taskId) => {
        return AgentModelService_1.agentModelService.getTaskMemory(taskId);
    });
    safeHandle(ipc_1.IPC_CHANNELS.MODEL_RESOLVE, (_event, prompt, explicitOwner, options) => {
        return AgentModelService_1.agentModelService.resolve(prompt, explicitOwner, options);
    });
    safeHandle(ipc_1.IPC_CHANNELS.MODEL_RUN_INTENT_PROGRAM, async (_event, taskId, input) => {
        const toolCatalog = AgentToolExecutor_1.agentToolExecutor.list().map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
        }));
        return AgentToolExecutor_1.agentToolExecutor.execute('browser.run_intent_program', input, {
            runId: (0, ids_1.generateId)('run'),
            agentId: AgentModelService_1.agentModelService.resolve('browser intent program'),
            mode: 'unrestricted-dev',
            taskId,
            toolCatalog,
        });
    });
    // Debug: test disk extraction on active browser tab
    safeHandle(ipc_1.IPC_CHANNELS.DEBUG_TEST_DISK_EXTRACT, async () => {
        const cacheDir = path.join(os.homedir(), 'Desktop', 'v2-disk-cache');
        const cache = new diskCache_1.DiskCache(cacheDir);
        const executeInPage = (expr, tabId) => BrowserService_1.browserService.executeInPage(expr, tabId);
        const extractor = new pageExtractor_1.PageExtractor(executeInPage);
        const state = BrowserService_1.browserService.getState();
        const tabId = state.tabs.length > 0 ? state.tabs[state.tabs.length - 1].id : 'unknown';
        const content = await extractor.extractContent(tabId);
        cache.writePageContent('test', tabId, content);
        const elements = await extractor.extractElements(tabId);
        cache.writePageElements('test', tabId, {
            url: content.url,
            elements: elements.elements,
            forms: elements.forms,
        });
        return {
            savedTo: path.join(cacheDir, 'test', 'pages'),
            url: content.url,
            title: content.title,
            tier: content.tier,
            contentChars: content.content.length,
            elementCount: elements.elements.length,
            formCount: elements.forms.length,
            preview: content.content.slice(0, 500),
        };
    });
}
//# sourceMappingURL=registerIpc.js.map