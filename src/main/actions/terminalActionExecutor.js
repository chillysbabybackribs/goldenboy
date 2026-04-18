"use strict";
// ═══════════════════════════════════════════════════════════════════════════
// Terminal Action Executor — Routes terminal actions to TerminalService
// Returns structured { summary, data } for both display and model consumption
// ═══════════════════════════════════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeTerminalAction = executeTerminalAction;
const TerminalService_1 = require("../terminal/TerminalService");
async function executeTerminalAction(kind, payload) {
    switch (kind) {
        case 'terminal.execute': {
            const { command } = payload;
            const session = TerminalService_1.terminalService.getSession();
            if (!session || session.status !== 'running') {
                throw new Error('Terminal session not running');
            }
            // Wait for command to finish via shell integration (or timeout)
            const result = await TerminalService_1.terminalService.executeCommand(command, 10_000);
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
            const output = TerminalService_1.terminalService.getRecentOutput(50);
            return {
                summary: `Executed: ${command} (no exit code — integration inactive or timeout)`,
                data: {
                    command,
                    sessionId: session.id,
                    output: output.slice(-4096),
                    cwd: TerminalService_1.terminalService.getCwd(),
                },
            };
        }
        case 'terminal.write': {
            const { input } = payload;
            const session = TerminalService_1.terminalService.getSession();
            if (!session || session.status !== 'running') {
                throw new Error('Terminal session not running');
            }
            TerminalService_1.terminalService.write(input);
            return {
                summary: `Input written to terminal (session ${session.id})`,
                data: { sessionId: session.id, written: true },
            };
        }
        case 'terminal.restart': {
            const newSession = TerminalService_1.terminalService.restart();
            return {
                summary: `Terminal restarted (new session ${newSession.id})`,
                data: { sessionId: newSession.id, shell: newSession.shell },
            };
        }
        case 'terminal.interrupt': {
            const session = TerminalService_1.terminalService.getSession();
            if (!session || session.status !== 'running') {
                throw new Error('Terminal session not running');
            }
            TerminalService_1.terminalService.write('\x03');
            return {
                summary: `Interrupt signal sent (session ${session.id})`,
                data: { sessionId: session.id, sent: true },
            };
        }
        default:
            throw new Error(`Unknown terminal action kind: ${kind}`);
    }
}
//# sourceMappingURL=terminalActionExecutor.js.map