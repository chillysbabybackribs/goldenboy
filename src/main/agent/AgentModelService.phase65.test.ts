import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  fakeState,
  dispatchMock,
  eventEmitMock,
  ensureWindowMock,
  browserIsCreatedMock,
  browserCreateSurfaceMock,
  browserCreateTabMock,
  artifactReadContentMock,
  prewarmMock,
  codexProviderConstructMock,
  appServerProviderConstructMock,
  chatRecordUserMessageMock,
  chatRecordAssistantMessageMock,
  taskRecordUserPromptMock,
  taskRecordInvocationResultMock,
} = vi.hoisted(() => ({
  fakeState: {
    providers: {},
    artifacts: [],
    activeArtifactId: null,
  } as {
    providers: Record<string, unknown>;
    artifacts: Array<Record<string, unknown>>;
    activeArtifactId: string | null;
  },
  dispatchMock: vi.fn(),
  eventEmitMock: vi.fn(),
  ensureWindowMock: vi.fn(() => ({ id: 'execution-window' })),
  browserIsCreatedMock: vi.fn(() => true),
  browserCreateSurfaceMock: vi.fn(),
  browserCreateTabMock: vi.fn(),
  artifactReadContentMock: vi.fn(() => ({ content: '# Existing artifact\n' })),
  prewarmMock: vi.fn(async () => undefined),
  codexProviderConstructMock: vi.fn(),
  appServerProviderConstructMock: vi.fn(),
  chatRecordUserMessageMock: vi.fn(() => ({ id: 'user-msg-1' })),
  chatRecordAssistantMessageMock: vi.fn(),
  taskRecordUserPromptMock: vi.fn(),
  taskRecordInvocationResultMock: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

vi.mock('../state/appStateStore', () => ({
  appStateStore: {
    getState: () => fakeState,
    dispatch: dispatchMock,
  },
}));

vi.mock('../events/eventBus', () => ({
  eventBus: {
    emit: eventEmitMock,
    on: vi.fn(),
  },
}));

vi.mock('../artifacts/ArtifactService', () => ({
  artifactService: {
    readContent: artifactReadContentMock,
  },
}));

vi.mock('../browser/BrowserService', () => ({
  browserService: {
    isCreated: browserIsCreatedMock,
    createSurface: browserCreateSurfaceMock,
    createTab: browserCreateTabMock,
  },
}));

vi.mock('../windows/windowManager', () => ({
  ensureWindow: ensureWindowMock,
}));

vi.mock('./CodexProvider', () => ({
  CodexProvider: class MockCodexProvider {
    constructor() {
      codexProviderConstructMock();
    }

    static isAvailable() {
      return { available: true };
    }
  },
}));

vi.mock('./AppServerBackedProvider', () => ({
  AppServerBackedProvider: class MockAppServerBackedProvider {
    readonly supportsAppToolExecutor = true;
    readonly modelId = 'gpt-5.4';

    constructor() {
      appServerProviderConstructMock();
    }

    async prewarm() {
      await prewarmMock();
    }

    async invoke() {
      return {
        output: 'unused',
        usage: { inputTokens: 0, outputTokens: 0, durationMs: 0 },
      };
    }
  },
}));

vi.mock('./HaikuProvider', () => ({
  HaikuProvider: class MockHaikuProvider {
    readonly supportsAppToolExecutor = true;
    readonly modelId = 'haiku';

    async invoke() {
      return {
        output: 'unused',
        usage: { inputTokens: 0, outputTokens: 0, durationMs: 0 },
      };
    }
  },
}));

vi.mock('../chatKnowledge/ChatKnowledgeStore', () => ({
  chatKnowledgeStore: {
    recordUserMessage: chatRecordUserMessageMock,
    recordAssistantMessage: chatRecordAssistantMessageMock,
    threadSummary: () => null,
    buildInvocationContext: () => null,
    readLast: () => ({ text: '', messages: [], tokenEstimate: 0, truncated: false }),
  },
}));

vi.mock('../models/taskMemoryStore', () => ({
  taskMemoryStore: {
    hasEntries: () => false,
    get: () => ({ entries: [] }),
    buildContext: () => null,
    recordUserPrompt: taskRecordUserPromptMock,
    recordInvocationResult: taskRecordInvocationResultMock,
  },
}));

vi.mock('../fileKnowledge/FileKnowledgeStore', () => ({
  fileKnowledgeStore: {
    getStats: () => ({ fileCount: 0, chunkCount: 0, indexedAt: null }),
  },
}));

import { AgentRuntime } from './AgentRuntime';
import { AgentModelService } from './AgentModelService';
import * as researchGrounding from './researchGrounding';

describe('AgentModelService Phase 6.5 runtime hardening', () => {
  beforeEach(() => {
    dispatchMock.mockReset();
    eventEmitMock.mockReset();
    ensureWindowMock.mockClear();
    browserIsCreatedMock.mockReset();
    browserIsCreatedMock.mockReturnValue(true);
    browserCreateSurfaceMock.mockReset();
    browserCreateTabMock.mockReset();
    artifactReadContentMock.mockClear();
    prewarmMock.mockClear();
    codexProviderConstructMock.mockClear();
    appServerProviderConstructMock.mockClear();
    chatRecordUserMessageMock.mockClear();
    chatRecordAssistantMessageMock.mockClear();
    taskRecordUserPromptMock.mockClear();
    taskRecordInvocationResultMock.mockClear();
    fakeState.providers = {};
    fakeState.artifacts = [];
    fakeState.activeArtifactId = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps browser research tools available for research prompts without pre-running grounded research', async () => {
    const runSpy = vi.spyOn(AgentRuntime.prototype, 'run').mockResolvedValue({
      output: 'ok',
      usage: { inputTokens: 1, outputTokens: 1, durationMs: 1 },
      codexItems: [],
    });
    const groundingSpy = vi.spyOn(researchGrounding, 'runGroundedResearchPipeline');

    const service = new AgentModelService();
    service.init();

    await service.invoke(
      'task-grounded-report',
      'Create a new report using only current web sources with at least 3 sources with links.',
      undefined,
      { taskProfile: { canSpawnSubagents: false } },
    );

    const runtimeConfig = runSpy.mock.calls[0]?.[0];
    expect(runtimeConfig.allowedTools).toEqual(expect.arrayContaining([
      'browser.research_search',
      'browser.search_page_cache',
      'browser.read_cached_chunk',
    ]));
    expect(groundingSpy).not.toHaveBeenCalled();
    expect(runtimeConfig.requiresGroundedResearchHydration).toBe(false);
  });

  it('does not prewarm the primary app-server session during init', () => {
    const service = new AgentModelService();

    service.init();

    expect(prewarmMock).not.toHaveBeenCalled();
  });

  it('uses app-server for both implementation and research by default when selecting the primary provider backend', () => {
    const service = new AgentModelService();
    service.init();

    (service as any).createProviderInstance('gpt-5.4', 'implementation');
    (service as any).createProviderInstance('gpt-5.4', 'research');

    expect(codexProviderConstructMock).not.toHaveBeenCalled();
    expect(appServerProviderConstructMock).toHaveBeenCalledTimes(1);
  });

  it('keeps artifact update prompts in-process without auto-grounding browser research first', async () => {
    fakeState.artifacts = [{
      id: 'artifact-1',
      title: 'Weekly Research Note',
      format: 'md',
      status: 'ready',
      updatedAt: Date.now(),
      createdAt: Date.now(),
      createdBy: 'user',
      lastUpdatedBy: 'user',
      linkedTaskIds: [],
      previewable: true,
      exportable: true,
      archived: false,
    }];
    fakeState.activeArtifactId = 'artifact-1';

    const runSpy = vi.spyOn(AgentRuntime.prototype, 'run').mockResolvedValue({
      output: 'ok',
      usage: { inputTokens: 1, outputTokens: 1, durationMs: 1 },
      codexItems: [],
    });
    const groundingSpy = vi.spyOn(researchGrounding, 'runGroundedResearchPipeline');

    const service = new AgentModelService();
    service.init();

    await service.invoke(
      'task-grounded-update',
      'Update this report using only current web sources with links and remove unverifiable claims.',
      undefined,
      { taskProfile: { canSpawnSubagents: false } },
    );

    const runtimeConfig = runSpy.mock.calls.at(-1)?.[0];
    expect(runtimeConfig).toBeTruthy();
    expect(runtimeConfig.allowedTools).toEqual(expect.arrayContaining([
      'browser.research_search',
      'browser.search_page_cache',
      'browser.read_cached_chunk',
      'artifact.read',
    ]));
    expect(groundingSpy).not.toHaveBeenCalled();
    expect(runtimeConfig.requiresGroundedResearchHydration).toBe(false);
  });

  it('does not add unnecessary research tools to normal non-grounded implementation work', async () => {
    const runSpy = vi.spyOn(AgentRuntime.prototype, 'run').mockResolvedValue({
      output: 'ok',
      usage: { inputTokens: 1, outputTokens: 1, durationMs: 1 },
      codexItems: [],
    });
    const groundingSpy = vi.spyOn(researchGrounding, 'runGroundedResearchPipeline');

    const service = new AgentModelService();
    service.init();

    await service.invoke('task-impl', 'Patch this TypeScript file and run the local build.', undefined, {
      taskProfile: { canSpawnSubagents: false },
    });

    const runtimeConfig = runSpy.mock.calls.at(-1)?.[0];
    expect(runtimeConfig).toBeTruthy();
    expect(groundingSpy).not.toHaveBeenCalled();
    expect(runtimeConfig.allowedTools).toEqual(expect.arrayContaining([
      'filesystem.read',
      'filesystem.patch',
      'terminal.exec',
    ]));
    expect(runtimeConfig.allowedTools).not.toEqual(expect.arrayContaining([
      'browser.research_search',
      'browser.search_page_cache',
      'browser.read_cached_chunk',
    ]));
  });

  it('does not initialize the browser surface from keyword-driven research prompts alone', async () => {
    vi.spyOn(AgentRuntime.prototype, 'run').mockResolvedValue({
      output: 'ok',
      usage: { inputTokens: 1, outputTokens: 1, durationMs: 1 },
      codexItems: [],
    });
    const groundingSpy = vi.spyOn(researchGrounding, 'runGroundedResearchPipeline');

    const service = new AgentModelService();
    service.init();

    await service.invoke(
      'task-browser-ready',
      'Create a report using only current web sources with links.',
      undefined,
      { taskProfile: { canSpawnSubagents: false } },
    );

    expect(ensureWindowMock).not.toHaveBeenCalled();
    expect(browserCreateSurfaceMock).not.toHaveBeenCalled();
    expect(groundingSpy).not.toHaveBeenCalled();
  });

  it('does not auto-open a browser search tab from the raw user prompt for research tasks', async () => {
    vi.spyOn(AgentRuntime.prototype, 'run').mockResolvedValue({
      output: 'ok',
      usage: { inputTokens: 1, outputTokens: 1, durationMs: 1 },
      codexItems: [],
    });

    const service = new AgentModelService();
    service.init();

    await service.invoke(
      'task-no-auto-search',
      'Find current pricing for browser automation tools and compare the top options.',
      undefined,
      { taskProfile: { canSpawnSubagents: false } },
    );

    expect(browserCreateTabMock).not.toHaveBeenCalled();
  });

  it('asks before inferred subagent work instead of delegating immediately', async () => {
    const runSpy = vi.spyOn(AgentRuntime.prototype, 'run').mockResolvedValue({
      output: 'ok',
      usage: { inputTokens: 1, outputTokens: 1, durationMs: 1 },
      codexItems: [],
    });

    const service = new AgentModelService();
    service.init();

    const result = await service.invoke(
      'task-subagent-confirm',
      'Plan a migration strategy for the repository with rollout phases, risks, and coordination steps.',
    );

    expect(runSpy).not.toHaveBeenCalled();
    expect(result.output).toContain('Do you want me to run subagents?');
    expect(chatRecordAssistantMessageMock).toHaveBeenCalledWith(
      'task-subagent-confirm',
      expect.stringContaining('Do you want me to run subagents?'),
      'gpt-5.4',
    );
  });

  it('runs the original task with subagents after the user approves', async () => {
    const runSpy = vi.spyOn(AgentRuntime.prototype, 'run').mockResolvedValue({
      output: 'delegated ok',
      usage: { inputTokens: 2, outputTokens: 3, durationMs: 4 },
      codexItems: [],
    });
    const documentAttachment = {
      type: 'document' as const,
      id: 'doc-1',
      name: 'migration-plan.md',
      mediaType: 'text/markdown',
      sizeBytes: 128,
      status: 'indexed' as const,
      chunkCount: 3,
      tokenEstimate: 42,
      language: 'markdown',
    };

    const service = new AgentModelService();
    service.init();

    await service.invoke(
      'task-subagent-approve',
      'Plan a migration strategy for the repository with rollout phases, risks, and coordination steps.',
      undefined,
      { attachments: [documentAttachment] },
    );

    expect(runSpy).not.toHaveBeenCalled();

    await service.invoke('task-subagent-approve', 'yes');

    expect(runSpy).toHaveBeenCalledTimes(1);
    const runtimeConfig = runSpy.mock.calls[0]?.[0];
    expect(runtimeConfig).toBeTruthy();
    expect(runtimeConfig!.task).toBe('Plan a migration strategy for the repository with rollout phases, risks, and coordination steps.');
    expect(runtimeConfig!.canSpawnSubagents).toBe(true);
    expect(runtimeConfig!.attachments).toEqual([documentAttachment]);
  });

  it('runs the original task without subagents after the user declines', async () => {
    const runSpy = vi.spyOn(AgentRuntime.prototype, 'run').mockResolvedValue({
      output: 'single-agent ok',
      usage: { inputTokens: 2, outputTokens: 3, durationMs: 4 },
      codexItems: [],
    });

    const service = new AgentModelService();
    service.init();

    await service.invoke(
      'task-subagent-deny',
      'Plan a migration strategy for the repository with rollout phases, risks, and coordination steps.',
    );

    expect(runSpy).not.toHaveBeenCalled();

    await service.invoke('task-subagent-deny', 'no thanks');

    expect(runSpy).toHaveBeenCalledTimes(1);
    const runtimeConfig = runSpy.mock.calls[0]?.[0];
    expect(runtimeConfig).toBeTruthy();
    expect(runtimeConfig!.task).toBe('Plan a migration strategy for the repository with rollout phases, risks, and coordination steps.');
    expect(runtimeConfig!.canSpawnSubagents).toBe(false);
    expect(runtimeConfig!.systemPromptAddendum).toContain('The user declined subagents for this task.');
  });

  it('does not ask again when the user explicitly requests subagents', async () => {
    const runSpy = vi.spyOn(AgentRuntime.prototype, 'run').mockResolvedValue({
      output: 'explicit delegation ok',
      usage: { inputTokens: 1, outputTokens: 1, durationMs: 1 },
      codexItems: [],
    });

    const service = new AgentModelService();
    service.init();

    const result = await service.invoke(
      'task-subagent-explicit',
      'Use subagents to split this migration work across multiple agents and then summarize the plan.',
    );

    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(result.output).toBe('explicit delegation ok');
    expect(chatRecordAssistantMessageMock).not.toHaveBeenCalledWith(
      'task-subagent-explicit',
      expect.stringContaining('Do you want me to run subagents?'),
      'gpt-5.4',
    );
  });
});
