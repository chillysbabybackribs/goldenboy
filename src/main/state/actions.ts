import { PhysicalWindowRole } from '../../shared/types/windowRoles';
import { TaskRecord, LogRecord, ExecutionLayoutPreset, SurfaceExecutionState, WindowBounds, AppState, TaskStatus, ExecutionSplitState } from '../../shared/types/appState';
import { TerminalSessionInfo, TerminalCommandState } from '../../shared/types/terminal';
import { BrowserState } from '../../shared/types/browser';
import { SurfaceActionRecord } from '../../shared/actions/surfaceActionTypes';
import { ProviderId, ProviderRuntime } from '../../shared/types/model';

export enum ActionType {
  SET_WINDOW_BOUNDS = 'SET_WINDOW_BOUNDS',
  SET_WINDOW_FOCUSED = 'SET_WINDOW_FOCUSED',
  SET_WINDOW_VISIBLE = 'SET_WINDOW_VISIBLE',
  SET_EXECUTION_SPLIT = 'SET_EXECUTION_SPLIT',
  ADD_TASK = 'ADD_TASK',
  UPDATE_TASK = 'UPDATE_TASK',
  SET_ACTIVE_TASK = 'SET_ACTIVE_TASK',
  ADD_LOG = 'ADD_LOG',
  SET_SURFACE_STATUS = 'SET_SURFACE_STATUS',
  SET_TERMINAL_SESSION = 'SET_TERMINAL_SESSION',
  SET_TERMINAL_COMMAND = 'SET_TERMINAL_COMMAND',
  SET_BROWSER_RUNTIME = 'SET_BROWSER_RUNTIME',
  ADD_SURFACE_ACTION = 'ADD_SURFACE_ACTION',
  UPDATE_SURFACE_ACTION = 'UPDATE_SURFACE_ACTION',
  SET_PROVIDER_RUNTIME = 'SET_PROVIDER_RUNTIME',
  REPLACE_STATE = 'REPLACE_STATE',
}

export type Action =
  | { type: ActionType.SET_WINDOW_BOUNDS; role: PhysicalWindowRole; bounds: WindowBounds; displayId: number }
  | { type: ActionType.SET_WINDOW_FOCUSED; role: PhysicalWindowRole; isFocused: boolean }
  | { type: ActionType.SET_WINDOW_VISIBLE; role: PhysicalWindowRole; isVisible: boolean }
  | { type: ActionType.SET_EXECUTION_SPLIT; split: ExecutionSplitState }
  | { type: ActionType.ADD_TASK; task: TaskRecord }
  | { type: ActionType.UPDATE_TASK; taskId: string; updates: Partial<Pick<TaskRecord, 'status' | 'updatedAt'>> }
  | { type: ActionType.SET_ACTIVE_TASK; taskId: string | null }
  | { type: ActionType.ADD_LOG; log: LogRecord }
  | { type: ActionType.SET_SURFACE_STATUS; surface: 'browser' | 'terminal'; status: SurfaceExecutionState }
  | { type: ActionType.SET_TERMINAL_SESSION; session: TerminalSessionInfo | null }
  | { type: ActionType.SET_TERMINAL_COMMAND; command: TerminalCommandState }
  | { type: ActionType.SET_BROWSER_RUNTIME; browserRuntime: BrowserState }
  | { type: ActionType.ADD_SURFACE_ACTION; record: SurfaceActionRecord }
  | { type: ActionType.UPDATE_SURFACE_ACTION; id: string; updates: Partial<Pick<SurfaceActionRecord, 'status' | 'resultSummary' | 'resultData' | 'error' | 'updatedAt'>> }
  | { type: ActionType.SET_PROVIDER_RUNTIME; providerId: ProviderId; runtime: ProviderRuntime }
  | { type: ActionType.REPLACE_STATE; state: AppState };
