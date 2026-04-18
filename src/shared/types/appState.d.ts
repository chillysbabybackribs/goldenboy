import { PhysicalWindowRole, LogSourceRole } from './windowRoles';
import { TerminalSessionState, TerminalCommandState } from './terminal';
import { BrowserState } from './browser';
import { SurfaceActionRecord } from '../actions/surfaceActionTypes';
import { ArtifactRecord } from './artifacts';
import { ProviderId, ProviderRuntime, ModelOwner } from './model';
export type WindowBounds = {
    x: number;
    y: number;
    width: number;
    height: number;
};
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
export type ExecutionLayoutPreset = 'balanced' | 'focus-browser' | 'focus-terminal';
export type ExecutionSplitState = {
    preset: ExecutionLayoutPreset;
    ratio: number;
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
export declare function createDefaultWindowState(role: PhysicalWindowRole): WindowState;
export declare function createDefaultAppState(): AppState;
export declare function presetToRatio(preset: ExecutionLayoutPreset): number;
