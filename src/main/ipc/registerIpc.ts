import { ipcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../../shared/types/ipc';
import type { AgentInvocationOptions } from '../../shared/types/model';
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

type TrustedIpcEvent = IpcMainEvent | IpcMainInvokeEvent;

function isTrustedIpcSender(event: TrustedIpcEvent): boolean {
  const senderId = event.sender.id;
  if (getRoleByWebContentsId(senderId)) return true;
  return browserService.isKnownTabWebContents(senderId);
}

function safeOn<TArgs extends unknown[]>(
  channel: string,
  handler: (event: IpcMainEvent, ...args: TArgs) => void,
): void {
  ipcMain.on(channel, (event, ...args: TArgs) => {
    if (!isTrustedIpcSender(event)) {
      event.returnValue = { error: 'Untrusted IPC sender' };
      return;
    }
    handler(event, ...args);
  });
}

function safeHandle<TEventArgs extends unknown[], TResult>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: TEventArgs) => Promise<TResult> | TResult,
): void {
  ipcMain.handle(channel, (event, ...args: TEventArgs) => {
    if (!isTrustedIpcSender(event)) {
      throw new Error('Untrusted IPC sender');
    }
    return handler(event, ...args);
  });
}

export function registerIpc(): void {
  safeOn('browser:prompt-open-sync', (event, payload: { message?: string; defaultPrompt?: string; url?: string }) => {
    event.returnValue = browserService.openPromptDialogFallback({
      webContentsId: event.sender.id,
      message: typeof payload?.message === 'string' ? payload.message : '',
      defaultPrompt: typeof payload?.defaultPrompt === 'string' ? payload.defaultPrompt : '',
      url: typeof payload?.url === 'string' ? payload.url : '',
    });
  });

  safeOn('browser:prompt-poll-sync', (event, payload: { dialogId?: string }) => {
    const dialogId = typeof payload?.dialogId === 'string' ? payload.dialogId : '';
    event.returnValue = browserService.pollPromptDialogFallback(dialogId);
  });

  safeHandle(IPC_CHANNELS.GET_STATE, () => {
    return appStateStore.getState();
  });

  safeHandle(IPC_CHANNELS.GET_ROLE, (event) => {
    return getRoleByWebContentsId(event.sender.id);
  });

  safeHandle(IPC_CHANNELS.CREATE_TASK, (_event, title: string) => {
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

  safeHandle(IPC_CHANNELS.UPDATE_TASK_STATUS, (_event, taskId: string, status: TaskStatus) => {
    const state = appStateStore.getState();
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;
    const updated = { ...task, status, updatedAt: Date.now() };
    eventBus.emit(AppEventType.TASK_UPDATED, { task: updated });
    if (status === 'completed') {
      eventBus.emit(AppEventType.TASK_COMPLETED, { taskId });
    }
  });

  safeHandle(IPC_CHANNELS.SET_ACTIVE_TASK, (_event, taskId: string | null) => {
    appStateStore.dispatch({ type: ActionType.SET_ACTIVE_TASK, taskId });
  });

  safeHandle(IPC_CHANNELS.RESET_TOKEN_USAGE, () => {
    appStateStore.dispatch({ type: ActionType.RESET_TOKEN_USAGE });
  });

  safeHandle(IPC_CHANNELS.ADD_LOG, (_event, level: LogLevel, source: LogSource, message: string, taskId?: string) => {
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
  safeHandle(IPC_CHANNELS.APPLY_EXECUTION_PRESET, (_event, preset: ExecutionLayoutPreset) => {
    eventBus.emit(AppEventType.EXECUTION_LAYOUT_APPLIED, { preset });
  });

  safeHandle(IPC_CHANNELS.SET_SPLIT_RATIO, (_event, ratio: number) => {
    const clamped = Math.max(0.15, Math.min(0.85, ratio));
    eventBus.emit(AppEventType.EXECUTION_SPLIT_CHANGED, { ratio: clamped });
  });

  // ── Surface action IPC handlers ──────────────────────────────────────────

  safeHandle(IPC_CHANNELS.SUBMIT_SURFACE_ACTION, async (_event, input: SurfaceActionInput) => {
    return surfaceActionRouter.submit(input);
  });

  safeHandle(IPC_CHANNELS.CANCEL_QUEUED_ACTION, (_event, actionId: string) => {
    return surfaceActionRouter.cancelQueuedAction(actionId);
  });

  safeHandle(IPC_CHANNELS.GET_QUEUE_DIAGNOSTICS, () => {
    return surfaceActionRouter.getQueueDiagnostics();
  });

  safeHandle(IPC_CHANNELS.GET_RECENT_ACTIONS, (_event, limit?: number) => {
    return surfaceActionRouter.getRecentActions(limit);
  });

  safeHandle(IPC_CHANNELS.GET_ACTIONS_BY_TARGET, (_event, target: 'browser' | 'terminal', limit?: number) => {
    return surfaceActionRouter.getActionsByTarget(target, limit);
  });

  safeHandle(IPC_CHANNELS.GET_ACTIONS_BY_TASK, (_event, taskId: string) => {
    return surfaceActionRouter.getActionsByTask(taskId);
  });

  // Terminal session IPC handlers
  safeHandle(IPC_CHANNELS.TERMINAL_START_SESSION, (_event, cols?: number, rows?: number) => {
    return terminalService.startSession(cols, rows);
  });

  safeHandle(IPC_CHANNELS.TERMINAL_GET_SESSION, () => {
    return terminalService.getSession();
  });

  safeHandle(IPC_CHANNELS.TERMINAL_WRITE, (_event, data: string) => {
    terminalService.write(data);
  });

  safeHandle(IPC_CHANNELS.TERMINAL_RESIZE, (_event, cols: number, rows: number) => {
    terminalService.resize(cols, rows);
  });

  safeHandle(IPC_CHANNELS.TERMINAL_CAPTURE_SCROLLBACK, () => {
    return terminalService.captureScrollback();
  });

  // ── Browser runtime IPC handlers ─────────────────────────────────────

  safeHandle(IPC_CHANNELS.BROWSER_GET_STATE, () => {
    return browserService.getState();
  });

  safeHandle(IPC_CHANNELS.BROWSER_GET_HISTORY, () => {
    return browserService.getHistory();
  });

  safeHandle(IPC_CHANNELS.BROWSER_CLEAR_HISTORY, () => {
    browserService.clearHistory();
  });

  safeHandle(IPC_CHANNELS.BROWSER_CLEAR_DATA, async () => {
    await browserService.clearData();
  });
  safeHandle(IPC_CHANNELS.BROWSER_CLEAR_SITE_DATA, async (_event, origin?: string) => {
    return browserService.clearSiteData(origin);
  });

  safeHandle(IPC_CHANNELS.BROWSER_REPORT_BOUNDS, (_event, bounds: { x: number; y: number; width: number; height: number }) => {
    browserService.setBounds(bounds);
  });

  safeHandle(IPC_CHANNELS.BROWSER_GET_TABS, () => {
    return browserService.getTabs();
  });
  safeHandle(IPC_CHANNELS.BROWSER_CAPTURE_TAB_SNAPSHOT, (_event, tabId?: string) => {
    return browserService.captureTabSnapshot(tabId);
  });
  safeHandle(IPC_CHANNELS.BROWSER_GET_ACTIONABLE_ELEMENTS, (_event, tabId?: string) => {
    return browserService.getActionableElements(tabId);
  });
  safeHandle(IPC_CHANNELS.BROWSER_GET_FORM_MODEL, (_event, tabId?: string) => {
    return browserService.getFormModel(tabId);
  });
  safeHandle(IPC_CHANNELS.BROWSER_GET_CONSOLE_EVENTS, (_event, tabId?: string, since?: number) => {
    return browserService.getConsoleEvents(tabId, since);
  });
  safeHandle(IPC_CHANNELS.BROWSER_GET_NETWORK_EVENTS, (_event, tabId?: string, since?: number) => {
    return browserService.getNetworkEvents(tabId, since);
  });
  safeHandle(IPC_CHANNELS.BROWSER_RECORD_FINDING, (_event, input: { taskId: string; tabId?: string; title: string; summary: string; severity?: 'info' | 'warning' | 'critical'; evidence?: string[]; snapshotId?: string | null }) => {
    return browserService.recordTabFinding(input);
  });
  safeHandle(IPC_CHANNELS.BROWSER_GET_TASK_MEMORY, (_event, taskId: string) => {
    return browserService.getTaskBrowserMemory(taskId);
  });
  safeHandle(IPC_CHANNELS.BROWSER_GET_SITE_STRATEGY, (_event, origin: string) => {
    return browserService.getSiteStrategy(origin);
  });
  safeHandle(IPC_CHANNELS.BROWSER_SAVE_SITE_STRATEGY, (_event, input: { origin: string; primaryRoutes?: string[]; primaryLabels?: string[]; panelKeywords?: string[]; notes?: string[] }) => {
    return browserService.saveSiteStrategy(input);
  });
  safeHandle(IPC_CHANNELS.BROWSER_EXPORT_SURFACE_EVAL_FIXTURE, (_event, input: { name: string; tabId?: string }) => {
    return browserService.exportSurfaceEvalFixture(input);
  });

  // Bookmarks
  safeHandle(IPC_CHANNELS.BROWSER_ADD_BOOKMARK, (_event, url: string, title: string) => {
    return browserService.addBookmark(url, title);
  });
  safeHandle(IPC_CHANNELS.BROWSER_REMOVE_BOOKMARK, (_event, bookmarkId: string) => {
    browserService.removeBookmark(bookmarkId);
  });
  safeHandle(IPC_CHANNELS.BROWSER_GET_BOOKMARKS, () => {
    return browserService.getBookmarks();
  });

  // Zoom
  safeHandle(IPC_CHANNELS.BROWSER_ZOOM_IN, () => { browserService.zoomIn(); });
  safeHandle(IPC_CHANNELS.BROWSER_ZOOM_OUT, () => { browserService.zoomOut(); });
  safeHandle(IPC_CHANNELS.BROWSER_ZOOM_RESET, () => { browserService.zoomReset(); });

  // Find in page
  safeHandle(IPC_CHANNELS.BROWSER_FIND_IN_PAGE, (_event, query: string) => { browserService.findInPage(query); });
  safeHandle(IPC_CHANNELS.BROWSER_FIND_NEXT, () => { browserService.findNext(); });
  safeHandle(IPC_CHANNELS.BROWSER_FIND_PREVIOUS, () => { browserService.findPrevious(); });
  safeHandle(IPC_CHANNELS.BROWSER_STOP_FIND, () => { browserService.stopFind(); });

  // DevTools
  safeHandle(IPC_CHANNELS.BROWSER_TOGGLE_DEVTOOLS, () => { browserService.toggleDevTools(); });

  // Settings
  safeHandle(IPC_CHANNELS.BROWSER_GET_SETTINGS, () => { return browserService.getSettings(); });
  safeHandle(IPC_CHANNELS.BROWSER_UPDATE_SETTINGS, (_event, settings: any) => { browserService.updateSettings(settings); });
  safeHandle(IPC_CHANNELS.BROWSER_GET_AUTH_DIAGNOSTICS, () => { return browserService.getAuthDiagnostics(); });
  safeHandle(IPC_CHANNELS.BROWSER_CLEAR_GOOGLE_AUTH_STATE, () => { return browserService.clearGoogleAuthState(); });

  // Extensions
  safeHandle(IPC_CHANNELS.BROWSER_LOAD_EXTENSION, async (_event, extPath: string) => { return browserService.loadExtension(extPath); });
  safeHandle(IPC_CHANNELS.BROWSER_REMOVE_EXTENSION, async (_event, extensionId: string) => { browserService.removeExtension(extensionId); });
  safeHandle(IPC_CHANNELS.BROWSER_GET_EXTENSIONS, () => { return browserService.getExtensions(); });
  safeHandle(IPC_CHANNELS.BROWSER_SPLIT_TAB, (_event, tabId?: string) => { return browserService.splitTab(tabId); });
  safeHandle(IPC_CHANNELS.BROWSER_CLEAR_SPLIT_VIEW, () => { return browserService.clearSplitView(); });

  // Downloads
  safeHandle(IPC_CHANNELS.BROWSER_GET_DOWNLOADS, () => { return browserService.getDownloads(); });
  safeHandle(IPC_CHANNELS.BROWSER_CANCEL_DOWNLOAD, (_event, downloadId: string) => { browserService.cancelDownload(downloadId); });
  safeHandle(IPC_CHANNELS.BROWSER_CLEAR_DOWNLOADS, () => { browserService.clearDownloads(); });

  // Cookie re-import
  safeHandle('browser:reimport-cookies', async () => {
    return browserService.reimportChromeCookies();
  });

  // ── Agent model IPC handlers ───────────────────────────────────────

  safeHandle(IPC_CHANNELS.MODEL_INVOKE, async (_event, taskId: string, prompt: string, owner?: string, options?: AgentInvocationOptions) => {
    return agentModelService.invoke(taskId, prompt, owner, options);
  });

  safeHandle(IPC_CHANNELS.MODEL_CANCEL, (_event, taskId: string) => {
    return agentModelService.cancel(taskId);
  });

  safeHandle(IPC_CHANNELS.MODEL_GET_PROVIDERS, () => {
    return agentModelService.getProviderStatuses();
  });

  safeHandle(IPC_CHANNELS.MODEL_GET_TASK_MEMORY, (_event, taskId: string) => {
    return agentModelService.getTaskMemory(taskId);
  });

  safeHandle(IPC_CHANNELS.MODEL_RESOLVE, (_event, prompt: string, explicitOwner?: string, options?: AgentInvocationOptions) => {
    return agentModelService.resolve(prompt, explicitOwner, options);
  });

  safeHandle(IPC_CHANNELS.MODEL_HANDOFF, () => {
    throw new Error('Model handoff is not implemented in the v2 agent runtime yet.');
  });

  safeHandle(
    IPC_CHANNELS.MODEL_RUN_INTENT_PROGRAM,
    async (_event, taskId: string, input: { instructions: Array<Record<string, unknown>>; tabId?: string; failFast?: boolean }) => {
      return agentToolExecutor.execute('browser.run_intent_program', input, {
        runId: generateId('run'),
        agentId: agentModelService.resolve('browser intent program'),
        mode: 'unrestricted-dev',
        taskId,
      });
    },
  );

  // Debug: test disk extraction on active browser tab
  safeHandle(IPC_CHANNELS.DEBUG_TEST_DISK_EXTRACT, async () => {
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
