import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTerminalToolDefinitions } from './terminalTools';

const {
  dispatchCommandMock,
  executeCommandIsolatedMock,
  getCwdMock,
  getRecentOutputMock,
  getSessionMock,
  invalidateByToolPrefixMock,
  isBusyMock,
  restartMock,
  startSessionMock,
  writeMock,
} = vi.hoisted(() => ({
  dispatchCommandMock: vi.fn(),
  executeCommandIsolatedMock: vi.fn(),
  getCwdMock: vi.fn(),
  getRecentOutputMock: vi.fn(),
  getSessionMock: vi.fn(),
  invalidateByToolPrefixMock: vi.fn(),
  isBusyMock: vi.fn(),
  restartMock: vi.fn(),
  startSessionMock: vi.fn(),
  writeMock: vi.fn(),
}));

vi.mock('../../terminal/TerminalService', () => ({
  terminalService: {
    dispatchCommand: dispatchCommandMock,
    executeCommandIsolated: executeCommandIsolatedMock,
    getCwd: getCwdMock,
    getRecentOutput: getRecentOutputMock,
    getSession: getSessionMock,
    isBusy: isBusyMock,
    restart: restartMock,
    startSession: startSessionMock,
    write: writeMock,
  },
}));

vi.mock('../AgentCache', () => ({
  agentCache: {
    invalidateByToolPrefix: invalidateByToolPrefixMock,
  },
}));

function getTool(name: string) {
  const tool = createTerminalToolDefinitions().find((entry) => entry.name === name);
  if (!tool) {
    throw new Error(`Missing tool definition for ${name}`);
  }
  return tool;
}

describe('terminal tools', () => {
  beforeEach(() => {
    dispatchCommandMock.mockReset();
    executeCommandIsolatedMock.mockReset();
    getCwdMock.mockReset();
    getRecentOutputMock.mockReset();
    getSessionMock.mockReset();
    invalidateByToolPrefixMock.mockReset();
    isBusyMock.mockReset();
    restartMock.mockReset();
    startSessionMock.mockReset();
    writeMock.mockReset();

    getSessionMock.mockReturnValue({
      id: 'term-1',
      cwd: '/workspace',
      status: 'running',
    });
    getCwdMock.mockReturnValue('/workspace');
    getRecentOutputMock.mockReturnValue('');
    isBusyMock.mockReturnValue(false);
    restartMock.mockReturnValue({ id: 'term-2', shell: '/bin/bash' });
    startSessionMock.mockReturnValue({
      id: 'term-1',
      cwd: '/workspace',
      status: 'running',
    });
  });

  it('runs terminal.exec through isolated command execution', async () => {
    executeCommandIsolatedMock.mockResolvedValue({
      command: 'echo ok',
      cwd: '/tmp',
      durationMs: 12,
      exitCode: 0,
      output: 'ok\n',
      timedOut: false,
    });

    const result = await getTool('terminal.exec').execute({
      command: 'echo ok',
      cwd: '/tmp',
      timeoutMs: 5_000,
      maxOutputChars: 1_000,
    });

    expect(executeCommandIsolatedMock).toHaveBeenCalledWith('echo ok', {
      cwd: '/tmp',
      timeoutMs: 5_000,
    });
    expect(startSessionMock).not.toHaveBeenCalled();
    expect(result.summary).toBe('Executed command: echo ok (exit 0)');
    expect(result.data).toMatchObject({
      command: 'echo ok',
      cwd: '/tmp',
      durationMs: 12,
      exitCode: 0,
      filesystemCacheInvalidated: true,
      output: 'ok\n',
    });
    expect(invalidateByToolPrefixMock).toHaveBeenCalledWith('filesystem.');
  });

  it('returns timeout details from isolated execution without reading shared PTY output', async () => {
    executeCommandIsolatedMock.mockResolvedValue({
      command: 'sleep 10',
      cwd: '/workspace',
      durationMs: 30_000,
      exitCode: null,
      output: 'partial output',
      timedOut: true,
    });

    const result = await getTool('terminal.exec').execute({
      command: 'sleep 10',
      timeoutMs: 30_000,
    });

    expect(result.summary).toBe('Command timed out after 30000ms: sleep 10');
    expect(result.data).toMatchObject({
      command: 'sleep 10',
      cwd: '/workspace',
      durationMs: 30_000,
      timedOut: true,
      output: 'partial output',
    });
    expect(getRecentOutputMock).not.toHaveBeenCalled();
  });
});
