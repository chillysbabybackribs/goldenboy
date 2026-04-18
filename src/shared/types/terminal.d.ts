export type TerminalSessionStatus = 'idle' | 'starting' | 'running' | 'exited' | 'error';
export type TerminalSessionInfo = {
    id: string;
    pid: number | null;
    shell: string;
    cwd: string;
    startedAt: number;
    lastActivityAt: number | null;
    status: TerminalSessionStatus;
    exitCode: number | null;
    cols: number;
    rows: number;
    restored: boolean;
};
export declare function createDefaultTerminalState(): TerminalSessionState;
export type TerminalSessionState = {
    session: TerminalSessionInfo | null;
};
export type TerminalCommandState = {
    dispatched: boolean;
    lastDispatchedCommand: string | null;
    lastUpdatedAt: number;
};
export declare function createDefaultTerminalCommandState(): TerminalCommandState;
export type CommandPhase = 'idle' | 'executing';
export type CommandState = {
    phase: CommandPhase;
    startedAt: number | null;
    lastExitCode: number | null;
    cwd: string;
    outputSinceCommandStart: string;
};
export declare function createDefaultCommandState(cwd?: string): CommandState;
export type CommandFinishResult = {
    exitCode: number;
    output: string;
    cwd: string;
    durationMs: number;
    command: string;
};
export type TerminalExecResult = {
    exitCode: number | null;
    output: string;
    cwd: string;
    durationMs: number;
    command: string;
    timedOut: boolean;
};
