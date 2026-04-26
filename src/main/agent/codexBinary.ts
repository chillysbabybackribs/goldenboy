import { spawnSync } from 'child_process';

function firstNonEmptyLine(value: string): string | null {
  for (const line of value.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

export type CodexAvailabilityProbe = { available: true } | { available: false; error: string };

/**
 * Probe the Codex CLI for availability. The app-server runtime shells out to
 * the `codex` binary on startup; if it is not installed the Codex runtime is
 * marked unavailable and surfaced to the renderer.
 */
export function probeCodexAvailability(): CodexAvailabilityProbe {
  try {
    const probe = spawnSync('codex', ['--version'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    if (probe.error) {
      return { available: false, error: probe.error.message };
    }
    if (probe.status !== 0) {
      const stderr = firstNonEmptyLine(typeof probe.stderr === 'string' ? probe.stderr : '');
      return { available: false, error: stderr || `codex --version exited with status ${probe.status}` };
    }
    return { available: true };
  } catch (err) {
    return { available: false, error: err instanceof Error ? err.message : String(err) };
  }
}
