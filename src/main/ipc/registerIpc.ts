import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/types/ipc';
import { appStateStore } from '../state/appStateStore';
import { eventBus } from '../events/eventBus';
import { AppEventType } from '../../shared/types/events';
import { getRoleByWebContentsId } from '../windows/windowManager';
import { generateId } from '../../shared/utils/ids';
import { TaskRecord, ExecutionLayoutPreset, TaskStatus, LogLevel, LogSource } from '../../shared/types/appState';
import { ActionType } from '../state/actions';
import { terminalService } from '../terminal/TerminalService';
import { browserService } from '../browser/BrowserService';
import { surfaceActionRouter } from '../actions/SurfaceActionRouter';
import { SurfaceActionInput } from '../../shared/actions/surfaceActionTypes';
import { DiskCache } from '../context/diskCache';
import { PageExtractor } from '../context/pageExtractor';
import { agentModelService } from '../agent/AgentModelService';
import { agentToolExecutor } from '../agent/AgentToolExecutor';
import * as path from 'path';
import * as os from 'os';

export function registerIpc(): void {
  ipcMain.on('browser:prompt-open-sync', (event, payload: { message?: string; defaultPrompt?: string; url?: string }) => {
    event.returnValue = browserService.openPromptDialogFallback({
      webContentsId: event.sender.id,
      message: typeof payload?.message === 'string' ? payload.message : '',
      defaultPrompt: typeof payload?.defaultPrompt === 'string' ? payload.defaultPrompt : '',
      url: typeof payload?.url === 'string' ? payload.url : '',
    });
  });

  ipcMain.on('browser:prompt-poll-sync', (event, payload: { dialogId?: string }) => {
    const dialogId = typeof payload?.dialogId === 'string' ? payload.dialogId : '';
    event.returnValue = browserService.pollPromptDialogFallback(dialogId);
  });

  ipcMain.handle(IPC_CHANNELS.GET_STATE, () => {
    return appStateStore.getState();
  });

  ipcMain.handle(IPC_CHANNELS.GET_ROLE, (event) => {
    return getRoleByWebContentsId(event.sender.id);
  });

  ipcMain.handle(IPC_CHANNELS.CREATE_TASK, (_event, title: string) => {
    const task: TaskRecord = {
      id: generateId('task'),
      title,
      status: 'queued',
      owner: 'user',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    eventBus.emit(AppEventType.TASK_CREATED, { task });
    return { id: task.id, title: task.title };
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_TASK_STATUS, (_event, taskId: string, status: TaskStatus) => {
    const state = appStateStore.getState();
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;
    const updated = { ...task, status, updatedAt: Date.now() };
    eventBus.emit(AppEventType.TASK_UPDATED, { task: updated });
    if (status === 'completed') {
      eventBus.emit(AppEventType.TASK_COMPLETED, { taskId });
    }
  });

  ipcMain.handle(IPC_CHANNELS.SET_ACTIVE_TASK, (_event, taskId: string | null) => {
    appStateStore.dispatch({ type: ActionType.SET_ACTIVE_TASK, taskId });
  });

  ipcMain.handle(IPC_CHANNELS.ADD_LOG, (_event, level: LogLevel, source: LogSource, message: string, taskId?: string) => {
    const log = {
      id: generateId('log'),
      timestamp: Date.now(),
      level,
      source,
      message,
      taskId,
    };
    eventBus.emit(AppEventType.LOG_ADDED, { log });
  });

  // Execution split control
  ipcMain.handle(IPC_CHANNELS.APPLY_EXECUTION_PRESET, (_event, preset: ExecutionLayoutPreset) => {
    eventBus.emit(AppEventType.EXECUTION_LAYOUT_APPLIED, { preset });
  });

  ipcMain.handle(IPC_CHANNELS.SET_SPLIT_RATIO, (_event, ratio: number) => {
    const clamped = Math.max(0.15, Math.min(0.85, ratio));
    eventBus.emit(AppEventType.EXECUTION_SPLIT_CHANGED, { ratio: clamped });
  });

  // ── Surface action IPC handlers ──────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.SUBMIT_SURFACE_ACTION, async (_event, input: SurfaceActionInput) => {
    return surfaceActionRouter.submit(input);
  });

  ipcMain.handle(IPC_CHANNELS.CANCEL_QUEUED_ACTION, (_event, actionId: string) => {
    return surfaceActionRouter.cancelQueuedAction(actionId);
  });

  ipcMain.handle(IPC_CHANNELS.GET_QUEUE_DIAGNOSTICS, () => {
    return surfaceActionRouter.getQueueDiagnostics();
  });

  ipcMain.handle(IPC_CHANNELS.GET_RECENT_ACTIONS, (_event, limit?: number) => {
    return surfaceActionRouter.getRecentActions(limit);
  });

  ipcMain.handle(IPC_CHANNELS.GET_ACTIONS_BY_TARGET, (_event, target: 'browser' | 'terminal', limit?: number) => {
    return surfaceActionRouter.getActionsByTarget(target, limit);
  });

  ipcMain.handle(IPC_CHANNELS.GET_ACTIONS_BY_TASK, (_event, taskId: string) => {
    return surfaceActionRouter.getActionsByTask(taskId);
  });

  // Terminal session IPC handlers
  ipcMain.handle(IPC_CHANNELS.TERMINAL_START_SESSION, (_event, cols?: number, rows?: number) => {
    return terminalService.startSession(cols, rows);
  });

  ipcMain.handle(IPC_CHANNELS.TERMINAL_GET_SESSION, () => {
    return terminalService.getSession();
  });

  ipcMain.handle(IPC_CHANNELS.TERMINAL_WRITE, (_event, data: string) => {
    terminalService.write(data);
  });

  ipcMain.handle(IPC_CHANNELS.TERMINAL_RESIZE, (_event, cols: number, rows: number) => {
    terminalService.resize(cols, rows);
  });

  ipcMain.handle(IPC_CHANNELS.TERMINAL_CAPTURE_SCROLLBACK, () => {
    return terminalService.captureScrollback();
  });

  // ── Browser runtime IPC handlers ─────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.BROWSER_GET_STATE, () => {
    return browserService.getState();
  });

  ipcMain.handle(IPC_CHANNELS.BROWSER_GET_HISTORY, () => {
    return browserService.getHistory();
  });

  ipcMain.handle(IPC_CHANNELS.BROWSER_CLEAR_HISTORY, () => {
    browserService.clearHistory();
  });

  ipcMain.handle(IPC_CHANNELS.BROWSER_CLEAR_DATA, async () => {
    await browserService.clearData();
  });

  ipcMain.handle(IPC_CHANNELS.BROWSER_REPORT_BOUNDS, (_event, bounds: { x: number; y: number; width: number; height: number }) => {
    browserService.setBounds(bounds);
  });

  ipcMain.handle(IPC_CHANNELS.BROWSER_GET_TABS, () => {
    return browserService.getTabs();
  });
  ipcMain.handle(IPC_CHANNELS.BROWSER_CAPTURE_TAB_SNAPSHOT, (_event, tabId?: string) => {
    return browserService.captureTabSnapshot(tabId);
  });
  ipcMain.handle(IPC_CHANNELS.BROWSER_GET_ACTIONABLE_ELEMENTS, (_event, tabId?: string) => {
    return browserService.getActionableElements(tabId);
  });
  ipcMain.handle(IPC_CHANNELS.BROWSER_GET_FORM_MODEL, (_event, tabId?: string) => {
    return browserService.getFormModel(tabId);
  });
  ipcMain.handle(IPC_CHANNELS.BROWSER_GET_CONSOLE_EVENTS, (_event, tabId?: string, since?: number) => {
    return browserService.getConsoleEvents(tabId, since);
  });
  ipcMain.handle(IPC_CHANNELS.BROWSER_GET_NETWORK_EVENTS, (_event, tabId?: string, since?: number) => {
    return browserService.getNetworkEvents(tabId, since);
  });
  ipcMain.handle(IPC_CHANNELS.BROWSER_RECORD_FINDING, (_event, input: { taskId: string; tabId?: string; title: string; summary: string; severity?: 'info' | 'warning' | 'critical'; evidence?: string[]; snapshotId?: string | null }) => {
    return browserService.recordTabFinding(input);
  });
  ipcMain.handle(IPC_CHANNELS.BROWSER_GET_TASK_MEMORY, (_event, taskId: string) => {
    return browserService.getTaskBrowserMemory(taskId);
  });
  ipcMain.handle(IPC_CHANNELS.BROWSER_GET_SITE_STRATEGY, (_event, origin: string) => {
    return browserService.getSiteStrategy(origin);
  });
  ipcMain.handle(IPC_CHANNELS.BROWSER_SAVE_SITE_STRATEGY, (_event, input: { origin: string; primaryRoutes?: string[]; primaryLabels?: string[]; panelKeywords?: string[]; notes?: string[] }) => {
    return browserService.saveSiteStrategy(input);
  });
  ipcMain.handle(IPC_CHANNELS.BROWSER_EXPORT_SURFACE_EVAL_FIXTURE, (_event, input: { name: string; tabId?: string }) => {
    return browserService.exportSurfaceEvalFixture(input);
  });

  // Bookmarks
  ipcMain.handle(IPC_CHANNELS.BROWSER_ADD_BOOKMARK, (_event, url: string, title: string) => {
    return browserService.addBookmark(url, title);
  });
  ipcMain.handle(IPC_CHANNELS.BROWSER_REMOVE_BOOKMARK, (_event, bookmarkId: string) => {
    browserService.removeBookmark(bookmarkId);
  });
  ipcMain.handle(IPC_CHANNELS.BROWSER_GET_BOOKMARKS, () => {
    return browserService.getBookmarks();
  });

  // Zoom
  ipcMain.handle(IPC_CHANNELS.BROWSER_ZOOM_IN, () => { browserService.zoomIn(); });
  ipcMain.handle(IPC_CHANNELS.BROWSER_ZOOM_OUT, () => { browserService.zoomOut(); });
  ipcMain.handle(IPC_CHANNELS.BROWSER_ZOOM_RESET, () => { browserService.zoomReset(); });

  // Find in page
  ipcMain.handle(IPC_CHANNELS.BROWSER_FIND_IN_PAGE, (_event, query: string) => { browserService.findInPage(query); });
  ipcMain.handle(IPC_CHANNELS.BROWSER_FIND_NEXT, () => { browserService.findNext(); });
  ipcMain.handle(IPC_CHANNELS.BROWSER_FIND_PREVIOUS, () => { browserService.findPrevious(); });
  ipcMain.handle(IPC_CHANNELS.BROWSER_STOP_FIND, () => { browserService.stopFind(); });

  // DevTools
  ipcMain.handle(IPC_CHANNELS.BROWSER_TOGGLE_DEVTOOLS, () => { browserService.toggleDevTools(); });

  // Settings
  ipcMain.handle(IPC_CHANNELS.BROWSER_GET_SETTINGS, () => { return browserService.getSettings(); });
  ipcMain.handle(IPC_CHANNELS.BROWSER_UPDATE_SETTINGS, (_event, settings: any) => { browserService.updateSettings(settings); });
  ipcMain.handle(IPC_CHANNELS.BROWSER_GET_AUTH_DIAGNOSTICS, () => { return browserService.getAuthDiagnostics(); });
  ipcMain.handle(IPC_CHANNELS.BROWSER_CLEAR_GOOGLE_AUTH_STATE, () => { return browserService.clearGoogleAuthState(); });

  // Extensions
  ipcMain.handle(IPC_CHANNELS.BROWSER_LOAD_EXTENSION, async (_event, extPath: string) => { return browserService.loadExtension(extPath); });
  ipcMain.handle(IPC_CHANNELS.BROWSER_REMOVE_EXTENSION, async (_event, extensionId: string) => { browserService.removeExtension(extensionId); });
  ipcMain.handle(IPC_CHANNELS.BROWSER_GET_EXTENSIONS, () => { return browserService.getExtensions(); });

  // Downloads
  ipcMain.handle(IPC_CHANNELS.BROWSER_GET_DOWNLOADS, () => { return browserService.getDownloads(); });
  ipcMain.handle(IPC_CHANNELS.BROWSER_CANCEL_DOWNLOAD, (_event, downloadId: string) => { browserService.cancelDownload(downloadId); });
  ipcMain.handle(IPC_CHANNELS.BROWSER_CLEAR_DOWNLOADS, () => { browserService.clearDownloads(); });

  // Cookie re-import
  ipcMain.handle('browser:reimport-cookies', async () => {
    return browserService.reimportChromeCookies();
  });

  // ── Agent model IPC handlers ───────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.MODEL_INVOKE, async (_event, taskId: string, prompt: string) => {
    return agentModelService.invoke(taskId, prompt);
  });

  ipcMain.handle(IPC_CHANNELS.MODEL_CANCEL, (_event, taskId: string) => {
    return agentModelService.cancel(taskId);
  });

  ipcMain.handle(IPC_CHANNELS.MODEL_GET_PROVIDERS, () => {
    return agentModelService.getProviderStatuses();
  });

  ipcMain.handle(IPC_CHANNELS.MODEL_GET_TASK_MEMORY, (_event, taskId: string) => {
    return agentModelService.getTaskMemory(taskId);
  });

  ipcMain.handle(IPC_CHANNELS.MODEL_RESOLVE, (_event, prompt: string, explicitOwner?: string) => {
    return agentModelService.resolve(prompt, explicitOwner);
  });

  ipcMain.handle(IPC_CHANNELS.MODEL_HANDOFF, () => {
    throw new Error('Model handoff is not implemented in the v2 agent runtime yet.');
  });

  ipcMain.handle(
    IPC_CHANNELS.MODEL_RUN_INTENT_PROGRAM,
    async (_event, taskId: string, input: { instructions: Array<Record<string, unknown>>; tabId?: string; failFast?: boolean }) => {
      return agentToolExecutor.execute('browser.run_intent_program', input, {
        runId: generateId('run'),
        agentId: 'haiku',
        mode: 'unrestricted-dev',
        taskId,
      });
    },
  );

  // Debug: test disk extraction on active browser tab
  ipcMain.handle(IPC_CHANNELS.DEBUG_TEST_DISK_EXTRACT, async () => {
    const cacheDir = path.join(os.homedir(), 'Desktop', 'v2-disk-cache');
    const cache = new DiskCache(cacheDir);
    const executeInPage = (expr: string, tabId?: string) => browserService.executeInPage(expr, tabId);
    const extractor = new PageExtractor(executeInPage);

    const state = browserService.getState();
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
