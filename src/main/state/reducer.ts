import { AppState } from '../../shared/types/appState';
import { Action, ActionType } from './actions';

export function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case ActionType.SET_WINDOW_BOUNDS:
      return {
        ...state,
        windows: {
          ...state.windows,
          [action.role]: {
            ...state.windows[action.role],
            bounds: action.bounds,
            displayId: action.displayId,
          },
        },
      };

    case ActionType.SET_WINDOW_FOCUSED: {
      const updated = { ...state.windows };
      for (const role of Object.keys(updated) as Array<keyof typeof updated>) {
        updated[role] = { ...updated[role], isFocused: role === action.role && action.isFocused };
      }
      return { ...state, windows: updated };
    }

    case ActionType.SET_WINDOW_VISIBLE:
      return {
        ...state,
        windows: {
          ...state.windows,
          [action.role]: { ...state.windows[action.role], isVisible: action.isVisible },
        },
      };

    case ActionType.SET_EXECUTION_SPLIT:
      return { ...state, executionSplit: action.split };

    case ActionType.ADD_TASK:
      return {
        ...state,
        tasks: [...state.tasks, action.task],
        activeTaskId: action.task.id,
      };

    case ActionType.UPDATE_TASK:
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.taskId ? { ...t, ...action.updates } : t
        ),
      };

    case ActionType.SET_ACTIVE_TASK:
      return { ...state, activeTaskId: action.taskId };

    case ActionType.ADD_LOG: {
      const logs = [...state.logs, action.log];
      return { ...state, logs: logs.length > 500 ? logs.slice(-500) : logs };
    }

    case ActionType.SET_SURFACE_STATUS:
      return { ...state, [action.surface]: action.status };

    case ActionType.SET_TERMINAL_SESSION:
      return {
        ...state,
        terminalSession: { session: action.session },
      };

    case ActionType.SET_TERMINAL_COMMAND:
      return {
        ...state,
        terminalCommand: action.command,
      };

    case ActionType.SET_BROWSER_RUNTIME:
      return {
        ...state,
        browserRuntime: action.browserRuntime,
      };

    case ActionType.ADD_SURFACE_ACTION: {
      const actions = [...state.surfaceActions, action.record];
      // Keep bounded to 200 most recent
      return { ...state, surfaceActions: actions.length > 200 ? actions.slice(-200) : actions };
    }

    case ActionType.UPDATE_SURFACE_ACTION:
      return {
        ...state,
        surfaceActions: state.surfaceActions.map((a) =>
          a.id === action.id ? { ...a, ...action.updates } : a
        ),
      };

    case ActionType.SET_PROVIDER_RUNTIME:
      return {
        ...state,
        providers: {
          ...state.providers,
          [action.providerId]: action.runtime,
        },
      };

    case ActionType.REPLACE_STATE:
      return action.state;

    default:
      return state;
  }
}
