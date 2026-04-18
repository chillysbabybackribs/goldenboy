import { PhysicalWindowRole, SurfaceRole, LogSourceRole } from './windowRoles';
import { TerminalSessionState, createDefaultTerminalState, TerminalCommandState, createDefaultTerminalCommandState } from './terminal';
import { BrowserState, createDefaultBrowserState } from './browser';
import { SurfaceActionRecord } from '../actions/surfaceActionTypes';
import { ArtifactRecord } from './artifacts';
import {
  HAIKU_PROVIDER_ID,
  PRIMARY_PROVIDER_ID,
  ProviderId,
  ProviderRuntime,
  ModelOwner,
  createDefaultProviderRuntime,
} from './model';

export type WindowBounds = { x: number; y: number; width: number; height: number };

export type WindowState = {
  role: PhysicalWindowRole;
  bounds: WindowBounds;
  isVisible: boolean;
  isFocused: boolean;
  displayId: number;
};

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed';

export type TaskRecord = {
  id: string;
  title: string;
  status: TaskStatus;
  owner: ModelOwner;
  artifactIds: string[];
  createdAt: number;
  updatedAt: number;
};

export type LogLevel = 'info' | 'warn' | 'error';
export type LogSource = LogSourceRole;

export type LogRecord = {
  id: string;
  timestamp: number;
  level: LogLevel;
  source: LogSource;
  message: string;
  taskId?: string;
};

export type SurfaceStatus = 'idle' | 'running' | 'done' | 'error';

export type SurfaceExecutionState = {
  status: SurfaceStatus;
  lastUpdatedAt: number | null;
  detail: string;
};

// Execution split presets control the browser/terminal ratio
export type ExecutionLayoutPreset = 'balanced' | 'focus-browser' | 'focus-terminal';

export type ExecutionSplitState = {
  preset: ExecutionLayoutPreset;
  ratio: number; // browser width fraction, 0.0 - 1.0
};

export type TokenUsageCumulative = {
  inputTokens: number;
  outputTokens: number;
};

export type AppState = {
  windows: Record<PhysicalWindowRole, WindowState>;
  executionSplit: ExecutionSplitState;
  tasks: TaskRecord[];
  activeTaskId: string | null;
  artifacts: ArtifactRecord[];
  activeArtifactId: string | null;
  logs: LogRecord[];
  browser: SurfaceExecutionState;
  terminal: SurfaceExecutionState;
  terminalSession: TerminalSessionState;
  terminalCommand: TerminalCommandState;
  browserRuntime: BrowserState;
  surfaceActions: SurfaceActionRecord[];
  providers: Record<ProviderId, ProviderRuntime>;
  tokenUsage: TokenUsageCumulative;
};

export function createDefaultWindowState(role: PhysicalWindowRole): WindowState {
  return {
    role,
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    isVisible: false,
    isFocused: false,
    displayId: 0,
  };
}

export function createDefaultAppState(): AppState {
  return {
    windows: {
      command: createDefaultWindowState('command'),
      execution: createDefaultWindowState('execution'),
      document: createDefaultWindowState('document'),
    },
    executionSplit: { preset: 'balanced', ratio: 0.5 },
    tasks: [],
    activeTaskId: null,
    artifacts: [],
    activeArtifactId: null,
    logs: [],
    browser: { status: 'idle', lastUpdatedAt: null, detail: '' },
    terminal: { status: 'idle', lastUpdatedAt: null, detail: '' },
    terminalSession: createDefaultTerminalState(),
    terminalCommand: createDefaultTerminalCommandState(),
    browserRuntime: createDefaultBrowserState(),
    surfaceActions: [],
    providers: {
      [PRIMARY_PROVIDER_ID]: createDefaultProviderRuntime(PRIMARY_PROVIDER_ID),
      [HAIKU_PROVIDER_ID]: createDefaultProviderRuntime(HAIKU_PROVIDER_ID),
    },
    tokenUsage: { inputTokens: 0, outputTokens: 0 },
  };
}

// Map preset to default ratio
export function presetToRatio(preset: ExecutionLayoutPreset): number {
  switch (preset) {
    case 'balanced': return 0.5;
    case 'focus-browser': return 0.7;
    case 'focus-terminal': return 0.3;
  }
}
