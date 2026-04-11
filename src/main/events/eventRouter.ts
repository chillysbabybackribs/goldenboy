import { BrowserWindow } from 'electron';
import { eventBus } from './eventBus';
import { appStateStore } from '../state/appStateStore';
import { ActionType } from '../state/actions';
import { AppEventType, AppEvent } from '../../shared/types/events';
import { IPC_CHANNELS } from '../../shared/types/ipc';
import { generateId } from '../../shared/utils/ids';
import { presetToRatio } from '../../shared/types/appState';

function broadcastToRenderers(event: AppEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.webContents) {
      win.webContents.send(IPC_CHANNELS.EVENT_BROADCAST, event.type, event.payload);
    }
  }
}

function broadcastOnChannel(channel: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.webContents) {
      win.webContents.send(channel, data);
    }
  }
}

function broadcastState(): void {
  broadcastOnChannel(IPC_CHANNELS.STATE_UPDATE, appStateStore.getState());
}

export function initEventRouter(): void {
  // Every event gets broadcast to renderers
  eventBus.onAny((event) => {
    broadcastToRenderers(event);
  });

  // State changes trigger state broadcast
  appStateStore.subscribe(() => {
    broadcastState();
  });

  // Wire specific events to state mutations
  eventBus.on(AppEventType.TASK_CREATED, (event) => {
    appStateStore.dispatch({ type: ActionType.ADD_TASK, task: event.payload.task });
    appStateStore.dispatch({
      type: ActionType.ADD_LOG,
      log: {
        id: generateId('log'),
        timestamp: Date.now(),
        level: 'info',
        source: 'system',
        message: `Task created: ${event.payload.task.title}`,
        taskId: event.payload.task.id,
      },
    });
  });

  eventBus.on(AppEventType.TASK_UPDATED, (event) => {
    appStateStore.dispatch({
      type: ActionType.UPDATE_TASK,
      taskId: event.payload.task.id,
      updates: { status: event.payload.task.status, updatedAt: event.payload.task.updatedAt },
    });
  });

  eventBus.on(AppEventType.TASK_COMPLETED, (event) => {
    appStateStore.dispatch({
      type: ActionType.UPDATE_TASK,
      taskId: event.payload.taskId,
      updates: { status: 'completed', updatedAt: Date.now() },
    });
    appStateStore.dispatch({
      type: ActionType.ADD_LOG,
      log: {
        id: generateId('log'),
        timestamp: Date.now(),
        level: 'info',
        source: 'system',
        message: `Task completed: ${event.payload.taskId}`,
        taskId: event.payload.taskId,
      },
    });
  });

  eventBus.on(AppEventType.LOG_ADDED, (event) => {
    appStateStore.dispatch({ type: ActionType.ADD_LOG, log: event.payload.log });
  });

  eventBus.on(AppEventType.WINDOW_BOUNDS_CHANGED, (event) => {
    appStateStore.dispatch({
      type: ActionType.SET_WINDOW_BOUNDS,
      role: event.payload.role,
      bounds: event.payload.bounds,
      displayId: event.payload.displayId,
    });
  });

  eventBus.on(AppEventType.WINDOW_FOCUSED, (event) => {
    appStateStore.dispatch({
      type: ActionType.SET_WINDOW_FOCUSED,
      role: event.payload.role,
      isFocused: true,
    });
  });

  // Execution split events
  eventBus.on(AppEventType.EXECUTION_LAYOUT_APPLIED, (event) => {
    const ratio = presetToRatio(event.payload.preset);
    appStateStore.dispatch({
      type: ActionType.SET_EXECUTION_SPLIT,
      split: { preset: event.payload.preset, ratio },
    });
  });

  eventBus.on(AppEventType.EXECUTION_SPLIT_CHANGED, (event) => {
    const state = appStateStore.getState();
    appStateStore.dispatch({
      type: ActionType.SET_EXECUTION_SPLIT,
      split: { preset: state.executionSplit.preset, ratio: event.payload.ratio },
    });
  });

  // ── Surface action events ──────────────────────────────────────────────

  eventBus.on(AppEventType.SURFACE_ACTION_SUBMITTED, (event) => {
    broadcastOnChannel('workspace:surface-action-update', event.payload.record);
  });

  eventBus.on(AppEventType.SURFACE_ACTION_STARTED, (event) => {
    broadcastOnChannel('workspace:surface-action-update', event.payload.record);
  });

  eventBus.on(AppEventType.SURFACE_ACTION_COMPLETED, (event) => {
    broadcastOnChannel('workspace:surface-action-update', event.payload.record);
  });

  eventBus.on(AppEventType.SURFACE_ACTION_FAILED, (event) => {
    broadcastOnChannel('workspace:surface-action-update', event.payload.record);
  });

  // Terminal session output: broadcast on dedicated channel
  eventBus.on(AppEventType.TERMINAL_SESSION_OUTPUT, (event) => {
    broadcastOnChannel('terminal:output', event.payload.data);
  });

  eventBus.on(AppEventType.TERMINAL_STATUS_UPDATED, () => {
    // Handled by onAny broadcast and TerminalService.updateState()
  });

  eventBus.on(AppEventType.TERMINAL_SESSION_EXITED, (event) => {
    broadcastOnChannel('terminal:exit', event.payload.exitCode);
  });

  eventBus.on(AppEventType.TERMINAL_SESSION_STARTED, (event) => {
    broadcastOnChannel('terminal:status', event.payload.session);
  });

  eventBus.on(AppEventType.TERMINAL_SESSION_RESTARTED, (event) => {
    broadcastOnChannel('terminal:status', event.payload.session);
  });

  eventBus.on(AppEventType.TERMINAL_SESSION_REATTACHED, (event) => {
    broadcastOnChannel('terminal:status', event.payload.session);
  });

  // ── Browser runtime events ─────────────────────────────────────────────

  eventBus.on(AppEventType.BROWSER_SURFACE_CREATED, (event) => {
    appStateStore.dispatch({
      type: ActionType.ADD_LOG,
      log: {
        id: generateId('log'),
        timestamp: Date.now(),
        level: 'info',
        source: 'browser',
        message: `Browser surface created (profile: ${event.payload.profileId})`,
      },
    });
  });

  // Push browser state and nav updates to renderers on dedicated channels
  eventBus.on(AppEventType.BROWSER_STATE_CHANGED, (event) => {
    broadcastOnChannel('browser:state-update', event.payload.state);
  });

  eventBus.on(AppEventType.BROWSER_NAVIGATION_UPDATED, (event) => {
    broadcastOnChannel('browser:nav-update', event.payload.navigation);
  });

  eventBus.on(AppEventType.BROWSER_NAVIGATION_FAILED, (event) => {
    appStateStore.dispatch({
      type: ActionType.ADD_LOG,
      log: {
        id: generateId('log'),
        timestamp: Date.now(),
        level: 'error',
        source: 'browser',
        message: `Navigation failed: ${event.payload.errorDescription} (${event.payload.url})`,
      },
    });
  });

  eventBus.on(AppEventType.BROWSER_DOWNLOAD_STARTED, (event) => {
    appStateStore.dispatch({
      type: ActionType.ADD_LOG,
      log: {
        id: generateId('log'),
        timestamp: Date.now(),
        level: 'info',
        source: 'browser',
        message: `Download started: ${event.payload.download.filename}`,
      },
    });
  });

  eventBus.on(AppEventType.BROWSER_DOWNLOAD_COMPLETED, (event) => {
    const dl = event.payload.download;
    appStateStore.dispatch({
      type: ActionType.ADD_LOG,
      log: {
        id: generateId('log'),
        timestamp: Date.now(),
        level: dl.state === 'completed' ? 'info' : 'warn',
        source: 'browser',
        message: `Download ${dl.state}: ${dl.filename}`,
      },
    });
  });

  // ── Model events ──────────────────────────────────────────────────

  eventBus.on(AppEventType.MODEL_PROVIDER_DETECTED, (event) => {
    appStateStore.dispatch({
      type: ActionType.ADD_LOG,
      log: {
        id: generateId('log'),
        timestamp: Date.now(),
        level: event.payload.available ? 'info' : 'warn',
        source: 'system',
        message: `Provider ${event.payload.providerId}: ${event.payload.available ? 'available' : 'unavailable'} (${event.payload.detail})`,
      },
    });
  });

  eventBus.on(AppEventType.MODEL_INVOCATION_PROGRESS, (event) => {
    broadcastOnChannel(IPC_CHANNELS.MODEL_PROGRESS, event.payload.progress);
  });

  eventBus.on(AppEventType.MODEL_INVOCATION_STARTED, (event) => {
    appStateStore.dispatch({
      type: ActionType.UPDATE_TASK,
      taskId: event.payload.taskId,
      updates: { status: 'running', updatedAt: Date.now() },
    });
    appStateStore.dispatch({ type: ActionType.SET_ACTIVE_TASK, taskId: event.payload.taskId });
  });

  eventBus.on(AppEventType.MODEL_INVOCATION_COMPLETED, (event) => {
    appStateStore.dispatch({
      type: ActionType.UPDATE_TASK,
      taskId: event.payload.result.taskId,
      updates: { status: 'completed', updatedAt: Date.now() },
    });
  });

  eventBus.on(AppEventType.MODEL_INVOCATION_FAILED, (event) => {
    appStateStore.dispatch({
      type: ActionType.UPDATE_TASK,
      taskId: event.payload.taskId,
      updates: { status: 'failed', updatedAt: Date.now() },
    });
  });

  eventBus.on(AppEventType.BROWSER_PERMISSION_RESOLVED, (event) => {
    const req = event.payload.request;
    appStateStore.dispatch({
      type: ActionType.ADD_LOG,
      log: {
        id: generateId('log'),
        timestamp: Date.now(),
        level: req.decision === 'granted' ? 'info' : 'warn',
        source: 'browser',
        message: `Permission ${req.permission}: ${req.decision} (${req.origin})`,
      },
    });
  });
}
