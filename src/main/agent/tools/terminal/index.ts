import { AgentToolDefinition } from '../../AgentTypes';
import { terminalService } from '../../../terminal/TerminalService';
import { agentCache } from '../../AgentCache';
import * as fs from 'fs';
import * as path from 'path';
import { APP_WORKSPACE_ROOT } from '../../../workspaceRoot';

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

type RepoScriptName = 'build' | 'test';

type RepoScriptPlan = {
  scriptName: RepoScriptName;
  command: string;
  cwd: string;
  manifestPath: string;
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun';
};

function normalizeCwd(cwd?: string): string {
  if (!cwd) return APP_WORKSPACE_ROOT;
  return path.resolve(APP_WORKSPACE_ROOT, cwd);
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function detectPackageManager(dir: string, manifest: Record<string, unknown>): RepoScriptPlan['packageManager'] {
  const packageManager = typeof manifest.packageManager === 'string' ? manifest.packageManager.toLowerCase() : '';
  if (packageManager.startsWith('pnpm@')) return 'pnpm';
  if (packageManager.startsWith('yarn@')) return 'yarn';
  if (packageManager.startsWith('bun@')) return 'bun';
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(dir, 'bun.lockb')) || fs.existsSync(path.join(dir, 'bun.lock'))) return 'bun';
  return 'npm';
}

function scriptCommandForPackageManager(
  packageManager: RepoScriptPlan['packageManager'],
  scriptName: RepoScriptName,
): string {
  switch (packageManager) {
    case 'pnpm': return `pnpm ${scriptName}`;
    case 'yarn': return `yarn ${scriptName}`;
    case 'bun': return `bun run ${scriptName}`;
    case 'npm':
    default:
      return scriptName === 'test' ? 'npm test' : `npm run ${scriptName}`;
  }
}

function resolveRepoScriptPlan(scriptName: RepoScriptName, cwd?: string): RepoScriptPlan {
  let current = normalizeCwd(cwd);
  const root = path.parse(current).root;

  while (true) {
    const manifestPath = path.join(current, 'package.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = readJsonFile(manifestPath);
      const scripts = manifest && typeof manifest.scripts === 'object' && manifest.scripts !== null
        ? manifest.scripts as Record<string, unknown>
        : null;
      const scriptValue = scripts?.[scriptName];
      if (typeof scriptValue === 'string' && scriptValue.trim()) {
        const packageManager = detectPackageManager(current, manifest ?? {});
        return {
          scriptName,
          command: scriptCommandForPackageManager(packageManager, scriptName),
          cwd: current,
          manifestPath,
          packageManager,
        };
      }
    }

    if (current === APP_WORKSPACE_ROOT || current === root) break;
    current = path.dirname(current);
  }

  throw new Error(`No package.json with a ${scriptName} script was found from ${normalizeCwd(cwd)} up to ${APP_WORKSPACE_ROOT}.`);
}

export function resolveRepoBuildPlan(cwd?: string): RepoScriptPlan {
  return resolveRepoScriptPlan('build', cwd);
}

export function resolveRepoTestPlan(cwd?: string): RepoScriptPlan {
  return resolveRepoScriptPlan('test', cwd);
}

function invalidateFilesystemViewsFromTerminal(): void {
  // Shell commands may mutate files or cwd outside the host's direct view.
  // Drop cached filesystem tool results so follow-up reads re-observe state.
  agentCache.invalidateByToolPrefix('filesystem.');
}

export function createTerminalToolDefinitions(): AgentToolDefinition[] {
  return [
    {
      name: 'terminal.exec',
      description: 'Run a shell command in the shared terminal and wait for completion. Use for git, gh, package managers, CLIs, tests, builds, deploys, and local automation. Prefer non-interactive commands.',
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
        invalidateFilesystemViewsFromTerminal();

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
            cwd: result.cwd || terminalService.getCwd() || session.cwd,
            durationMs: result.durationMs,
            output: compactOutput(result.output, maxOutputChars),
            sessionId: session.id,
            filesystemCacheInvalidated: true,
            followUp: 'If the command changed files, rerun filesystem.index_workspace before relying on indexed file cache search.',
          },
        };
      },
    },
    {
      name: 'terminal.build_repo',
      description: 'Run the repository build command from the nearest package.json that defines a build script. Use this instead of terminal.exec when you need deterministic build verification after code changes.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: { type: 'string' },
          timeoutMs: { type: 'number' },
          maxOutputChars: { type: 'number' },
        },
      },
      async execute(input) {
        const obj = objectInput(input);
        const plan = resolveRepoBuildPlan(optionalString(obj, 'cwd'));
        const timeoutMs = Math.min(Math.max(optionalNumber(obj, 'timeoutMs', 120_000), 1_000), 180_000);
        const maxOutputChars = Math.min(Math.max(optionalNumber(obj, 'maxOutputChars', 12_000), 1_000), 64_000);
        const session = ensureSession();
        const effectiveCommand = commandWithCwd(plan.command, plan.cwd);
        const result = await terminalService.executeCommand(effectiveCommand, timeoutMs);
        invalidateFilesystemViewsFromTerminal();

        if (!result) {
          const output = terminalService.getRecentOutput(80);
          return {
            summary: `Repository build still running or timed out after ${timeoutMs}ms`,
            data: {
              buildCommand: plan.command,
              manifestPath: plan.manifestPath,
              packageManager: plan.packageManager,
              cwd: plan.cwd,
              timedOut: true,
              output: compactOutput(output, maxOutputChars),
              sessionId: session.id,
              buildVerified: true,
              filesystemCacheInvalidated: true,
            },
          };
        }

        return {
          summary: `Built repository with ${plan.command} (exit ${result.exitCode})`,
          data: {
            buildCommand: plan.command,
            manifestPath: plan.manifestPath,
            packageManager: plan.packageManager,
            exitCode: result.exitCode,
            cwd: result.cwd || terminalService.getCwd() || plan.cwd,
            durationMs: result.durationMs,
            output: compactOutput(result.output, maxOutputChars),
            sessionId: session.id,
            buildVerified: true,
            filesystemCacheInvalidated: true,
          },
        };
      },
    },
    {
      name: 'terminal.test_repo',
      description: 'Run the repository test command from the nearest package.json that defines a test script. Use this instead of terminal.exec when you need deterministic repository test verification.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: { type: 'string' },
          timeoutMs: { type: 'number' },
          maxOutputChars: { type: 'number' },
        },
      },
      async execute(input) {
        const obj = objectInput(input);
        const plan = resolveRepoTestPlan(optionalString(obj, 'cwd'));
        const timeoutMs = Math.min(Math.max(optionalNumber(obj, 'timeoutMs', 180_000), 1_000), 180_000);
        const maxOutputChars = Math.min(Math.max(optionalNumber(obj, 'maxOutputChars', 12_000), 1_000), 64_000);
        const session = ensureSession();
        const effectiveCommand = commandWithCwd(plan.command, plan.cwd);
        const result = await terminalService.executeCommand(effectiveCommand, timeoutMs);
        invalidateFilesystemViewsFromTerminal();

        if (!result) {
          const output = terminalService.getRecentOutput(80);
          return {
            summary: `Repository tests still running or timed out after ${timeoutMs}ms`,
            data: {
              testCommand: plan.command,
              manifestPath: plan.manifestPath,
              packageManager: plan.packageManager,
              cwd: plan.cwd,
              timedOut: true,
              output: compactOutput(output, maxOutputChars),
              sessionId: session.id,
              testVerified: true,
              filesystemCacheInvalidated: true,
            },
          };
        }

        return {
          summary: `Tested repository with ${plan.command} (exit ${result.exitCode})`,
          data: {
            testCommand: plan.command,
            manifestPath: plan.manifestPath,
            packageManager: plan.packageManager,
            exitCode: result.exitCode,
            cwd: result.cwd || terminalService.getCwd() || plan.cwd,
            durationMs: result.durationMs,
            output: compactOutput(result.output, maxOutputChars),
            sessionId: session.id,
            testVerified: true,
            filesystemCacheInvalidated: true,
          },
        };
      },
    },
    {
      name: 'terminal.spawn',
      description: 'Start a long-running shell command in the shared terminal without waiting. Use for dev servers, watchers, tunnels, and similar processes.',
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
        if (terminalService.isBusy()) {
          throw new Error('Terminal already has an active or pending foreground command. Wait for it to finish or use terminal.kill before spawning another.');
        }

        const session = ensureSession();
        terminalService.dispatchCommand(commandWithCwd(command, optionalString(obj, 'cwd')));
        invalidateFilesystemViewsFromTerminal();
        return {
          summary: `Spawned long-running command: ${command}`,
          data: {
            command,
            cwd: terminalService.getCwd() || session.cwd,
            sessionId: session.id,
            recentOutput: compactOutput(terminalService.getRecentOutput(30), 4000),
            filesystemCacheInvalidated: true,
            followUp: 'Use terminal.write for process input and terminal.kill to interrupt the foreground process.',
          },
        };
      },
    },
    {
      name: 'terminal.write',
      description: 'Write raw input to the shared terminal. Use only for interactive prompts after terminal.spawn/terminal.exec reports a running command.',
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
        if (!terminalService.isBusy()) {
          throw new Error('No active terminal process is ready to receive input.');
        }
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
      description: 'Send Ctrl+C to the shared terminal to interrupt the foreground process.',
      inputSchema: { type: 'object', properties: {} },
      async execute() {
        if (!terminalService.isBusy()) {
          throw new Error('No active terminal foreground process is running.');
        }
        const session = ensureSession();
        terminalService.write('\x03');
        invalidateFilesystemViewsFromTerminal();
        return {
          summary: 'Sent interrupt to terminal',
          data: {
            sessionId: session.id,
            recentOutput: compactOutput(terminalService.getRecentOutput(30), 4000),
            filesystemCacheInvalidated: true,
          },
        };
      },
    },
    {
      name: 'terminal.status',
      description: 'Report shared terminal status: whether a command is active, the current cwd, and recent output.',
      inputSchema: {
        type: 'object',
        properties: { recentLines: { type: 'number' } },
      },
      async execute(input) {
        const obj = objectInput(input);
        const recentLines = Math.max(1, Math.min(optionalNumber(obj, 'recentLines', 40), 200));
        const session = terminalService.getSession();
        return {
          summary: terminalService.isBusy() ? 'Terminal is busy' : 'Terminal is idle',
          data: {
            isBusy: terminalService.isBusy(),
            cwd: terminalService.getCwd() || session?.cwd || null,
            sessionId: session?.id || null,
            status: session?.status || null,
            recentOutput: compactOutput(terminalService.getRecentOutput(recentLines), 4000),
          },
        };
      },
    },
  ];
}
