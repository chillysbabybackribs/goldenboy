import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentProviderRequest, AgentToolDefinition } from './AgentTypes';
import { PRIMARY_PROVIDER_ID } from '../../shared/types/model';

const {
  dispatchMock,
  recordToolMessageMock,
  getPreviousSessionContextMock,
  buildContextInjectionStringMock,
  browserIsReadyMock,
  browserGetActiveTabIdMock,
  browserGetTabsMock,
  pageKnowledgeListPagesMock,
  taskMemoryBuildContextMock,
} = vi.hoisted(() => ({
  dispatchMock: vi.fn(),
  recordToolMessageMock: vi.fn(),
  getPreviousSessionContextMock: vi.fn(() => []),
  buildContextInjectionStringMock: vi.fn(() => ''),
  browserIsReadyMock: vi.fn(() => false),
  browserGetActiveTabIdMock: vi.fn(() => ''),
  browserGetTabsMock: vi.fn<[], Array<Record<string, unknown>>>(() => []),
  pageKnowledgeListPagesMock: vi.fn<[], Array<Record<string, unknown>>>(() => []),
  taskMemoryBuildContextMock: vi.fn<[string], string | null>(() => null),
}));

vi.mock('../state/appStateStore', () => ({
  appStateStore: {
    dispatch: dispatchMock,
  },
}));

vi.mock('../chatKnowledge/ChatKnowledgeStore', () => ({
  chatKnowledgeStore: {
    recordToolMessage: recordToolMessageMock,
  },
}));

vi.mock('../chatKnowledge/ChatSessionMemory', () => ({
  getChatSessionMemory: () => ({
    getPreviousSessionContext: getPreviousSessionContextMock,
    buildContextInjectionString: buildContextInjectionStringMock,
  }),
}));

vi.mock('./defaultBrowserContextSources', () => ({
  defaultBrowserContextSources: {
    isBrowserReady: browserIsReadyMock,
    getActiveTabId: browserGetActiveTabIdMock,
    getTabs: browserGetTabsMock,
    listCachedPages: pageKnowledgeListPagesMock,
  },
}));

vi.mock('../models/taskMemoryStore', () => ({
  taskMemoryStore: {
    buildContext: taskMemoryBuildContextMock,
  },
}));

import { AgentRuntime, assertInitialBrowserScope, readPartialUsageFromError } from './AgentRuntime';
import { agentCache } from './AgentCache';
import { agentRunStore } from './AgentRunStore';
import { agentToolExecutor } from './AgentToolExecutor';
import { executeProviderToolCall } from './providerToolRuntime';
import { AgentCancellationError } from './cancellation';
import { createAnswerSubmitToolDefinitions } from './tools/answerSubmit';

class SuccessfulToolLoopProvider {
  requests: AgentProviderRequest[] = [];

  async invoke(request: AgentProviderRequest) {
    this.requests.push(request);

    const execution = await executeProviderToolCall({
      providerId: PRIMARY_PROVIDER_ID,
      request,
      toolName: 'terminal.exec',
      toolInput: { command: 'echo ok' },
    });

    if (!execution.ok) {
      throw new Error(execution.errorMessage);
    }

    request.onStatus?.(`tool-done:${execution.resultDescription}`);

    return {
      output: execution.toolContent,
      usage: {
        inputTokens: 11,
        outputTokens: 7,
        durationMs: 5,
      },
    };
  }
}

class FailingToolLoopProvider {
  async invoke(request: AgentProviderRequest) {
    const execution = await executeProviderToolCall({
      providerId: PRIMARY_PROVIDER_ID,
      request,
      toolName: 'terminal.exec',
      toolInput: { command: 'false' },
    });

    if (!execution.ok) {
      throw new Error(execution.errorMessage);
    }

    throw new Error('Expected terminal.exec to fail');
  }
}

class CancelledProvider {
  async invoke() {
    throw new AgentCancellationError();
  }
}

class RecordingProvider {
  requests: AgentProviderRequest[] = [];

  async invoke(request: AgentProviderRequest) {
    this.requests.push(request);
    return {
      output: 'provider invoked',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        durationMs: 1,
      },
    };
  }
}

class AnswerSubmitProvider {
  async invoke(request: AgentProviderRequest) {
    const command = await executeProviderToolCall({
      providerId: PRIMARY_PROVIDER_ID,
      request,
      toolName: 'terminal.exec',
      toolInput: { command: 'echo ok' },
    });
    if (!command.ok) throw new Error(command.errorMessage);

    const toolCalls = agentRunStore.listToolCalls(request.runId);
    const evidenceId = toolCalls.find((call) => call.toolName === 'terminal.exec')?.id;
    if (!evidenceId) throw new Error('Missing terminal.exec tool call');

    const submit = await executeProviderToolCall({
      providerId: PRIMARY_PROVIDER_ID,
      request,
      toolName: 'answer.submit',
      toolInput: {
        claims: [{ text: 'The command succeeded.', evidence: [{ toolCallId: evidenceId, quote: 'exitCode: 0' }] }],
        unresolved: [],
      },
    });
    if (!submit.ok) throw new Error(submit.errorMessage);

    return {
      output: 'provider fallback output',
      usage: {
        inputTokens: 3,
        outputTokens: 2,
        durationMs: 1,
      },
    };
  }
}

describe('AgentRuntime', () => {
  beforeEach(() => {
    dispatchMock.mockReset();
    recordToolMessageMock.mockReset();
    getPreviousSessionContextMock.mockReset();
    buildContextInjectionStringMock.mockReset();
    getPreviousSessionContextMock.mockReturnValue([]);
    buildContextInjectionStringMock.mockReturnValue('');
    browserIsReadyMock.mockReset();
    browserGetActiveTabIdMock.mockReset();
    browserGetTabsMock.mockReset();
    pageKnowledgeListPagesMock.mockReset();
    taskMemoryBuildContextMock.mockReset();
    browserIsReadyMock.mockReturnValue(false);
    browserGetActiveTabIdMock.mockReturnValue('');
    browserGetTabsMock.mockReturnValue([]);
    pageKnowledgeListPagesMock.mockReturnValue([]);
    taskMemoryBuildContextMock.mockReturnValue(null);
    agentCache.clear();
  });

  it('runs the provider through the shared tool executor path with validation', async () => {
    const tool: AgentToolDefinition<{ command: string }> = {
      name: 'terminal.exec',
      description: 'Run a terminal command',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          command: { type: 'string' },
        },
        required: ['command'],
      },
      execute: async (input) => ({
        summary: `Ran ${input.command}`,
        data: {
          output: 'ok',
          exitCode: 0,
        },
      }),
    };

    const blockedTool: AgentToolDefinition = {
      name: 'subagent.spawn',
      description: 'Run a delegated sub-agent task',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          task: { type: 'string' },
        },
        required: ['task'],
      },
      execute: async () => ({
        summary: 'spawned',
        data: {},
      }),
    };

    agentToolExecutor.register(tool);
    agentToolExecutor.register(blockedTool);

    const provider = new SuccessfulToolLoopProvider();
    const runtime = new AgentRuntime(provider);
    const statusUpdates: string[] = [];
    const result = await runtime.run({
      mode: 'unrestricted-dev',
      agentId: PRIMARY_PROVIDER_ID,
      role: 'primary',
      task: 'Run the command and report the validated result.',
      taskId: 'task-runtime-success',
      allowedTools: ['terminal.exec'],
      canSpawnSubagents: false,
      maxToolTurns: 4,
      onStatus: (status) => {
        statusUpdates.push(status);
      },
    });

    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].maxToolTurns).toBe(4);
    expect(provider.requests[0].tools.map(toolDef => toolDef.name)).toEqual(['terminal.exec']);
    expect(result.runId).toBeTruthy();
    expect(result.output).toContain('"summary":"Ran echo ok"');
    expect(result.output).toContain('STATUS: VALID');
    expect(statusUpdates).toEqual(['tool-done:Ran echo ok']);
    expect(recordToolMessageMock).toHaveBeenCalledWith(
      'task-runtime-success',
      expect.stringContaining('"tool": "terminal.exec"'),
      PRIMARY_PROVIDER_ID,
      expect.any(String),
    );

    const run = agentRunStore.getRun(result.runId!);
    expect(run).toMatchObject({
      id: result.runId,
      status: 'completed',
    });

    const toolCalls = agentRunStore.listToolCalls(result.runId);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({
      runId: result.runId,
      agentId: PRIMARY_PROVIDER_ID,
      toolName: 'terminal.exec',
      status: 'completed',
    });
    expect(toolCalls[0].output).toMatchObject({
      summary: 'Ran echo ok',
      validation: {
        status: 'VALID',
      },
    });

    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ADD_LOG',
      log: expect.objectContaining({
        message: expect.stringContaining('toolPayloadTokens='),
      }),
    }));
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ADD_LOG',
      log: expect.objectContaining({
        message: expect.stringContaining('scopedToolNames=terminal.exec'),
      }),
    }));
  });

  it('auto-runs the deterministic browser-search workflow instead of invoking the provider', async () => {
    const workflowExecute = vi.fn(async (input: { workflowId: string; inputs: { query: string } }) => ({
      summary: 'Workflow browser-automation-research completed 3 steps',
      data: {
        workflowId: input.workflowId,
        stepResults: {
          search_browser_automation: {
            data: {
              openedPages: [
                {
                  title: 'What is ChromeDriver?',
                  url: 'https://developer.chrome.com/docs/chromedriver',
                  summary: 'ChromeDriver implements the W3C WebDriver and WebDriver BiDi standards.',
                  answerEvidence: [
                    'ChromeDriver implements the W3C WebDriver and WebDriver BiDi standards.',
                  ],
                },
              ],
            },
          },
        },
      },
    }));

    agentToolExecutor.register({
      name: 'browser.run_workflow',
      description: 'Run deterministic browser workflow',
      inputSchema: {
        type: 'object',
        required: ['workflowId'],
        properties: {
          workflowId: { type: 'string' },
          inputs: { type: 'object' },
        },
      },
      execute: workflowExecute,
    });

    const provider = new RecordingProvider();
    const runtime = new AgentRuntime(provider);
    const statusUpdates: string[] = [];
    const result = await runtime.run({
      mode: 'unrestricted-dev',
      agentId: PRIMARY_PROVIDER_ID,
      role: 'primary',
      task: [
        'Runtime directive: This is a browser-search task.',
        '',
        'User request: Search the web for research on browser automation in Chromium and tell me what you find.',
      ].join('\n'),
      taskId: 'task-runtime-browser-search-fast-path',
      taskProfileOverride: { kind: 'browser-search' },
      allowedTools: ['browser.run_workflow', 'browser.research_search', 'browser.extract_page', 'browser.record_finding'],
      onStatus: (status) => {
        statusUpdates.push(status);
      },
    });

    expect(provider.requests).toHaveLength(0);
    expect(workflowExecute).toHaveBeenCalledWith({
      workflowId: 'browser-automation-research',
      inputs: {
        query: 'Search the web for research on browser automation in Chromium and tell me what you find.',
      },
    }, expect.objectContaining({
      taskId: 'task-runtime-browser-search-fast-path',
    }));
    expect(result.output).toContain('ChromeDriver implements the W3C WebDriver and WebDriver BiDi standards.');
    expect(result.output).toContain('https://developer.chrome.com/docs/chromedriver');
    expect(statusUpdates).toEqual([
      'tool-start:Browser: run workflow browser-automation-research',
      'tool-done:Browser: run workflow browser-automation-research -> Workflow browser-automation-research completed 3 steps',
    ]);
  });

  it('surfaces a grounded final answer from answer.submit', async () => {
    agentToolExecutor.register({
      name: 'terminal.exec',
      description: 'Run a terminal command',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          command: { type: 'string' },
        },
        required: ['command'],
      },
      execute: async (input: { command: string }) => ({
        summary: `Ran ${input.command}`,
        data: {
          output: 'ok',
          exitCode: 0,
        },
      }),
    });
    agentToolExecutor.register(createAnswerSubmitToolDefinitions()[0]);

    const runtime = new AgentRuntime(new AnswerSubmitProvider());
    const result = await runtime.run({
      mode: 'unrestricted-dev',
      agentId: PRIMARY_PROVIDER_ID,
      role: 'primary',
      task: 'Run the command and submit the grounded answer.',
      taskId: 'task-runtime-final-answer',
      allowedTools: ['terminal.exec', 'answer.submit'],
    });

    expect(result.finalAnswer).toMatchObject({
      claims: [{ text: 'The command succeeded.' }],
      unresolved: [],
    });
    expect(result.output).toContain('The command succeeded.');
    expect(result.output).toContain('[ref:tool_');
  });

  it('forwards maxTokensOverride to the provider request', async () => {
    const provider = {
      requests: [] as AgentProviderRequest[],
      async invoke(request: AgentProviderRequest) {
        this.requests.push(request);
        return {
          output: 'ok',
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            durationMs: 1,
          },
        };
      },
    };

    const runtime = new AgentRuntime(provider);
    await runtime.run({
      mode: 'unrestricted-dev',
      agentId: PRIMARY_PROVIDER_ID,
      role: 'primary',
      task: 'Forward the per-run output budget.',
      taskId: 'task-runtime-max-tokens',
      allowedTools: [],
      maxTokensOverride: 6000,
    });

    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].maxTokensOverride).toBe(6000);
  });

  it('respects explicit allowedTools without exposing the rest of the registry', async () => {
    const filesystemList: AgentToolDefinition = {
      name: 'filesystem.list',
      description: 'List a directory',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
      },
      execute: async () => ({
        summary: 'Listed',
        data: {
          entries: [],
        },
      }),
    };

    agentToolExecutor.register(filesystemList);

    const provider = {
      requests: [] as AgentProviderRequest[],
      async invoke(request: AgentProviderRequest) {
        this.requests.push(request);
        return {
          output: 'ok',
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            durationMs: 1,
          },
        };
      },
    };

    const runtime = new AgentRuntime(provider);
    await runtime.run({
      mode: 'unrestricted-dev',
      agentId: PRIMARY_PROVIDER_ID,
      role: 'primary',
      task: 'List a directory and continue.',
      taskId: 'task-runtime-scope-registry',
      allowedTools: ['filesystem.list'],
      canSpawnSubagents: false,
    });

    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].tools.map((tool) => tool.name)).toEqual(['filesystem.list']);
  });

  it('marks the runtime run as failed when the provider surfaces a tool failure', async () => {
    const failingTool: AgentToolDefinition<{ command: string }> = {
      name: 'terminal.exec',
      description: 'Run a terminal command',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          command: { type: 'string' },
        },
        required: ['command'],
      },
      execute: async () => {
        throw new Error('command exploded');
      },
    };

    agentToolExecutor.register(failingTool);

    const runtime = new AgentRuntime(new FailingToolLoopProvider());
    await expect(runtime.run({
      mode: 'unrestricted-dev',
      agentId: PRIMARY_PROVIDER_ID,
      role: 'primary',
      task: 'Run the command and handle the failure.',
      taskId: 'task-runtime-failure',
      allowedTools: ['terminal.exec'],
    })).rejects.toThrow('command exploded');

    expect(recordToolMessageMock).toHaveBeenCalledWith(
      'task-runtime-failure',
      expect.stringContaining('"error": "command exploded"'),
      PRIMARY_PROVIDER_ID,
      expect.any(String),
    );

    const failedRun = agentRunStore.listRuns().find(run => run.task === 'Run the command and handle the failure.');
    expect(failedRun).toBeTruthy();
    expect(failedRun).toMatchObject({
      status: 'failed',
      error: 'command exploded',
    });

    const toolCalls = agentRunStore.listToolCalls(failedRun!.id);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({
      runId: failedRun!.id,
      toolName: 'terminal.exec',
      status: 'failed',
      error: 'command exploded',
    });
  });

  it('marks the runtime run as cancelled when the provider is aborted by the user', async () => {
    const runtime = new AgentRuntime(new CancelledProvider());
    await expect(runtime.run({
      mode: 'unrestricted-dev',
      agentId: PRIMARY_PROVIDER_ID,
      role: 'primary',
      task: 'Stop the task before it completes.',
      taskId: 'task-runtime-cancelled',
      allowedTools: [],
    })).rejects.toThrow('Task cancelled by user.');

    const cancelledRun = agentRunStore.listRuns().find(run => run.task === 'Stop the task before it completes.');
    expect(cancelledRun).toBeTruthy();
    expect(cancelledRun).toMatchObject({
      status: 'cancelled',
      error: 'Task cancelled by user.',
    });
  });

  it('attaches provider partial usage to rethrown errors so burned tokens can be recorded', async () => {
    const failing = {
      getPartialUsage() {
        return {
          inputTokens: 42,
          outputTokens: 9,
          cachedInputTokens: 16,
          durationMs: 12,
        };
      },
      async invoke() {
        throw new Error('provider exploded mid-turn');
      },
    };

    const runtime = new AgentRuntime(failing);
    let captured: unknown = null;
    try {
      await runtime.run({
        mode: 'unrestricted-dev',
        agentId: PRIMARY_PROVIDER_ID,
        role: 'primary',
        task: 'Partial usage capture test.',
        taskId: 'task-runtime-partial-usage',
        allowedTools: [],
      });
    } catch (err) {
      captured = err;
    }

    expect(captured).toBeInstanceOf(Error);
    expect(readPartialUsageFromError(captured)).toEqual({
      inputTokens: 42,
      outputTokens: 9,
      cachedInputTokens: 16,
      cacheCreationInputTokens: undefined,
      durationMs: 12,
    });
  });

  it('applies one shared context cap after merging session and task context', async () => {
    const provider = {
      requests: [] as AgentProviderRequest[],
      async invoke(request: AgentProviderRequest) {
        this.requests.push(request);
        return {
          output: 'ok',
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            durationMs: 1,
          },
        };
      },
    };

    getPreviousSessionContextMock.mockReturnValue([{ id: 'session-1' }]);
    buildContextInjectionStringMock.mockReturnValue('S'.repeat(500));

    const runtime = new AgentRuntime(provider);
    await runtime.run({
      mode: 'unrestricted-dev',
      agentId: PRIMARY_PROVIDER_ID,
      role: 'primary',
      task: 'Preserve the main context while respecting a shared cap.',
      taskId: 'task-runtime-context-cap',
      allowedTools: [],
      canSpawnSubagents: false,
      contextPrompt: 'C'.repeat(3900),
    });

    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].contextPrompt).toBeTruthy();
    expect(provider.requests[0].contextPrompt!.length).toBeLessThanOrEqual(4000);
    expect(provider.requests[0].contextPrompt).toContain('C'.repeat(50));
  });

  it('injects the volatile current date/time at the start of the user-turn context so the system prompt stays cacheable', async () => {
    const provider = {
      requests: [] as AgentProviderRequest[],
      async invoke(request: AgentProviderRequest) {
        this.requests.push(request);
        return {
          output: 'ok',
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            durationMs: 1,
          },
        };
      },
    };

    getPreviousSessionContextMock.mockReturnValue([]);
    buildContextInjectionStringMock.mockReturnValue('');

    const runtime = new AgentRuntime(provider);
    await runtime.run({
      mode: 'unrestricted-dev',
      agentId: PRIMARY_PROVIDER_ID,
      role: 'primary',
      task: 'Write a short note about token caching behavior.',
      taskId: 'task-datetime-injection',
      allowedTools: [],
      canSpawnSubagents: false,
    });

    const request = provider.requests[0];
    expect(request).toBeDefined();
    expect(request.contextPrompt).toBeTruthy();
    expect(request.contextPrompt!.startsWith('Current date/time:')).toBe(true);
    expect(request.systemPrompt).not.toMatch(/Current date\/time: [A-Z][a-z]+day,/);
  });

  it('injects a compact Browser Overview plus task memory into the per-turn context so the model does not need to rediscover tab state', async () => {
    const provider = {
      requests: [] as AgentProviderRequest[],
      async invoke(request: AgentProviderRequest) {
        this.requests.push(request);
        return {
          output: 'ok',
          usage: { inputTokens: 1, outputTokens: 1, durationMs: 1 },
        };
      },
    };

    browserIsReadyMock.mockReturnValue(true);
    browserGetActiveTabIdMock.mockReturnValue('tab-active');
    browserGetTabsMock.mockReturnValue([
      {
        id: 'tab-active',
        navigation: {
          url: 'https://example.com/pricing',
          title: 'Pricing — Example',
          canGoBack: false,
          canGoForward: false,
          isLoading: false,
          loadingProgress: null,
          favicon: '',
          lastNavigationAt: 500,
        },
        status: 'ready',
        zoomLevel: 0,
        muted: false,
        isAudible: false,
        createdAt: 1,
      },
      {
        id: 'tab-second',
        navigation: {
          url: 'https://example.com/docs',
          title: 'Docs — Example',
          canGoBack: false,
          canGoForward: false,
          isLoading: false,
          loadingProgress: null,
          favicon: '',
          lastNavigationAt: 200,
        },
        status: 'ready',
        zoomLevel: 0,
        muted: false,
        isAudible: false,
        createdAt: 2,
      },
    ]);
    pageKnowledgeListPagesMock.mockReturnValue([
      {
        id: 'page-pricing',
        tabId: 'tab-active',
        url: 'https://example.com/pricing',
        title: 'Pricing page',
        tier: 'readability',
        contentHash: 'hash',
        createdAt: 1,
        updatedAt: 5,
      },
    ]);
    taskMemoryBuildContextMock.mockReturnValue('## Task Memory\n### History\nBrowser: Pricing page cached');

    const runtime = new AgentRuntime(provider);
    await runtime.run({
      mode: 'unrestricted-dev',
      agentId: PRIMARY_PROVIDER_ID,
      role: 'primary',
      task: 'Summarise pricing.',
      taskId: 'task-browser-overview',
      allowedTools: [],
      canSpawnSubagents: false,
    });

    const request = provider.requests[0];
    expect(request.contextPrompt).toBeTruthy();
    expect(request.contextPrompt).toContain('## Browser Overview');
    expect(request.contextPrompt).toContain('tab-active');
    expect(request.contextPrompt).toContain('tab-second');
    expect(request.contextPrompt).toContain('Pricing — Example');
    expect(request.contextPrompt).toContain('page-pricing');
    expect(request.contextPrompt).toContain('## Task Memory');
    expect(taskMemoryBuildContextMock).toHaveBeenCalledWith('task-browser-overview');
  });

  it('omits the Browser Overview section when the browser surface is not initialised', async () => {
    const provider = {
      requests: [] as AgentProviderRequest[],
      async invoke(request: AgentProviderRequest) {
        this.requests.push(request);
        return { output: 'ok', usage: { inputTokens: 1, outputTokens: 1, durationMs: 1 } };
      },
    };

    browserIsReadyMock.mockReturnValue(false);

    const runtime = new AgentRuntime(provider);
    await runtime.run({
      mode: 'unrestricted-dev',
      agentId: PRIMARY_PROVIDER_ID,
      role: 'primary',
      task: 'Just a question.',
      taskId: 'task-no-browser',
      allowedTools: [],
      canSpawnSubagents: false,
    });

    const request = provider.requests[0];
    expect(request.contextPrompt).not.toContain('## Browser Overview');
  });

  it('hard-fails browser tasks when the initial tool scope exposes no browser tools', () => {
    expect(() => assertInitialBrowserScope(
      'Close out the browser tabs except the active one.',
      ['filesystem.read', 'terminal.exec'],
    )).toThrow('Browser task blocked: initial MCP tool scope for browser-automation did not expose any browser.* tools.');
  });

  it('serializes tool payloads without pretty-print whitespace', async () => {
    const tool: AgentToolDefinition = {
      name: 'browser.extract_page',
      description: 'Extract and structure page content using an optional CSS selector or extraction strategy.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          strategy: { type: 'string' },
        },
      },
      execute: async () => ({ summary: 'extracted', data: {} }),
    };

    agentToolExecutor.register(tool);

    let capturedPayload = '';
    const provider = {
      async invoke(request: AgentProviderRequest) {
        capturedPayload = JSON.stringify(request.tools);
        return {
          output: 'ok',
          usage: { inputTokens: 1, outputTokens: 1, durationMs: 1 },
        };
      },
    };

    const runtime = new AgentRuntime(provider);
    await runtime.run({
      mode: 'unrestricted-dev',
      agentId: 'gpt-5.4',
      role: 'primary',
      task: 'Verify tool payload formatting.',
      taskId: 'task-tool-payload-formatting',
      allowedTools: ['browser.extract_page'],
    });

    expect(capturedPayload).toContain('browser.extract_page');
    expect(capturedPayload).not.toContain('\n  ');
  });
});
