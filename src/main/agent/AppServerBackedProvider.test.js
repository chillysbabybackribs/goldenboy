"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const { connectMock, invokeMock, abortMock, constructorSpy, bridgeConstructorSpy, bridgeStartMock, bridgeStopMock, bridgeGetPortMock, processConstructorSpy, processStartMock, processStopMock, processWaitUntilReadyMock, } = vitest_1.vi.hoisted(() => ({
    connectMock: vitest_1.vi.fn(async () => { }),
    invokeMock: vitest_1.vi.fn(async () => ({ output: 'ok', codexItems: [], usage: { inputTokens: 0, outputTokens: 0, durationMs: 0 } })),
    abortMock: vitest_1.vi.fn(() => { }),
    constructorSpy: vitest_1.vi.fn(),
    bridgeConstructorSpy: vitest_1.vi.fn(),
    bridgeStartMock: vitest_1.vi.fn(async () => { }),
    bridgeStopMock: vitest_1.vi.fn(async () => { }),
    bridgeGetPortMock: vitest_1.vi.fn(() => 5678),
    processConstructorSpy: vitest_1.vi.fn(),
    processStartMock: vitest_1.vi.fn(async () => { }),
    processStopMock: vitest_1.vi.fn(() => { }),
    processWaitUntilReadyMock: vitest_1.vi.fn(async () => ({ wsPort: 8765 })),
}));
vitest_1.vi.mock('./AppServerProvider', () => ({
    AppServerProvider: class {
        constructor(...args) {
            constructorSpy(...args);
        }
        connect = connectMock;
        invoke = invokeMock;
        abort = abortMock;
    },
}));
vitest_1.vi.mock('./V2ToolBridge', () => ({
    V2ToolBridge: class {
        constructor(...args) {
            bridgeConstructorSpy(...args);
        }
        start = bridgeStartMock;
        stop = bridgeStopMock;
        getPort = bridgeGetPortMock;
    },
}));
vitest_1.vi.mock('./AppServerProcess', () => ({
    AppServerProcess: class {
        constructor(...args) {
            processConstructorSpy(...args);
        }
        start = processStartMock;
        stop = processStopMock;
        waitUntilReady = processWaitUntilReadyMock;
    },
}));
const AppServerBackedProvider_1 = require("./AppServerBackedProvider");
function buildRequest() {
    return {
        runId: 'run-1',
        agentId: 'gpt-5.4',
        mode: 'unrestricted-dev',
        taskId: 'task-1',
        systemPrompt: 'system',
        task: 'task',
        promptTools: [],
        toolCatalog: [],
        toolBindings: [],
    };
}
(0, vitest_1.describe)('AppServerBackedProvider', () => {
    (0, vitest_1.beforeEach)(() => {
        connectMock.mockClear();
        invokeMock.mockClear();
        abortMock.mockClear();
        constructorSpy.mockClear();
        bridgeConstructorSpy.mockClear();
        bridgeStartMock.mockClear();
        bridgeStopMock.mockClear();
        bridgeGetPortMock.mockClear();
        processConstructorSpy.mockClear();
        processStartMock.mockClear();
        processStopMock.mockClear();
        processWaitUntilReadyMock.mockClear();
    });
    (0, vitest_1.it)('connects lazily and delegates invoke through AppServerProvider', async () => {
        const provider = new AppServerBackedProvider_1.AppServerBackedProvider({
            providerId: 'gpt-5.4',
            modelId: 'gpt-5.4',
            process: {},
            wsPort: 4321,
        });
        const request = buildRequest();
        await provider.invoke(request);
        await provider.invoke(request);
        (0, vitest_1.expect)(constructorSpy).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(connectMock).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(connectMock).toHaveBeenCalledWith(4321);
        (0, vitest_1.expect)(invokeMock).toHaveBeenCalledTimes(2);
        (0, vitest_1.expect)(invokeMock).toHaveBeenCalledWith(request);
    });
    (0, vitest_1.it)('supports prewarming the delegate before the first invoke', async () => {
        const provider = new AppServerBackedProvider_1.AppServerBackedProvider({
            providerId: 'gpt-5.4',
            modelId: 'gpt-5.4',
            process: {},
            wsPort: 4321,
        });
        await provider.prewarm();
        await provider.invoke(buildRequest());
        (0, vitest_1.expect)(constructorSpy).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(connectMock).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(invokeMock).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('forwards abort to the connected delegate', async () => {
        const provider = new AppServerBackedProvider_1.AppServerBackedProvider({
            providerId: 'gpt-5.4',
            modelId: 'gpt-5.4',
            process: {},
            wsPort: 4321,
        });
        await provider.invoke(buildRequest());
        provider.abort();
        (0, vitest_1.expect)(abortMock).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('applies a pending abort to the delegate when abort is called before connection completes', async () => {
        let resolveConnect;
        connectMock.mockImplementationOnce(() => new Promise((resolve) => { resolveConnect = resolve; }));
        const provider = new AppServerBackedProvider_1.AppServerBackedProvider({
            providerId: 'gpt-5.4',
            modelId: 'gpt-5.4',
            process: {},
            wsPort: 4321,
        });
        const invokePromise = provider.invoke(buildRequest());
        // abort before the connection resolves
        provider.abort();
        // now let connect finish
        resolveConnect();
        await invokePromise;
        (0, vitest_1.expect)(abortMock).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('starts an owned bridge and process when no shared app-server session is provided', async () => {
        const provider = new AppServerBackedProvider_1.AppServerBackedProvider({
            providerId: 'gpt-5.4',
            modelId: 'gpt-5.4',
        });
        await provider.invoke(buildRequest());
        (0, vitest_1.expect)(bridgeConstructorSpy).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(bridgeStartMock).toHaveBeenCalledTimes(1);
        const contextPath = bridgeConstructorSpy.mock.calls[0][0];
        (0, vitest_1.expect)(typeof contextPath).toBe('string');
        (0, vitest_1.expect)(processConstructorSpy).toHaveBeenCalledWith(5678, vitest_1.expect.stringContaining('v2-mcp-shim.js'), contextPath);
        (0, vitest_1.expect)(processStartMock).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(processWaitUntilReadyMock).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(connectMock).toHaveBeenCalledWith(8765);
    });
    (0, vitest_1.it)('clears the cached connect promise after a failed prewarm so a later retry can succeed', async () => {
        connectMock
            .mockImplementationOnce(async () => {
            throw new Error('connect failed');
        })
            .mockImplementationOnce(async () => { });
        const provider = new AppServerBackedProvider_1.AppServerBackedProvider({
            providerId: 'gpt-5.4',
            modelId: 'gpt-5.4',
            process: {},
            wsPort: 4321,
        });
        await (0, vitest_1.expect)(provider.prewarm()).rejects.toThrow('connect failed');
        await provider.invoke(buildRequest());
        (0, vitest_1.expect)(constructorSpy).toHaveBeenCalledTimes(2);
        (0, vitest_1.expect)(connectMock).toHaveBeenCalledTimes(2);
        (0, vitest_1.expect)(invokeMock).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('disposes owned bridge and process resources after use', async () => {
        const provider = new AppServerBackedProvider_1.AppServerBackedProvider({
            providerId: 'gpt-5.4',
            modelId: 'gpt-5.4',
        });
        await provider.invoke(buildRequest());
        await provider.dispose();
        (0, vitest_1.expect)(abortMock).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(processStopMock).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(bridgeStopMock).toHaveBeenCalledTimes(1);
    });
});
//# sourceMappingURL=AppServerBackedProvider.test.js.map