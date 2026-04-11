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
  persistent: boolean;
  tmuxSession: string | null;
  restored: boolean;
};

export function createDefaultTerminalState(): TerminalSessionState {
  return {
    session: null,
  };
}

export type TerminalSessionState = {
  session: TerminalSessionInfo | null;
};

// Reflects orchestration dispatch state only.
// This does NOT track actual shell execution — the PTY does not provide
// per-command start/completion or exit codes. Field names reflect this.
export type TerminalCommandState = {
  dispatched: boolean;          // true while the action router is processing a terminal.execute
  lastDispatchedCommand: string | null;  // the command string last sent to the PTY
  lastUpdatedAt: number;
};

export function createDefaultTerminalCommandState(): TerminalCommandState {
  return {
    dispatched: false,
    lastDispatchedCommand: null,
    lastUpdatedAt: 0,
  };
}

// ─── Shell Integration State ─────────────────────────────────────────────

export type CommandPhase = 'idle' | 'executing';

export type CommandState = {
  phase: CommandPhase;
  startedAt: number | null;
  lastExitCode: number | null;
  cwd: string;
  outputSinceCommandStart: string;
};

export function createDefaultCommandState(cwd: string = ''): CommandState {
  return {
    phase: 'idle',
    startedAt: null,
    lastExitCode: null,
    cwd,
    outputSinceCommandStart: '',
  };
}

export type CommandFinishResult = {
  exitCode: number;
  output: string;
  cwd: string;
  durationMs: number;
  command: string;
};
