// ═══════════════════════════════════════════════════════════════════════════
// tmux Manager — Detection, session lifecycle, scrollback capture
// ═══════════════════════════════════════════════════════════════════════════
//
// Pure functions wrapping tmux commands. Uses execFileSync for synchronous
// checks and execFile for async operations. All commands use argument
// arrays — no string interpolation — for safety.

import { execFileSync, execFile } from 'child_process';

const TMUX_SESSION_NAME = 'v2workspace';

let tmuxPath: string | null = null;
let detectionDone = false;

export function detectTmux(): boolean {
  if (detectionDone) return tmuxPath !== null;
  detectionDone = true;
  try {
    const result = execFileSync('which', ['tmux'], { encoding: 'utf-8', timeout: 3000 }).trim();
    if (result) {
      tmuxPath = result;
      return true;
    }
  } catch {
    // not found
  }
  tmuxPath = null;
  return false;
}

export function isTmuxAvailable(): boolean {
  return tmuxPath !== null;
}

export function getTmuxPath(): string {
  if (!tmuxPath) throw new Error('tmux not available');
  return tmuxPath;
}

export function getSessionName(): string {
  return TMUX_SESSION_NAME;
}

export function hasSession(): boolean {
  if (!tmuxPath) return false;
  try {
    execFileSync(tmuxPath, ['has-session', '-t', TMUX_SESSION_NAME], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

export function createSession(cols: number, rows: number, shell: string, cwd: string): void {
  if (!tmuxPath) throw new Error('tmux not available');
  execFileSync(tmuxPath, [
    'new-session', '-d',
    '-s', TMUX_SESSION_NAME,
    '-x', String(Math.max(1, cols)),
    '-y', String(Math.max(1, rows)),
    shell,
  ], { cwd, timeout: 5000 });

  try {
    execFileSync(tmuxPath, ['set-option', '-t', TMUX_SESSION_NAME, 'history-limit', '50000'], { timeout: 3000 });
  } catch {
    // non-fatal
  }
}

export function killSession(): void {
  if (!tmuxPath) return;
  try {
    execFileSync(tmuxPath, ['kill-session', '-t', TMUX_SESSION_NAME], { timeout: 3000 });
  } catch {
    // session may not exist
  }
}

export function captureScrollback(): string {
  if (!tmuxPath) return '';
  try {
    return execFileSync(tmuxPath, [
      'capture-pane', '-t', TMUX_SESSION_NAME,
      '-p',   // print to stdout
      '-e',   // include escape sequences (colors)
      '-S', '-', // from start of scrollback
    ], { encoding: 'utf-8', timeout: 5000, maxBuffer: 10 * 1024 * 1024 });
  } catch {
    return '';
  }
}


export function resizeSession(cols: number, rows: number): void {
  if (!tmuxPath) return;
  try {
    execFileSync(tmuxPath, [
      'resize-window', '-t', TMUX_SESSION_NAME,
      '-x', String(Math.max(1, cols)),
      '-y', String(Math.max(1, rows)),
    ], { timeout: 3000 });
  } catch {
    // resize can fail if session is gone
  }
}

export function getCurrentCwd(): string | null {
  if (!tmuxPath) return null;
  try {
    const result = execFileSync(tmuxPath, [
      'display-message', '-t', TMUX_SESSION_NAME,
      '-p', '#{pane_current_path}',
    ], { encoding: 'utf-8', timeout: 3000 }).trim();
    return result || null;
  } catch {
    return null;
  }
}

/**
 * Returns the command + args to spawn in node-pty to attach to the tmux session.
 * The PTY process is `tmux attach-session`, which pipes I/O to the real shell
 * running inside tmux.
 */
export function getAttachCommand(): { command: string; args: string[] } {
  if (!tmuxPath) throw new Error('tmux not available');
  return {
    command: tmuxPath,
    args: ['attach-session', '-t', TMUX_SESSION_NAME],
  };
}
