import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentProviderRequest } from './AgentTypes';

const {
  connectMock,
  invokeMock,
  abortMock,
  constructorSpy,
  bridgeConstructorSpy,
  bridgeStartMock,
  bridgeStopMock,
  bridgeGetPortMock,
  processConstructorSpy,
  processStartMock,
  processStopMock,
  processWaitUntilReadyMock,
} = vi.hoisted(() => ({
  connectMock: vi.fn(async () => {}),
  invokeMock: vi.fn(async () => ({ output: 'ok', codexItems: [], usage: { inputTokens: 0, outputTokens: 0, durationMs: 0 } })),
  abortMock: vi.fn(() => {}),
  constructorSpy: vi.fn(),
  bridgeConstructorSpy: vi.fn(),
  bridgeStartMock: vi.fn(async () => {}),
  bridgeStopMock: vi.fn(async () => {}),
  bridgeGetPortMock: vi.fn(() => 5678),
  processConstructorSpy: vi.fn(),
  processStartMock: vi.fn(async () => {}),
  processStopMock: vi.fn(() => {}),
  processWaitUntilReadyMock: vi.fn(async () => ({ wsPort: 8765 })),
}));

vi.mock('./AppServerProvider', () => ({
  AppServerProvider: class {
    constructor(...args: unknown[]) {
      constructorSpy(...args);
    }
    connect = connectMock;
    invoke = invokeMock;
    abort = abortMock;
  },
}));

vi.mock('./V2ToolBridge', () => ({
  V2ToolBridge: class {
    constructor(...args: unknown[]) {
      bridgeConstructorSpy(...args);
    }
    start = bridgeStartMock;
    stop = bridgeStopMock;
    getPort = bridgeGetPortMock;
  },
}));

vi.mock('./AppServerProcess', () => ({
  AppServerProcess: class {
    constructor(...args: unknown[]) {
      processConstructorSpy(...args);
    }
    start = processStartMock;
    stop = processStopMock;
    waitUntilReady = processWaitUntilReadyMock;
  },
}));

import { AppServerBackedProvider } from './AppServerBackedProvider';

function buildRequest(): AgentProviderRequest {
  return {
    runId: 'run-1',
    agentId: 'gpt-5.4',
    mode: 'unrestricted-dev',
    taskId: 'task-1',
    systemPrompt: 'system',
    task: 'task',
    tools: [],
  };
}

describe('AppServerBackedProvider', () => {
  beforeEach(() => {
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

  it('connects lazily and delegates invoke through AppServerProvider', async () => {
    const provider = new AppServerBackedProvider({
      providerId: 'gpt-5.4',
      modelId: 'gpt-5.4',
      process: {} as any,
      wsPort: 4321,
    });

    const request = buildRequest();
    await provider.invoke(request);
    await provider.invoke(request);

    expect(constructorSpy).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalledWith(4321);
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenCalledWith(request);
  });

  it('forwards abort to the connected delegate', async () => {
    const provider = new AppServerBackedProvider({
      providerId: 'gpt-5.4',
      modelId: 'gpt-5.4',
      process: {} as any,
      wsPort: 4321,
    });

    await provider.invoke(buildRequest());
    provider.abort();

    expect(abortMock).toHaveBeenCalledTimes(1);
  });

  it('applies a pending abort to the delegate when abort is called before connection completes', async () => {
    let resolveConnect!: () => void;
    connectMock.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveConnect = resolve; }));

    const provider = new AppServerBackedProvider({
      providerId: 'gpt-5.4',
      modelId: 'gpt-5.4',
      process: {} as any,
      wsPort: 4321,
    });

    const invokePromise = provider.invoke(buildRequest());
    // abort before the connection resolves
    provider.abort();
    // now let connect finish
    resolveConnect();
    await invokePromise;

    expect(abortMock).toHaveBeenCalledTimes(1);
  });

  it('starts an owned bridge and process when no shared app-server session is provided', async () => {
    const provider = new AppServerBackedProvider({
      providerId: 'gpt-5.4',
      modelId: 'gpt-5.4',
    });

    await provider.invoke(buildRequest());

    expect(bridgeConstructorSpy).toHaveBeenCalledTimes(1);
    expect(bridgeStartMock).toHaveBeenCalledTimes(1);
    const contextPath = bridgeConstructorSpy.mock.calls[0][0];
    expect(typeof contextPath).toBe('string');
    expect(processConstructorSpy).toHaveBeenCalledWith(
      5678,
      expect.stringContaining('v2-mcp-shim.js'),
      contextPath,
    );
    expect(processStartMock).toHaveBeenCalledTimes(1);
    expect(processWaitUntilReadyMock).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalledWith(8765);
  });

  it('disposes owned bridge and process resources after use', async () => {
    const provider = new AppServerBackedProvider({
      providerId: 'gpt-5.4',
      modelId: 'gpt-5.4',
    });

    await provider.invoke(buildRequest());
    await provider.dispose();

    expect(abortMock).toHaveBeenCalledTimes(1);
    expect(processStopMock).toHaveBeenCalledTimes(1);
    expect(bridgeStopMock).toHaveBeenCalledTimes(1);
  });
});
