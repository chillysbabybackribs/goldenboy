// ═══════════════════════════════════════════════════════════════════════════
// Surface Action Router — Main-process orchestration layer
// ═══════════════════════════════════════════════════════════════════════════
//
// Receives action inputs, validates, persists to state, routes to the
// correct runtime service, captures results, and emits lifecycle events.

import {
  SurfaceAction, SurfaceActionInput, SurfaceActionRecord,
  SurfaceActionKind, SurfaceActionStatus,
  SurfaceActionPayloadMap,
  targetForKind, summarizePayload,
  BrowserNavigatePayload, BrowserCloseTabPayload,
  BrowserActivateTabPayload, BrowserClickPayload, BrowserTypePayload,
  TerminalExecutePayload, TerminalWritePayload,
} from '../../shared/actions/surfaceActionTypes';
import { appStateStore } from '../state/appStateStore';
import { ActionType } from '../state/actions';
import { eventBus } from '../events/eventBus';
import { AppEventType } from '../../shared/types/events';
import { generateId } from '../../shared/utils/ids';
import { executeBrowserAction } from './browserActionExecutor';
import { executeTerminalAction } from './terminalActionExecutor';
import { SurfaceExecutionController } from './SurfaceExecutionController';
import { ACTION_CONCURRENCY_POLICY } from './surfaceActionPolicy';

const MAX_ACTIONS = 200;

class SurfaceActionRouter {
  private browserController: SurfaceExecutionController;
  private terminalController: SurfaceExecutionController;

  constructor() {
    const executeCb = (action: SurfaceAction) => this.executeAction(action);
    const failCb = (action: SurfaceAction, reason: string) => this.failActionByPolicy(action, reason);
    this.browserController = new SurfaceExecutionController('browser', executeCb, failCb);
    this.terminalController = new SurfaceExecutionController('terminal', executeCb, failCb);
  }

  async submit<K extends SurfaceActionKind>(input: SurfaceActionInput<K>): Promise<SurfaceActionRecord> {
    // Validate target matches kind
    const expectedTarget = targetForKind(input.kind);
    if (input.target !== expectedTarget) {
      throw new Error(`Action kind "${input.kind}" requires target "${expectedTarget}", got "${input.target}"`);
    }

    // Validate payload
    this.validatePayload(input.kind, input.payload);

    // Create the action
    const now = Date.now();
    const action: SurfaceAction<K> = {
      id: generateId('sa'),
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
    appStateStore.dispatch({ type: ActionType.ADD_SURFACE_ACTION, record });

    // Emit submitted event
    eventBus.emit(AppEventType.SURFACE_ACTION_SUBMITTED, { record: { ...record } });

    // Log the action
    appStateStore.dispatch({
      type: ActionType.ADD_LOG,
      log: {
        id: generateId('log'),
        timestamp: now,
        level: 'info',
        source: action.target,
        message: `Action submitted: ${record.payloadSummary}`,
        taskId: action.taskId ?? undefined,
      },
    });

    // Delegate to per-surface controller
    const controller = action.target === 'browser' ? this.browserController : this.terminalController;
    const policy = ACTION_CONCURRENCY_POLICY[action.kind];

    try {
      controller.submit(action as SurfaceAction, policy);
    } catch (err: unknown) {
      // Policy rejection (e.g., terminal.write with no active action).
      // Record is already in state as 'queued' — transition to failed.
      const reason = err instanceof Error ? err.message : String(err);
      this.failActionByPolicy(action as SurfaceAction, reason);
    }

    return { ...record };
  }

  cancelQueuedAction(id: string): SurfaceActionRecord {
    const state = appStateStore.getState();
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

  getQueueDiagnostics(): { browser: { active: string | null; queueLength: number }; terminal: { active: string | null; queueLength: number } } {
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

  getRecentActions(limit: number = 50): SurfaceActionRecord[] {
    const state = appStateStore.getState();
    return state.surfaceActions.slice(-limit);
  }

  getActionsByTarget(target: 'browser' | 'terminal', limit: number = 50): SurfaceActionRecord[] {
    const state = appStateStore.getState();
    return state.surfaceActions.filter(a => a.target === target).slice(-limit);
  }

  getActionsByTask(taskId: string): SurfaceActionRecord[] {
    const state = appStateStore.getState();
    return state.surfaceActions.filter(a => a.taskId === taskId);
  }

  private async executeAction(action: SurfaceAction): Promise<void> {
    const id = action.id;
    const isTerminalExecute = action.kind === 'terminal.execute';

    // Transition to running
    this.updateStatus(id, 'running');
    eventBus.emit(AppEventType.SURFACE_ACTION_STARTED, { record: this.getCurrentRecord(id) });

    // Track terminal command state for terminal.execute actions
    if (isTerminalExecute) {
      const payload = action.payload as { command: string };
      appStateStore.dispatch({
        type: ActionType.SET_TERMINAL_COMMAND,
        command: {
          dispatched: true,
          lastDispatchedCommand: payload.command,
          lastUpdatedAt: Date.now(),
        },
      });
    }

    try {
      let result: { summary: string; data: Record<string, unknown> };

      if (action.target === 'browser') {
        result = await executeBrowserAction(action.kind, action.payload);
      } else {
        result = await executeTerminalAction(action.kind, action.payload);
      }

      // Transition to completed
      this.updateRecord(id, { status: 'completed', resultSummary: result.summary, resultData: result.data, updatedAt: Date.now() });
      eventBus.emit(AppEventType.SURFACE_ACTION_COMPLETED, { record: this.getCurrentRecord(id) });

      // Update terminal command state on completion
      if (isTerminalExecute) {
        appStateStore.dispatch({
          type: ActionType.SET_TERMINAL_COMMAND,
          command: {
            dispatched: false,
            lastDispatchedCommand: (action.payload as { command: string }).command,
            lastUpdatedAt: Date.now(),
          },
        });
      }

      appStateStore.dispatch({
        type: ActionType.ADD_LOG,
        log: {
          id: generateId('log'),
          timestamp: Date.now(),
          level: 'info',
          source: action.target,
          message: `Action completed: ${result.summary}`,
          taskId: action.taskId ?? undefined,
        },
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      // Transition to failed
      this.updateRecord(id, { status: 'failed', error: errorMsg, updatedAt: Date.now() });
      eventBus.emit(AppEventType.SURFACE_ACTION_FAILED, { record: this.getCurrentRecord(id) });

      // Update terminal command dispatch state on failure
      if (isTerminalExecute) {
        appStateStore.dispatch({
          type: ActionType.SET_TERMINAL_COMMAND,
          command: {
            dispatched: false,
            lastDispatchedCommand: (action.payload as { command: string }).command,
            lastUpdatedAt: Date.now(),
          },
        });
      }

      appStateStore.dispatch({
        type: ActionType.ADD_LOG,
        log: {
          id: generateId('log'),
          timestamp: Date.now(),
          level: 'error',
          source: action.target,
          message: `Action failed: ${errorMsg}`,
          taskId: action.taskId ?? undefined,
        },
      });
    }
  }

  private failActionByPolicy(action: SurfaceAction, reason: string): void {
    this.updateRecord(action.id, { status: 'failed', error: reason, updatedAt: Date.now() });
    eventBus.emit(AppEventType.SURFACE_ACTION_FAILED, { record: this.getCurrentRecord(action.id) });
    appStateStore.dispatch({
      type: ActionType.ADD_LOG,
      log: {
        id: generateId('log'),
        timestamp: Date.now(),
        level: 'warn',
        source: action.target,
        message: `Action cancelled: ${reason}`,
        taskId: action.taskId ?? undefined,
      },
    });
  }

  private validatePayload(kind: SurfaceActionKind, payload: Record<string, unknown>): void {
    switch (kind) {
      case 'browser.navigate': {
        const p = payload as BrowserNavigatePayload;
        if (!p.url || typeof p.url !== 'string' || p.url.trim().length === 0) {
          throw new Error('browser.navigate requires a non-empty "url" string');
        }
        break;
      }
      case 'terminal.execute': {
        const p = payload as TerminalExecutePayload;
        if (!p.command || typeof p.command !== 'string' || p.command.trim().length === 0) {
          throw new Error('terminal.execute requires a non-empty "command" string');
        }
        break;
      }
      case 'terminal.write': {
        const p = payload as TerminalWritePayload;
        if (typeof p.input !== 'string') {
          throw new Error('terminal.write requires an "input" string');
        }
        break;
      }
      case 'browser.close-tab': {
        const p = payload as BrowserCloseTabPayload;
        if (!p.tabId || typeof p.tabId !== 'string') {
          throw new Error('browser.close-tab requires a non-empty "tabId" string');
        }
        break;
      }
      case 'browser.activate-tab': {
        const p = payload as BrowserActivateTabPayload;
        if (!p.tabId || typeof p.tabId !== 'string') {
          throw new Error('browser.activate-tab requires a non-empty "tabId" string');
        }
        break;
      }
      case 'browser.click': {
        const p = payload as BrowserClickPayload;
        if (!p.selector || typeof p.selector !== 'string' || p.selector.trim().length === 0) {
          throw new Error('browser.click requires a non-empty "selector" string');
        }
        break;
      }
      case 'browser.type': {
        const p = payload as BrowserTypePayload;
        if (!p.selector || typeof p.selector !== 'string' || p.selector.trim().length === 0) {
          throw new Error('browser.type requires a non-empty "selector" string');
        }
        if (typeof p.text !== 'string') {
          throw new Error('browser.type requires a "text" string');
        }
        break;
      }
      // Empty/optional payloads: browser.back, browser.forward, browser.reload, browser.stop, browser.create-tab, terminal.restart, terminal.interrupt
      default:
        break;
    }
  }

  private updateStatus(id: string, status: SurfaceActionStatus): void {
    appStateStore.dispatch({
      type: ActionType.UPDATE_SURFACE_ACTION,
      id,
      updates: { status, updatedAt: Date.now() },
    });
  }

  private updateRecord(id: string, updates: Partial<Pick<SurfaceActionRecord, 'status' | 'resultSummary' | 'resultData' | 'error' | 'updatedAt'>>): void {
    appStateStore.dispatch({
      type: ActionType.UPDATE_SURFACE_ACTION,
      id,
      updates,
    });
  }

  private getCurrentRecord(id: string): SurfaceActionRecord {
    const state = appStateStore.getState();
    const record = state.surfaceActions.find(a => a.id === id);
    if (!record) throw new Error(`Action record ${id} not found`);
    return { ...record };
  }

  private toRecord(action: SurfaceAction): SurfaceActionRecord {
    return {
      id: action.id,
      target: action.target,
      kind: action.kind,
      status: action.status,
      origin: action.origin,
      payloadSummary: summarizePayload(action.kind, action.payload as Record<string, unknown>),
      resultSummary: null,
      resultData: null,
      error: null,
      createdAt: action.createdAt,
      updatedAt: action.updatedAt,
      taskId: action.taskId,
    };
  }
}

export const surfaceActionRouter = new SurfaceActionRouter();
