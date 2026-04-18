"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const terminalTools_1 = require("./terminalTools");
const { dispatchCommandMock, executeCommandIsolatedMock, getCwdMock, getRecentOutputMock, getSessionMock, invalidateByToolPrefixMock, isBusyMock, restartMock, startSessionMock, writeMock, } = vitest_1.vi.hoisted(() => ({
    dispatchCommandMock: vitest_1.vi.fn(),
    executeCommandIsolatedMock: vitest_1.vi.fn(),
    getCwdMock: vitest_1.vi.fn(),
    getRecentOutputMock: vitest_1.vi.fn(),
    getSessionMock: vitest_1.vi.fn(),
    invalidateByToolPrefixMock: vitest_1.vi.fn(),
    isBusyMock: vitest_1.vi.fn(),
    restartMock: vitest_1.vi.fn(),
    startSessionMock: vitest_1.vi.fn(),
    writeMock: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../terminal/TerminalService', () => ({
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
vitest_1.vi.mock('../AgentCache', () => ({
    agentCache: {
        invalidateByToolPrefix: invalidateByToolPrefixMock,
    },
}));
function getTool(name) {
    const tool = (0, terminalTools_1.createTerminalToolDefinitions)().find((entry) => entry.name === name);
    if (!tool) {
        throw new Error(`Missing tool definition for ${name}`);
    }
    return tool;
}
(0, vitest_1.describe)('terminal tools', () => {
    (0, vitest_1.beforeEach)(() => {
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
    (0, vitest_1.it)('runs terminal.exec through isolated command execution', async () => {
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
        (0, vitest_1.expect)(executeCommandIsolatedMock).toHaveBeenCalledWith('echo ok', {
            cwd: '/tmp',
            timeoutMs: 5_000,
        });
        (0, vitest_1.expect)(startSessionMock).not.toHaveBeenCalled();
        (0, vitest_1.expect)(result.summary).toBe('Executed command: echo ok (exit 0)');
        (0, vitest_1.expect)(result.data).toMatchObject({
            command: 'echo ok',
            cwd: '/tmp',
            durationMs: 12,
            exitCode: 0,
            filesystemCacheInvalidated: true,
            output: 'ok\n',
        });
        (0, vitest_1.expect)(invalidateByToolPrefixMock).toHaveBeenCalledWith('filesystem.');
    });
    (0, vitest_1.it)('returns timeout details from isolated execution without reading shared PTY output', async () => {
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
        (0, vitest_1.expect)(result.summary).toBe('Command timed out after 30000ms: sleep 10');
        (0, vitest_1.expect)(result.data).toMatchObject({
            command: 'sleep 10',
            cwd: '/workspace',
            durationMs: 30_000,
            timedOut: true,
            output: 'partial output',
        });
        (0, vitest_1.expect)(getRecentOutputMock).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=terminalTools.test.js.map