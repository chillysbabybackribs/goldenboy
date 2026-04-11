// ═══════════════════════════════════════════════════════════════════════════
// Terminal Action Executor — Routes terminal actions to TerminalService
// Returns structured { summary, data } for both display and model consumption
// ═══════════════════════════════════════════════════════════════════════════

import { SurfaceActionKind, TerminalExecutePayload, TerminalWritePayload } from '../../shared/actions/surfaceActionTypes';
import { terminalService } from '../terminal/TerminalService';
import type { ActionResult } from './browserActionExecutor';

export async function executeTerminalAction(
  kind: SurfaceActionKind,
  payload: Record<string, unknown>,
): Promise<ActionResult> {
  switch (kind) {
    case 'terminal.execute': {
      const { command } = payload as TerminalExecutePayload;
      const session = terminalService.getSession();
      if (!session || session.status !== 'running') {
        throw new Error('Terminal session not running');
      }
      terminalService.write(command + '\n');

      // Wait for command to finish via shell integration (or timeout)
      const result = await terminalService.waitForCommandFinish(10_000);

      if (result) {
        return {
          summary: `Executed: ${command} (exit ${result.exitCode})`,
          data: {
            command,
            sessionId: session.id,
            exitCode: result.exitCode,
            output: result.output.slice(-8192),
            cwd: result.cwd,
            durationMs: result.durationMs,
          },
        };
      }

      // Fallback: shell integration not active or command timed out
      const output = terminalService.getRecentOutput(50);
      return {
        summary: `Executed: ${command} (no exit code — integration inactive or timeout)`,
        data: {
          command,
          sessionId: session.id,
          output: output.slice(-4096),
          cwd: terminalService.getCwd(),
        },
      };
    }

    case 'terminal.write': {
      const { input } = payload as TerminalWritePayload;
      const session = terminalService.getSession();
      if (!session || session.status !== 'running') {
        throw new Error('Terminal session not running');
      }
      terminalService.write(input);
      return {
        summary: `Input written to terminal (session ${session.id})`,
        data: { sessionId: session.id, written: true },
      };
    }

    case 'terminal.restart': {
      const newSession = terminalService.restart();
      return {
        summary: `Terminal restarted (new session ${newSession.id})`,
        data: { sessionId: newSession.id, shell: newSession.shell },
      };
    }

    case 'terminal.interrupt': {
      const session = terminalService.getSession();
      if (!session || session.status !== 'running') {
        throw new Error('Terminal session not running');
      }
      terminalService.write('\x03');
      return {
        summary: `Interrupt signal sent (session ${session.id})`,
        data: { sessionId: session.id, sent: true },
      };
    }

    default:
      throw new Error(`Unknown terminal action kind: ${kind}`);
  }
}
