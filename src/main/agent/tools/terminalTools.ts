import { AgentToolDefinition } from '../AgentTypes';
import { terminalService } from '../../terminal/TerminalService';

function objectInput(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Expected non-empty string input: ${key}`);
  }
  return value;
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function optionalNumber(input: Record<string, unknown>, key: string, fallback: number): number {
  const value = input[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function ensureSession(): ReturnType<typeof terminalService.startSession> {
  const existing = terminalService.getSession();
  if (existing?.status === 'running') return existing;
  return terminalService.startSession();
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function commandWithCwd(command: string, cwd?: string): string {
  if (!cwd) return command;
  return `cd ${shellQuote(cwd)} && ${command}`;
}

function compactOutput(output: string, maxChars: number): string {
  if (output.length <= maxChars) return output;
  return `${output.slice(-maxChars)}\n...[terminal output truncated to last ${maxChars} chars]`;
}

export function createTerminalToolDefinitions(): AgentToolDefinition[] {
  return [
    {
      name: 'terminal.exec',
      description: 'Execute a shell command in the shared terminal and wait for completion. Use this for real external actions such as git, gh, package managers, CLIs, tests, builds, deployment commands, and local automation. Prefer non-interactive commands.',
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
        if (command.length > 4000) throw new Error('Command is too long');

        const session = ensureSession();
        const cwd = optionalString(obj, 'cwd');
        const timeoutMs = Math.min(Math.max(optionalNumber(obj, 'timeoutMs', 30_000), 1_000), 180_000);
        const maxOutputChars = Math.min(Math.max(optionalNumber(obj, 'maxOutputChars', 12_000), 1_000), 64_000);
        const effectiveCommand = commandWithCwd(command, cwd);

        const result = await terminalService.executeCommand(effectiveCommand, timeoutMs);

        if (!result) {
          const output = terminalService.getRecentOutput(80);
          return {
            summary: `Command still running or timed out after ${timeoutMs}ms: ${command}`,
            data: {
              command,
              cwd: terminalService.getCwd() || session.cwd,
              timedOut: true,
              output: compactOutput(output, maxOutputChars),
              session,
            },
          };
        }

        return {
          summary: `Executed command: ${command} (exit ${result.exitCode})`,
          data: {
            command,
            exitCode: result.exitCode,
            cwd: result.cwd || terminalService.getCwd() || session.cwd,
            durationMs: result.durationMs,
            output: compactOutput(result.output, maxOutputChars),
            sessionId: session.id,
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
        if (command.length > 4000) throw new Error('Command is too long');

        const session = ensureSession();
        terminalService.write(`${commandWithCwd(command, optionalString(obj, 'cwd'))}\n`);
        return {
          summary: `Spawned long-running command: ${command}`,
          data: {
            command,
            cwd: terminalService.getCwd() || session.cwd,
            sessionId: session.id,
            recentOutput: compactOutput(terminalService.getRecentOutput(30), 4000),
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
        const session = ensureSession();
        terminalService.write(rawInput);
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
        const session = ensureSession();
        terminalService.write('\x03');
        return {
          summary: 'Sent interrupt to terminal',
          data: {
            sessionId: session.id,
            recentOutput: compactOutput(terminalService.getRecentOutput(30), 4000),
          },
        };
      },
    },
  ];
}
