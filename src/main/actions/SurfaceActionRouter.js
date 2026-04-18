"use strict";
// ═══════════════════════════════════════════════════════════════════════════
// Surface Action Router — Main-process orchestration layer
// ═══════════════════════════════════════════════════════════════════════════
//
// Receives action inputs, validates, persists to state, routes to the
// correct runtime service, captures results, and emits lifecycle events.
Object.defineProperty(exports, "__esModule", { value: true });
exports.surfaceActionRouter = void 0;
const surfaceActionTypes_1 = require("../../shared/actions/surfaceActionTypes");
const appStateStore_1 = require("../state/appStateStore");
const actions_1 = require("../state/actions");
const eventBus_1 = require("../events/eventBus");
const events_1 = require("../../shared/types/events");
const ids_1 = require("../../shared/utils/ids");
const browserActionExecutor_1 = require("./browserActionExecutor");
const terminalActionExecutor_1 = require("./terminalActionExecutor");
const SurfaceExecutionController_1 = require("./SurfaceExecutionController");
const surfaceActionPolicy_1 = require("./surfaceActionPolicy");
const MAX_ACTIONS = 200;
class SurfaceActionRouter {
    browserController;
    terminalController;
    constructor() {
        const executeCb = (action) => this.executeAction(action);
        const failCb = (action, reason) => this.failActionByPolicy(action, reason);
        this.browserController = new SurfaceExecutionController_1.SurfaceExecutionController('browser', executeCb, failCb);
        this.terminalController = new SurfaceExecutionController_1.SurfaceExecutionController('terminal', executeCb, failCb);
    }
    async submit(input) {
        // Validate target matches kind
        const expectedTarget = (0, surfaceActionTypes_1.targetForKind)(input.kind);
        if (input.target !== expectedTarget) {
            throw new Error(`Action kind "${input.kind}" requires target "${expectedTarget}", got "${input.target}"`);
        }
        // Validate payload
        this.validatePayload(input.kind, input.payload);
        // Create the action
        const now = Date.now();
        const action = {
            id: (0, ids_1.generateId)('sa'),
            target: input.target,
            kind: input.kind,
            status: 'queued',
            origin: input.origin || 'command-center',
            payload: input.payload,
            createdAt: now,
            updatedAt: now,
            taskId: input.taskId ?? null,
        };
        // Create the record for state
        const record = this.toRecord(action);
        // Persist to state
        appStateStore_1.appStateStore.dispatch({ type: actions_1.ActionType.ADD_SURFACE_ACTION, record });
        // Emit submitted event
        eventBus_1.eventBus.emit(events_1.AppEventType.SURFACE_ACTION_SUBMITTED, { record: { ...record } });
        // Log the action
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.ADD_LOG,
            log: {
                id: (0, ids_1.generateId)('log'),
                timestamp: now,
                level: 'info',
                source: action.target,
                message: `Action submitted: ${record.payloadSummary}`,
                taskId: action.taskId ?? undefined,
            },
        });
        // Delegate to per-surface controller
        const controller = action.target === 'browser' ? this.browserController : this.terminalController;
        const policy = surfaceActionPolicy_1.ACTION_CONCURRENCY_POLICY[action.kind];
        try {
            controller.submit(action, policy);
        }
        catch (err) {
            // Policy rejection (e.g., terminal.write with no active action).
            // Record is already in state as 'queued' — transition to failed.
            const reason = err instanceof Error ? err.message : String(err);
            this.failActionByPolicy(action, reason);
        }
        return { ...record };
    }
    cancelQueuedAction(id) {
        const state = appStateStore_1.appStateStore.getState();
        const record = state.surfaceActions.find(a => a.id === id);
        if (!record) {
            throw new Error(`Action ${id} not found`);
        }
        if (record.status !== 'queued') {
            throw new Error(`Action ${id} is ${record.status}, not queued — cannot cancel`);
        }
        const controller = record.target === 'browser' ? this.browserController : this.terminalController;
        const removed = controller.cancelById(id, 'Cancelled by user');
        if (!removed) {
            // TOCTOU note: the state record may still show 'queued' briefly after drain()
            // promoted the action to the active slot but before executeAction() transitions
            // it to 'running'. The controller is authoritative — if cancelById returns false,
            // the action is no longer in the queue regardless of state-store lag.
            throw new Error(`Action ${id} is already running — cannot cancel`);
        }
        return this.getCurrentRecord(id);
    }
    getQueueDiagnostics() {
        return {
            browser: {
                active: this.browserController.getActive()?.id ?? null,
                queueLength: this.browserController.getQueueLength(),
            },
            terminal: {
                active: this.terminalController.getActive()?.id ?? null,
                queueLength: this.terminalController.getQueueLength(),
            },
        };
    }
    getRecentActions(limit = 50) {
        const state = appStateStore_1.appStateStore.getState();
        return state.surfaceActions.slice(-limit);
    }
    getActionsByTarget(target, limit = 50) {
        const state = appStateStore_1.appStateStore.getState();
        return state.surfaceActions.filter(a => a.target === target).slice(-limit);
    }
    getActionsByTask(taskId) {
        const state = appStateStore_1.appStateStore.getState();
        return state.surfaceActions.filter(a => a.taskId === taskId);
    }
    async executeAction(action) {
        const id = action.id;
        const isTerminalExecute = action.kind === 'terminal.execute';
        // Transition to running
        this.updateStatus(id, 'running');
        eventBus_1.eventBus.emit(events_1.AppEventType.SURFACE_ACTION_STARTED, { record: this.getCurrentRecord(id) });
        // Track terminal command state for terminal.execute actions
        if (isTerminalExecute) {
            const payload = action.payload;
            appStateStore_1.appStateStore.dispatch({
                type: actions_1.ActionType.SET_TERMINAL_COMMAND,
                command: {
                    dispatched: true,
                    lastDispatchedCommand: payload.command,
                    lastUpdatedAt: Date.now(),
                },
            });
        }
        try {
            let result;
            if (action.target === 'browser') {
                result = await (0, browserActionExecutor_1.executeBrowserAction)(action.kind, action.payload, {
                    taskId: action.taskId,
                    origin: action.origin,
                });
            }
            else {
                result = await (0, terminalActionExecutor_1.executeTerminalAction)(action.kind, action.payload);
            }
            // Transition to completed
            this.updateRecord(id, { status: 'completed', resultSummary: result.summary, resultData: result.data, updatedAt: Date.now() });
            eventBus_1.eventBus.emit(events_1.AppEventType.SURFACE_ACTION_COMPLETED, { record: this.getCurrentRecord(id) });
            // Update terminal command state on completion
            if (isTerminalExecute) {
                appStateStore_1.appStateStore.dispatch({
                    type: actions_1.ActionType.SET_TERMINAL_COMMAND,
                    command: {
                        dispatched: false,
                        lastDispatchedCommand: action.payload.command,
                        lastUpdatedAt: Date.now(),
                    },
                });
            }
            appStateStore_1.appStateStore.dispatch({
                type: actions_1.ActionType.ADD_LOG,
                log: {
                    id: (0, ids_1.generateId)('log'),
                    timestamp: Date.now(),
                    level: 'info',
                    source: action.target,
                    message: `Action completed: ${result.summary}`,
                    taskId: action.taskId ?? undefined,
                },
            });
        }
        catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            // Transition to failed
            this.updateRecord(id, { status: 'failed', error: errorMsg, updatedAt: Date.now() });
            eventBus_1.eventBus.emit(events_1.AppEventType.SURFACE_ACTION_FAILED, { record: this.getCurrentRecord(id) });
            // Update terminal command dispatch state on failure
            if (isTerminalExecute) {
                appStateStore_1.appStateStore.dispatch({
                    type: actions_1.ActionType.SET_TERMINAL_COMMAND,
                    command: {
                        dispatched: false,
                        lastDispatchedCommand: action.payload.command,
                        lastUpdatedAt: Date.now(),
                    },
                });
            }
            appStateStore_1.appStateStore.dispatch({
                type: actions_1.ActionType.ADD_LOG,
                log: {
                    id: (0, ids_1.generateId)('log'),
                    timestamp: Date.now(),
                    level: 'error',
                    source: action.target,
                    message: `Action failed: ${errorMsg}`,
                    taskId: action.taskId ?? undefined,
                },
            });
        }
    }
    failActionByPolicy(action, reason) {
        this.updateRecord(action.id, { status: 'failed', error: reason, updatedAt: Date.now() });
        eventBus_1.eventBus.emit(events_1.AppEventType.SURFACE_ACTION_FAILED, { record: this.getCurrentRecord(action.id) });
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.ADD_LOG,
            log: {
                id: (0, ids_1.generateId)('log'),
                timestamp: Date.now(),
                level: 'warn',
                source: action.target,
                message: `Action cancelled: ${reason}`,
                taskId: action.taskId ?? undefined,
            },
        });
    }
    validatePayload(kind, payload) {
        switch (kind) {
            case 'browser.navigate': {
                const p = payload;
                if (!p.url || typeof p.url !== 'string' || p.url.trim().length === 0) {
                    throw new Error('browser.navigate requires a non-empty "url" string');
                }
                break;
            }
            case 'terminal.execute': {
                const p = payload;
                if (!p.command || typeof p.command !== 'string' || p.command.trim().length === 0) {
                    throw new Error('terminal.execute requires a non-empty "command" string');
                }
                break;
            }
            case 'terminal.write': {
                const p = payload;
                if (typeof p.input !== 'string') {
                    throw new Error('terminal.write requires an "input" string');
                }
                break;
            }
            case 'browser.close-tab': {
                const p = payload;
                if (!p.tabId || typeof p.tabId !== 'string') {
                    throw new Error('browser.close-tab requires a non-empty "tabId" string');
                }
                break;
            }
            case 'browser.activate-tab': {
                const p = payload;
                if (!p.tabId || typeof p.tabId !== 'string') {
                    throw new Error('browser.activate-tab requires a non-empty "tabId" string');
                }
                break;
            }
            case 'browser.click': {
                const p = payload;
                if (!p.selector || typeof p.selector !== 'string' || p.selector.trim().length === 0) {
                    throw new Error('browser.click requires a non-empty "selector" string');
                }
                break;
            }
            case 'browser.type': {
                const p = payload;
                if (!p.selector || typeof p.selector !== 'string' || p.selector.trim().length === 0) {
                    throw new Error('browser.type requires a non-empty "selector" string');
                }
                if (typeof p.text !== 'string') {
                    throw new Error('browser.type requires a "text" string');
                }
                break;
            }
            case 'browser.create-tab': {
                const p = payload;
                if (p.url !== undefined && (typeof p.url !== 'string' || p.url.trim().length === 0)) {
                    throw new Error('browser.create-tab, if provided, requires "url" to be a non-empty string');
                }
                if (p.insertAfterTabId !== undefined && typeof p.insertAfterTabId !== 'string') {
                    throw new Error('browser.create-tab, if provided, requires "insertAfterTabId" to be a string');
                }
                break;
            }
            // Empty/optional payloads: browser.back, browser.forward, browser.reload, browser.stop, terminal.restart, terminal.interrupt
            default:
                break;
        }
    }
    updateStatus(id, status) {
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.UPDATE_SURFACE_ACTION,
            id,
            updates: { status, updatedAt: Date.now() },
        });
    }
    updateRecord(id, updates) {
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.UPDATE_SURFACE_ACTION,
            id,
            updates,
        });
    }
    getCurrentRecord(id) {
        const state = appStateStore_1.appStateStore.getState();
        const record = state.surfaceActions.find(a => a.id === id);
        if (!record)
            throw new Error(`Action record ${id} not found`);
        return { ...record };
    }
    toRecord(action) {
        return {
            id: action.id,
            target: action.target,
            kind: action.kind,
            status: action.status,
            origin: action.origin,
            payloadSummary: (0, surfaceActionTypes_1.summarizePayload)(action.kind, action.payload),
            resultSummary: null,
            resultData: null,
            error: null,
            createdAt: action.createdAt,
            updatedAt: action.updatedAt,
            taskId: action.taskId,
        };
    }
}
exports.surfaceActionRouter = new SurfaceActionRouter();
//# sourceMappingURL=SurfaceActionRouter.js.map