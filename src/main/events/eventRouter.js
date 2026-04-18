"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initEventRouter = initEventRouter;
const electron_1 = require("electron");
const eventBus_1 = require("./eventBus");
const appStateStore_1 = require("../state/appStateStore");
const actions_1 = require("../state/actions");
const events_1 = require("../../shared/types/events");
const ipc_1 = require("../../shared/types/ipc");
const ids_1 = require("../../shared/utils/ids");
const appState_1 = require("../../shared/types/appState");
function broadcastToRenderers(event) {
    for (const win of electron_1.BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && win.webContents) {
            win.webContents.send(ipc_1.IPC_CHANNELS.EVENT_BROADCAST, event.type, event.payload);
        }
    }
}
function broadcastOnChannel(channel, data) {
    for (const win of electron_1.BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && win.webContents) {
            win.webContents.send(channel, data);
        }
    }
}
function broadcastState() {
    broadcastOnChannel(ipc_1.IPC_CHANNELS.STATE_UPDATE, appStateStore_1.appStateStore.getState());
}
let stateBroadcastTimer = null;
function scheduleStateBroadcast() {
    if (stateBroadcastTimer)
        return;
    stateBroadcastTimer = setTimeout(() => {
        stateBroadcastTimer = null;
        broadcastState();
    }, 16);
}
function initEventRouter() {
    // Every event gets broadcast to renderers
    eventBus_1.eventBus.onAny((event) => {
        broadcastToRenderers(event);
    });
    // State changes trigger state broadcast
    appStateStore_1.appStateStore.subscribe(() => {
        scheduleStateBroadcast();
    });
    // Wire specific events to state mutations
    eventBus_1.eventBus.on(events_1.AppEventType.TASK_CREATED, (event) => {
        appStateStore_1.appStateStore.dispatch({ type: actions_1.ActionType.ADD_TASK, task: event.payload.task });
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.ADD_LOG,
            log: {
                id: (0, ids_1.generateId)('log'),
                timestamp: Date.now(),
                level: 'info',
                source: 'system',
                message: `Task created: ${event.payload.task.title}`,
                taskId: event.payload.task.id,
            },
        });
    });
    eventBus_1.eventBus.on(events_1.AppEventType.TASK_UPDATED, (event) => {
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.UPDATE_TASK,
            taskId: event.payload.task.id,
            updates: { status: event.payload.task.status, updatedAt: event.payload.task.updatedAt },
        });
    });
    eventBus_1.eventBus.on(events_1.AppEventType.TASK_COMPLETED, (event) => {
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.UPDATE_TASK,
            taskId: event.payload.taskId,
            updates: { status: 'completed', updatedAt: Date.now() },
        });
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.ADD_LOG,
            log: {
                id: (0, ids_1.generateId)('log'),
                timestamp: Date.now(),
                level: 'info',
                source: 'system',
                message: `Task completed: ${event.payload.taskId}`,
                taskId: event.payload.taskId,
            },
        });
    });
    eventBus_1.eventBus.on(events_1.AppEventType.LOG_ADDED, (event) => {
        appStateStore_1.appStateStore.dispatch({ type: actions_1.ActionType.ADD_LOG, log: event.payload.log });
    });
    eventBus_1.eventBus.on(events_1.AppEventType.WINDOW_BOUNDS_CHANGED, (event) => {
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.SET_WINDOW_BOUNDS,
            role: event.payload.role,
            bounds: event.payload.bounds,
            displayId: event.payload.displayId,
        });
    });
    eventBus_1.eventBus.on(events_1.AppEventType.WINDOW_FOCUSED, (event) => {
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.SET_WINDOW_FOCUSED,
            role: event.payload.role,
            isFocused: true,
        });
    });
    // Execution split events
    eventBus_1.eventBus.on(events_1.AppEventType.EXECUTION_LAYOUT_APPLIED, (event) => {
        const ratio = (0, appState_1.presetToRatio)(event.payload.preset);
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.SET_EXECUTION_SPLIT,
            split: { preset: event.payload.preset, ratio },
        });
    });
    eventBus_1.eventBus.on(events_1.AppEventType.EXECUTION_SPLIT_CHANGED, (event) => {
        const state = appStateStore_1.appStateStore.getState();
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.SET_EXECUTION_SPLIT,
            split: { preset: state.executionSplit.preset, ratio: event.payload.ratio },
        });
    });
    // ── Surface action events ──────────────────────────────────────────────
    eventBus_1.eventBus.on(events_1.AppEventType.SURFACE_ACTION_SUBMITTED, (event) => {
        broadcastOnChannel('workspace:surface-action-update', event.payload.record);
    });
    eventBus_1.eventBus.on(events_1.AppEventType.SURFACE_ACTION_STARTED, (event) => {
        broadcastOnChannel('workspace:surface-action-update', event.payload.record);
    });
    eventBus_1.eventBus.on(events_1.AppEventType.SURFACE_ACTION_COMPLETED, (event) => {
        broadcastOnChannel('workspace:surface-action-update', event.payload.record);
    });
    eventBus_1.eventBus.on(events_1.AppEventType.SURFACE_ACTION_FAILED, (event) => {
        broadcastOnChannel('workspace:surface-action-update', event.payload.record);
    });
    // Terminal session output: broadcast on dedicated channel
    eventBus_1.eventBus.on(events_1.AppEventType.TERMINAL_SESSION_OUTPUT, (event) => {
        broadcastOnChannel('terminal:output', event.payload.data);
    });
    eventBus_1.eventBus.on(events_1.AppEventType.TERMINAL_STATUS_UPDATED, () => {
        // Handled by onAny broadcast and TerminalService.updateState()
    });
    eventBus_1.eventBus.on(events_1.AppEventType.TERMINAL_SESSION_EXITED, (event) => {
        broadcastOnChannel('terminal:exit', event.payload.exitCode);
    });
    eventBus_1.eventBus.on(events_1.AppEventType.TERMINAL_SESSION_STARTED, (event) => {
        broadcastOnChannel('terminal:status', event.payload.session);
    });
    eventBus_1.eventBus.on(events_1.AppEventType.TERMINAL_SESSION_RESTARTED, (event) => {
        broadcastOnChannel('terminal:status', event.payload.session);
    });
    eventBus_1.eventBus.on(events_1.AppEventType.TERMINAL_SESSION_REATTACHED, (event) => {
        broadcastOnChannel('terminal:status', event.payload.session);
    });
    // ── Browser runtime events ─────────────────────────────────────────────
    eventBus_1.eventBus.on(events_1.AppEventType.BROWSER_SURFACE_CREATED, (event) => {
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.ADD_LOG,
            log: {
                id: (0, ids_1.generateId)('log'),
                timestamp: Date.now(),
                level: 'info',
                source: 'browser',
                message: `Browser surface created (profile: ${event.payload.profileId})`,
            },
        });
    });
    // Push browser state and nav updates to renderers on dedicated channels
    eventBus_1.eventBus.on(events_1.AppEventType.BROWSER_STATE_CHANGED, (event) => {
        broadcastOnChannel('browser:state-update', event.payload.state);
    });
    eventBus_1.eventBus.on(events_1.AppEventType.BROWSER_NAVIGATION_UPDATED, (event) => {
        broadcastOnChannel('browser:nav-update', event.payload.navigation);
    });
    eventBus_1.eventBus.on(events_1.AppEventType.BROWSER_NAVIGATION_FAILED, (event) => {
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.ADD_LOG,
            log: {
                id: (0, ids_1.generateId)('log'),
                timestamp: Date.now(),
                level: 'error',
                source: 'browser',
                message: `Navigation failed: ${event.payload.errorDescription} (${event.payload.url})`,
            },
        });
    });
    eventBus_1.eventBus.on(events_1.AppEventType.BROWSER_DOWNLOAD_STARTED, (event) => {
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.ADD_LOG,
            log: {
                id: (0, ids_1.generateId)('log'),
                timestamp: Date.now(),
                level: 'info',
                source: 'browser',
                message: `Download started: ${event.payload.download.filename}`,
            },
        });
    });
    eventBus_1.eventBus.on(events_1.AppEventType.BROWSER_DOWNLOAD_COMPLETED, (event) => {
        const dl = event.payload.download;
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.ADD_LOG,
            log: {
                id: (0, ids_1.generateId)('log'),
                timestamp: Date.now(),
                level: dl.state === 'completed' ? 'info' : 'warn',
                source: 'browser',
                message: `Download ${dl.state}: ${dl.filename}`,
            },
        });
    });
    // ── Model events ──────────────────────────────────────────────────
    eventBus_1.eventBus.on(events_1.AppEventType.MODEL_PROVIDER_DETECTED, (event) => {
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.ADD_LOG,
            log: {
                id: (0, ids_1.generateId)('log'),
                timestamp: Date.now(),
                level: event.payload.available ? 'info' : 'warn',
                source: 'system',
                message: `Provider ${event.payload.providerId}: ${event.payload.available ? 'available' : 'unavailable'} (${event.payload.detail})`,
            },
        });
    });
    eventBus_1.eventBus.on(events_1.AppEventType.MODEL_INVOCATION_PROGRESS, (event) => {
        broadcastOnChannel(ipc_1.IPC_CHANNELS.MODEL_PROGRESS, event.payload.progress);
    });
    eventBus_1.eventBus.on(events_1.AppEventType.MODEL_INVOCATION_STARTED, (event) => {
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.UPDATE_TASK,
            taskId: event.payload.taskId,
            updates: { status: 'running', updatedAt: Date.now() },
        });
        appStateStore_1.appStateStore.dispatch({ type: actions_1.ActionType.SET_ACTIVE_TASK, taskId: event.payload.taskId });
    });
    eventBus_1.eventBus.on(events_1.AppEventType.MODEL_INVOCATION_COMPLETED, (event) => {
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.UPDATE_TASK,
            taskId: event.payload.result.taskId,
            updates: { status: 'completed', updatedAt: Date.now() },
        });
    });
    eventBus_1.eventBus.on(events_1.AppEventType.MODEL_INVOCATION_FAILED, (event) => {
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.UPDATE_TASK,
            taskId: event.payload.taskId,
            updates: { status: 'failed', updatedAt: Date.now() },
        });
    });
    eventBus_1.eventBus.on(events_1.AppEventType.BROWSER_PERMISSION_RESOLVED, (event) => {
        const req = event.payload.request;
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.ADD_LOG,
            log: {
                id: (0, ids_1.generateId)('log'),
                timestamp: Date.now(),
                level: req.decision === 'granted' ? 'info' : 'warn',
                source: 'browser',
                message: `Permission ${req.permission}: ${req.decision} (${req.origin})`,
            },
        });
    });
}
//# sourceMappingURL=eventRouter.js.map