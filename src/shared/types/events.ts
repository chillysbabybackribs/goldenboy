import { PhysicalWindowRole, SurfaceRole } from './windowRoles';
import { TaskRecord, LogRecord, ExecutionLayoutPreset, AppState, WindowBounds } from './appState';
import { TerminalSessionInfo, TerminalSessionStatus } from './terminal';
import {
  BrowserState, BrowserNavigationState, BrowserDownloadState,
  BrowserPermissionRequest, BrowserHistoryEntry, BrowserSurfaceStatus,
  BrowserErrorInfo, TabInfo, BookmarkEntry, ExtensionInfo, FindInPageState,
  BrowserSettings,
} from './browser';
import { SurfaceActionRecord } from '../actions/surfaceActionTypes';
import { ProviderId, ProviderRuntime, InvocationProgress, InvocationResult, HandoffPacket } from './model';

export enum AppEventType {
  TASK_CREATED = 'TASK_CREATED',
  TASK_UPDATED = 'TASK_UPDATED',
  TASK_COMPLETED = 'TASK_COMPLETED',
  LOG_ADDED = 'LOG_ADDED',

  WINDOW_BOUNDS_CHANGED = 'WINDOW_BOUNDS_CHANGED',
  WINDOW_FOCUSED = 'WINDOW_FOCUSED',

  // Execution split events (replaces old layout presets)
  EXECUTION_SPLIT_CHANGED = 'EXECUTION_SPLIT_CHANGED',
  EXECUTION_LAYOUT_APPLIED = 'EXECUTION_LAYOUT_APPLIED',

  // Surface action lifecycle events
  SURFACE_ACTION_SUBMITTED = 'SURFACE_ACTION_SUBMITTED',
  SURFACE_ACTION_STARTED = 'SURFACE_ACTION_STARTED',
  SURFACE_ACTION_COMPLETED = 'SURFACE_ACTION_COMPLETED',
  SURFACE_ACTION_FAILED = 'SURFACE_ACTION_FAILED',
  SURFACE_ACTION_RESULT_UPDATED = 'SURFACE_ACTION_RESULT_UPDATED',

  APP_STATE_SYNCED = 'APP_STATE_SYNCED',

  // Browser runtime lifecycle events
  BROWSER_SURFACE_CREATED = 'BROWSER_SURFACE_CREATED',
  BROWSER_NAVIGATION_STARTED = 'BROWSER_NAVIGATION_STARTED',
  BROWSER_NAVIGATION_UPDATED = 'BROWSER_NAVIGATION_UPDATED',
  BROWSER_NAVIGATION_COMPLETED = 'BROWSER_NAVIGATION_COMPLETED',
  BROWSER_NAVIGATION_FAILED = 'BROWSER_NAVIGATION_FAILED',
  BROWSER_TITLE_UPDATED = 'BROWSER_TITLE_UPDATED',
  BROWSER_HISTORY_UPDATED = 'BROWSER_HISTORY_UPDATED',
  BROWSER_DOWNLOAD_STARTED = 'BROWSER_DOWNLOAD_STARTED',
  BROWSER_DOWNLOAD_UPDATED = 'BROWSER_DOWNLOAD_UPDATED',
  BROWSER_DOWNLOAD_COMPLETED = 'BROWSER_DOWNLOAD_COMPLETED',
  BROWSER_PERMISSION_REQUESTED = 'BROWSER_PERMISSION_REQUESTED',
  BROWSER_PERMISSION_RESOLVED = 'BROWSER_PERMISSION_RESOLVED',
  BROWSER_STATUS_UPDATED = 'BROWSER_STATUS_UPDATED',
  BROWSER_STATE_CHANGED = 'BROWSER_STATE_CHANGED',

  // Tab lifecycle events
  BROWSER_TAB_CREATED = 'BROWSER_TAB_CREATED',
  BROWSER_TAB_CLOSED = 'BROWSER_TAB_CLOSED',
  BROWSER_TAB_ACTIVATED = 'BROWSER_TAB_ACTIVATED',
  BROWSER_TAB_UPDATED = 'BROWSER_TAB_UPDATED',

  // Bookmark events
  BROWSER_BOOKMARK_ADDED = 'BROWSER_BOOKMARK_ADDED',
  BROWSER_BOOKMARK_REMOVED = 'BROWSER_BOOKMARK_REMOVED',

  // Extension events
  BROWSER_EXTENSION_LOADED = 'BROWSER_EXTENSION_LOADED',
  BROWSER_EXTENSION_REMOVED = 'BROWSER_EXTENSION_REMOVED',

  // Model lifecycle events
  MODEL_PROVIDER_DETECTED = 'MODEL_PROVIDER_DETECTED',
  MODEL_PROVIDER_STATUS_CHANGED = 'MODEL_PROVIDER_STATUS_CHANGED',
  MODEL_INVOCATION_STARTED = 'MODEL_INVOCATION_STARTED',
  MODEL_INVOCATION_PROGRESS = 'MODEL_INVOCATION_PROGRESS',
  MODEL_INVOCATION_COMPLETED = 'MODEL_INVOCATION_COMPLETED',
  MODEL_INVOCATION_FAILED = 'MODEL_INVOCATION_FAILED',
  MODEL_HANDOFF = 'MODEL_HANDOFF',

  // Terminal session lifecycle events
  TERMINAL_SESSION_CREATED = 'TERMINAL_SESSION_CREATED',
  TERMINAL_SESSION_STARTED = 'TERMINAL_SESSION_STARTED',
  TERMINAL_SESSION_OUTPUT = 'TERMINAL_SESSION_OUTPUT',
  TERMINAL_SESSION_RESIZED = 'TERMINAL_SESSION_RESIZED',
  TERMINAL_SESSION_EXITED = 'TERMINAL_SESSION_EXITED',
  TERMINAL_SESSION_ERROR = 'TERMINAL_SESSION_ERROR',
  TERMINAL_SESSION_RESTARTED = 'TERMINAL_SESSION_RESTARTED',
  TERMINAL_STATUS_UPDATED = 'TERMINAL_STATUS_UPDATED',
  TERMINAL_SESSION_REATTACHED = 'TERMINAL_SESSION_REATTACHED',
  TERMINAL_COMMAND_FINISHED = 'TERMINAL_COMMAND_FINISHED',
}

export type AppEventPayloads = {
  [AppEventType.TASK_CREATED]: { task: TaskRecord };
  [AppEventType.TASK_UPDATED]: { task: TaskRecord };
  [AppEventType.TASK_COMPLETED]: { taskId: string };
  [AppEventType.LOG_ADDED]: { log: LogRecord };

  [AppEventType.WINDOW_BOUNDS_CHANGED]: { role: PhysicalWindowRole; bounds: WindowBounds; displayId: number };
  [AppEventType.WINDOW_FOCUSED]: { role: PhysicalWindowRole };

  [AppEventType.EXECUTION_SPLIT_CHANGED]: { ratio: number };
  [AppEventType.EXECUTION_LAYOUT_APPLIED]: { preset: ExecutionLayoutPreset };

  // Surface action lifecycle payloads
  [AppEventType.SURFACE_ACTION_SUBMITTED]: { record: SurfaceActionRecord };
  [AppEventType.SURFACE_ACTION_STARTED]: { record: SurfaceActionRecord };
  [AppEventType.SURFACE_ACTION_COMPLETED]: { record: SurfaceActionRecord };
  [AppEventType.SURFACE_ACTION_FAILED]: { record: SurfaceActionRecord };
  [AppEventType.SURFACE_ACTION_RESULT_UPDATED]: { record: SurfaceActionRecord };

  [AppEventType.APP_STATE_SYNCED]: { state: AppState };

  // Model lifecycle payloads
  [AppEventType.MODEL_PROVIDER_DETECTED]: { providerId: ProviderId; available: boolean; detail: string };
  [AppEventType.MODEL_PROVIDER_STATUS_CHANGED]: { runtime: ProviderRuntime };
  [AppEventType.MODEL_INVOCATION_STARTED]: { taskId: string; providerId: ProviderId };
  [AppEventType.MODEL_INVOCATION_PROGRESS]: { progress: InvocationProgress };
  [AppEventType.MODEL_INVOCATION_COMPLETED]: { result: InvocationResult };
  [AppEventType.MODEL_INVOCATION_FAILED]: { taskId: string; providerId: ProviderId; error: string };
  [AppEventType.MODEL_HANDOFF]: { packet: HandoffPacket };

  // Browser runtime lifecycle payloads
  [AppEventType.BROWSER_SURFACE_CREATED]: { profileId: string; partition: string };
  [AppEventType.BROWSER_NAVIGATION_STARTED]: { url: string };
  [AppEventType.BROWSER_NAVIGATION_UPDATED]: { navigation: BrowserNavigationState };
  [AppEventType.BROWSER_NAVIGATION_COMPLETED]: { url: string; title: string };
  [AppEventType.BROWSER_NAVIGATION_FAILED]: { url: string; errorCode: number; errorDescription: string };
  [AppEventType.BROWSER_TITLE_UPDATED]: { title: string; url: string };
  [AppEventType.BROWSER_HISTORY_UPDATED]: { entries: BrowserHistoryEntry[] };
  [AppEventType.BROWSER_DOWNLOAD_STARTED]: { download: BrowserDownloadState };
  [AppEventType.BROWSER_DOWNLOAD_UPDATED]: { download: BrowserDownloadState };
  [AppEventType.BROWSER_DOWNLOAD_COMPLETED]: { download: BrowserDownloadState };
  [AppEventType.BROWSER_PERMISSION_REQUESTED]: { request: BrowserPermissionRequest };
  [AppEventType.BROWSER_PERMISSION_RESOLVED]: { request: BrowserPermissionRequest };
  [AppEventType.BROWSER_STATUS_UPDATED]: { status: BrowserSurfaceStatus; detail?: string };
  [AppEventType.BROWSER_STATE_CHANGED]: { state: BrowserState };

  // Tab lifecycle payloads
  [AppEventType.BROWSER_TAB_CREATED]: { tab: TabInfo };
  [AppEventType.BROWSER_TAB_CLOSED]: { tabId: string };
  [AppEventType.BROWSER_TAB_ACTIVATED]: { tabId: string };
  [AppEventType.BROWSER_TAB_UPDATED]: { tab: TabInfo };

  // Bookmark payloads
  [AppEventType.BROWSER_BOOKMARK_ADDED]: { bookmark: BookmarkEntry };
  [AppEventType.BROWSER_BOOKMARK_REMOVED]: { bookmarkId: string };

  // Extension payloads
  [AppEventType.BROWSER_EXTENSION_LOADED]: { extension: ExtensionInfo };
  [AppEventType.BROWSER_EXTENSION_REMOVED]: { extensionId: string };

  // Terminal session lifecycle payloads
  [AppEventType.TERMINAL_SESSION_CREATED]: { session: TerminalSessionInfo };
  [AppEventType.TERMINAL_SESSION_STARTED]: { session: TerminalSessionInfo };
  [AppEventType.TERMINAL_SESSION_OUTPUT]: { sessionId: string; data: string };
  [AppEventType.TERMINAL_SESSION_RESIZED]: { sessionId: string; cols: number; rows: number };
  [AppEventType.TERMINAL_SESSION_EXITED]: { sessionId: string; exitCode: number };
  [AppEventType.TERMINAL_SESSION_ERROR]: { sessionId: string; error: string };
  [AppEventType.TERMINAL_SESSION_RESTARTED]: { oldSessionId: string; session: TerminalSessionInfo };
  [AppEventType.TERMINAL_STATUS_UPDATED]: { sessionId: string; status: TerminalSessionStatus };
  [AppEventType.TERMINAL_SESSION_REATTACHED]: { session: TerminalSessionInfo; scrollbackLength: number };
  [AppEventType.TERMINAL_COMMAND_FINISHED]: {
    sessionId: string;
    exitCode: number;
    output: string;
    cwd: string;
    durationMs: number;
    command: string;
  };
};

export type AppEvent<T extends AppEventType = AppEventType> = {
  type: T;
  payload: AppEventPayloads[T];
  timestamp: number;
};
