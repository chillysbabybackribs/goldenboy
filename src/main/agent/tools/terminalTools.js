"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTerminalToolDefinitions = createTerminalToolDefinitions;
const TerminalService_1 = require("../../terminal/TerminalService");
const AgentCache_1 = require("../AgentCache");
function objectInput(input) {
    return typeof input === 'object' && input !== null ? input : {};
}
function requireString(input, key) {
    const value = input[key];
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`Expected non-empty string input: ${key}`);
    }
    return value;
}
function optionalString(input, key) {
    const value = input[key];
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
function optionalNumber(input, key, fallback) {
    const value = input[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function ensureSession() {
    const existing = TerminalService_1.terminalService.getSession();
    if (existing?.status === 'running')
        return existing;
    return TerminalService_1.terminalService.startSession();
}
function shellQuote(value) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}
function commandWithCwd(command, cwd) {
    if (!cwd)
        return command;
    return `cd ${shellQuote(cwd)} && ${command}`;
}
function compactOutput(output, maxChars) {
    if (output.length <= maxChars)
        return output;
    return `${output.slice(-maxChars)}\n...[terminal output truncated to last ${maxChars} chars]`;
}
function invalidateFilesystemViewsFromTerminal() {
    // Shell commands may mutate files or cwd outside the host's direct view.
    // Drop cached filesystem tool results so follow-up reads re-observe state.
    AgentCache_1.agentCache.invalidateByToolPrefix('filesystem.');
}
function createTerminalToolDefinitions() {
    return [
        {
            name: 'terminal.exec',
            description: 'Execute a shell command and wait for completion. Uses an isolated non-interactive shell so shared terminal pager/editor state does not contaminate verification or automation commands.',
            inputSchema: {
                type: 'object',
                required: ['command'],
                properties: {
                    command: { type: 'string' },
                    cwd: { type: 'string' },
                    timeoutMs: { type: 'number' },
                    maxOutputChars: { type: 'number' },
                },
            },
            async execute(input) {
                const obj = objectInput(input);
                const command = requireString(obj, 'command');
                if (command.length > 4000)
                    throw new Error('Command is too long');
                const cwd = optionalString(obj, 'cwd');
                const timeoutMs = Math.min(Math.max(optionalNumber(obj, 'timeoutMs', 30_000), 1_000), 180_000);
                const maxOutputChars = Math.min(Math.max(optionalNumber(obj, 'maxOutputChars', 12_000), 1_000), 64_000);
                const result = await TerminalService_1.terminalService.executeCommandIsolated(command, { cwd, timeoutMs });
                invalidateFilesystemViewsFromTerminal();
                if (result.timedOut) {
                    return {
                        summary: `Command timed out after ${timeoutMs}ms: ${command}`,
                        data: {
                            command,
                            cwd: result.cwd,
                            timedOut: true,
                            durationMs: result.durationMs,
                            output: compactOutput(result.output, maxOutputChars),
                            filesystemCacheInvalidated: true,
                            followUp: 'If the command changed files, rerun filesystem.index_workspace before relying on indexed file cache search.',
                        },
                    };
                }
                return {
                    summary: `Executed command: ${command} (exit ${result.exitCode})`,
                    data: {
                        command,
                        exitCode: result.exitCode,
                        cwd: result.cwd,
                        durationMs: result.durationMs,
                        output: compactOutput(result.output, maxOutputChars),
                        filesystemCacheInvalidated: true,
                        followUp: 'If the command changed files, rerun filesystem.index_workspace before relying on indexed file cache search.',
                    },
                };
            },
        },
        {
            name: 'terminal.spawn',
            description: 'Start a long-running shell command in the shared terminal without waiting for completion. Use for dev servers, watchers, tunnels, and other processes that should keep running.',
            inputSchema: {
                type: 'object',
                required: ['command'],
                properties: {
                    command: { type: 'string' },
                    cwd: { type: 'string' },
                },
            },
            async execute(input) {
                const obj = objectInput(input);
                const command = requireString(obj, 'command');
                if (command.length > 4000)
                    throw new Error('Command is too long');
                if (TerminalService_1.terminalService.isBusy()) {
                    throw new Error('Terminal already has an active or pending foreground command. Wait for it to finish or use terminal.kill before spawning another.');
                }
                const session = ensureSession();
                TerminalService_1.terminalService.dispatchCommand(commandWithCwd(command, optionalString(obj, 'cwd')));
                invalidateFilesystemViewsFromTerminal();
                return {
                    summary: `Spawned long-running command: ${command}`,
                    data: {
                        command,
                        cwd: TerminalService_1.terminalService.getCwd() || session.cwd,
                        sessionId: session.id,
                        recentOutput: compactOutput(TerminalService_1.terminalService.getRecentOutput(30), 4000),
                        filesystemCacheInvalidated: true,
                        followUp: 'Use terminal.write for process input and terminal.kill to interrupt the foreground process.',
                    },
                };
            },
        },
        {
            name: 'terminal.write',
            description: 'Write raw input to the shared terminal. Use only for interactive prompts or process input after terminal.spawn or terminal.exec reports a running command.',
            inputSchema: {
                type: 'object',
                required: ['input'],
                properties: {
                    input: { type: 'string' },
                },
            },
            async execute(input) {
                const obj = objectInput(input);
                const rawInput = requireString(obj, 'input');
                if (!TerminalService_1.terminalService.isBusy()) {
                    throw new Error('No active terminal process is ready to receive input.');
                }
                const session = ensureSession();
                TerminalService_1.terminalService.write(rawInput);
                return {
                    summary: `Wrote ${rawInput.length} characters to terminal`,
                    data: { sessionId: session.id, written: true },
                };
            },
        },
        {
            name: 'terminal.kill',
            description: 'Interrupt the current terminal foreground process with Ctrl+C. Use to stop long-running commands started in the shared terminal.',
            inputSchema: { type: 'object', properties: {} },
            async execute() {
                if (!TerminalService_1.terminalService.isBusy()) {
                    throw new Error('No active terminal foreground process is running.');
                }
                const session = ensureSession();
                TerminalService_1.terminalService.write('\x03');
                invalidateFilesystemViewsFromTerminal();
                return {
                    summary: 'Sent interrupt to terminal',
                    data: {
                        sessionId: session.id,
                        recentOutput: compactOutput(TerminalService_1.terminalService.getRecentOutput(30), 4000),
                        filesystemCacheInvalidated: true,
                    },
                };
            },
        },
    ];
}
//# sourceMappingURL=terminalTools.js.map