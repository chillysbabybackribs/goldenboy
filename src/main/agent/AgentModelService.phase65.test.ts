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
    static isAvailable() {
      return { available: true };
    }
  },
}));

vi.mock('./AppServerBackedProvider', () => ({
  AppServerBackedProvider: class MockAppServerBackedProvider {
    readonly supportsAppToolExecutor = true;
    readonly modelId = 'gpt-5.4';

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

    await service.invoke('task-impl', 'Patch this TypeScript file and run the local build.');

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
    );

    expect(browserCreateTabMock).not.toHaveBeenCalled();
  });
});
