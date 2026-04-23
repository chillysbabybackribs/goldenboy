import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const {
  executeCommand,
  getSession,
  startSession,
  getRecentOutput,
  getCwd,
  isBusy,
  dispatchCommand,
  write,
} = vi.hoisted(() => ({
  executeCommand: vi.fn(),
  getSession: vi.fn(() => ({ id: 'term_1', cwd: '/tmp', status: 'running' })),
  startSession: vi.fn(() => ({ id: 'term_1', cwd: '/tmp', status: 'running' })),
  getRecentOutput: vi.fn(() => ''),
  getCwd: vi.fn(() => '/tmp'),
  isBusy: vi.fn(() => false),
  dispatchCommand: vi.fn(),
  write: vi.fn(),
}));

const { invalidateByToolPrefix } = vi.hoisted(() => ({
  invalidateByToolPrefix: vi.fn(),
}));

vi.mock('../../../terminal/TerminalService', () => ({
  terminalService: {
    executeCommand,
    getSession,
    startSession,
    getRecentOutput,
    getCwd,
    isBusy,
    dispatchCommand,
    write,
  },
}));

vi.mock('../../AgentCache', () => ({
  agentCache: {
    invalidateByToolPrefix,
  },
}));

import { createTerminalToolDefinitions, resolveRepoBuildPlan, resolveRepoTestPlan } from './index';

describe('resolveRepoBuildPlan', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldenboy-terminal-tool-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('finds the nearest package.json with a build script and selects npm by default', () => {
    const projectDir = path.join(tempDir, 'project');
    const nestedDir = path.join(projectDir, 'src', 'nested');
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
      scripts: { build: 'tsc -p tsconfig.json' },
    }), 'utf-8');

    const plan = resolveRepoBuildPlan(projectDir);

    expect(plan).toEqual({
      scriptName: 'build',
      command: 'npm run build',
      cwd: projectDir,
      manifestPath: path.join(projectDir, 'package.json'),
      packageManager: 'npm',
    });
    expect(resolveRepoBuildPlan(nestedDir)).toMatchObject({
      command: 'npm run build',
      cwd: projectDir,
    });
  });

  it('detects pnpm from lockfile when present', () => {
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
      scripts: { build: 'tsc -p tsconfig.json' },
    }), 'utf-8');
    fs.writeFileSync(path.join(tempDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0', 'utf-8');

    expect(resolveRepoBuildPlan(tempDir)).toMatchObject({
      command: 'pnpm build',
      packageManager: 'pnpm',
    });
  });

  it('throws when no build script exists in the search path', () => {
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
      scripts: { test: 'vitest run' },
    }), 'utf-8');

    expect(() => resolveRepoBuildPlan(tempDir)).toThrow('No package.json with a build script was found');
  });
});

describe('resolveRepoTestPlan', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldenboy-terminal-tool-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('finds the nearest package.json with a test script and selects npm by default', () => {
    const projectDir = path.join(tempDir, 'project');
    const nestedDir = path.join(projectDir, 'src', 'nested');
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
      scripts: { test: 'vitest run' },
    }), 'utf-8');

    const plan = resolveRepoTestPlan(projectDir);

    expect(plan).toEqual({
      scriptName: 'test',
      command: 'npm test',
      cwd: projectDir,
      manifestPath: path.join(projectDir, 'package.json'),
      packageManager: 'npm',
    });
    expect(resolveRepoTestPlan(nestedDir)).toMatchObject({
      command: 'npm test',
      cwd: projectDir,
    });
  });

  it('throws when no test script exists in the search path', () => {
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
      scripts: { build: 'tsc -p tsconfig.json' },
    }), 'utf-8');

    expect(() => resolveRepoTestPlan(tempDir)).toThrow('No package.json with a test script was found');
  });
});

describe('terminal.build_repo', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldenboy-terminal-build-'));
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
      scripts: { build: 'tsc -p tsconfig.json' },
    }), 'utf-8');
    executeCommand.mockReset();
    getSession.mockReturnValue({ id: 'term_1', cwd: tempDir, status: 'running' });
    getCwd.mockReturnValue(tempDir);
    getRecentOutput.mockReturnValue('');
    invalidateByToolPrefix.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('runs the detected repository build command and returns structured metadata', async () => {
    executeCommand.mockResolvedValue({
      exitCode: 0,
      cwd: tempDir,
      durationMs: 123,
      output: 'build ok',
    });

    const tool = createTerminalToolDefinitions().find((item) => item.name === 'terminal.build_repo');
    expect(tool).toBeTruthy();

    const result = await tool!.execute(
      { cwd: tempDir },
      { runId: 'run_1', agentId: 'agent_1', mode: 'unrestricted-dev' },
    );

    expect(executeCommand).toHaveBeenCalledWith(expect.stringContaining(`cd '${tempDir}' && npm run build`), 120_000);
    expect(result).toEqual({
      summary: 'Built repository with npm run build (exit 0)',
      data: {
        buildCommand: 'npm run build',
        manifestPath: path.join(tempDir, 'package.json'),
        packageManager: 'npm',
        exitCode: 0,
        cwd: tempDir,
        durationMs: 123,
        output: 'build ok',
        sessionId: 'term_1',
        buildVerified: true,
        filesystemCacheInvalidated: true,
      },
    });
    expect(invalidateByToolPrefix).toHaveBeenCalledWith('filesystem.');
  });
});

describe('terminal.test_repo', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldenboy-terminal-test-'));
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
      scripts: { test: 'vitest run' },
    }), 'utf-8');
    executeCommand.mockReset();
    getSession.mockReturnValue({ id: 'term_1', cwd: tempDir, status: 'running' });
    getCwd.mockReturnValue(tempDir);
    getRecentOutput.mockReturnValue('');
    invalidateByToolPrefix.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('runs the detected repository test command and returns structured metadata', async () => {
    executeCommand.mockResolvedValue({
      exitCode: 0,
      cwd: tempDir,
      durationMs: 456,
      output: 'tests ok',
    });

    const tool = createTerminalToolDefinitions().find((item) => item.name === 'terminal.test_repo');
    expect(tool).toBeTruthy();

    const result = await tool!.execute(
      { cwd: tempDir },
      { runId: 'run_1', agentId: 'agent_1', mode: 'unrestricted-dev' },
    );

    expect(executeCommand).toHaveBeenCalledWith(expect.stringContaining(`cd '${tempDir}' && npm test`), 180_000);
    expect(result).toEqual({
      summary: 'Tested repository with npm test (exit 0)',
      data: {
        testCommand: 'npm test',
        manifestPath: path.join(tempDir, 'package.json'),
        packageManager: 'npm',
        exitCode: 0,
        cwd: tempDir,
        durationMs: 456,
        output: 'tests ok',
        sessionId: 'term_1',
        testVerified: true,
        filesystemCacheInvalidated: true,
      },
    });
    expect(invalidateByToolPrefix).toHaveBeenCalledWith('filesystem.');
  });
});
