"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const { fakeState, dispatchMock, eventEmitMock, ensureWindowMock, browserIsCreatedMock, browserCreateSurfaceMock, browserCreateTabMock, artifactReadContentMock, prewarmMock, chatRecordUserMessageMock, chatRecordAssistantMessageMock, taskRecordUserPromptMock, taskRecordInvocationResultMock, } = vitest_1.vi.hoisted(() => ({
    fakeState: {
        providers: {},
        artifacts: [],
        activeArtifactId: null,
    },
    dispatchMock: vitest_1.vi.fn(),
    eventEmitMock: vitest_1.vi.fn(),
    ensureWindowMock: vitest_1.vi.fn(() => ({ id: 'execution-window' })),
    browserIsCreatedMock: vitest_1.vi.fn(() => true),
    browserCreateSurfaceMock: vitest_1.vi.fn(),
    browserCreateTabMock: vitest_1.vi.fn(),
    artifactReadContentMock: vitest_1.vi.fn(() => ({ content: '# Existing artifact\n' })),
    prewarmMock: vitest_1.vi.fn(async () => undefined),
    chatRecordUserMessageMock: vitest_1.vi.fn(() => ({ id: 'user-msg-1' })),
    chatRecordAssistantMessageMock: vitest_1.vi.fn(),
    taskRecordUserPromptMock: vitest_1.vi.fn(),
    taskRecordInvocationResultMock: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('electron', () => ({
    app: {
        getPath: () => '/tmp',
    },
    BrowserWindow: {
        getAllWindows: () => [],
    },
}));
vitest_1.vi.mock('../state/appStateStore', () => ({
    appStateStore: {
        getState: () => fakeState,
        dispatch: dispatchMock,
    },
}));
vitest_1.vi.mock('../events/eventBus', () => ({
    eventBus: {
        emit: eventEmitMock,
    },
}));
vitest_1.vi.mock('../artifacts/ArtifactService', () => ({
    artifactService: {
        readContent: artifactReadContentMock,
    },
}));
vitest_1.vi.mock('../browser/BrowserService', () => ({
    browserService: {
        isCreated: browserIsCreatedMock,
        createSurface: browserCreateSurfaceMock,
        createTab: browserCreateTabMock,
    },
}));
vitest_1.vi.mock('../windows/windowManager', () => ({
    ensureWindow: ensureWindowMock,
}));
vitest_1.vi.mock('./CodexProvider', () => ({
    CodexProvider: class MockCodexProvider {
        static isAvailable() {
            return { available: true };
        }
    },
}));
vitest_1.vi.mock('./AppServerBackedProvider', () => ({
    AppServerBackedProvider: class MockAppServerBackedProvider {
        supportsAppToolExecutor = true;
        modelId = 'gpt-5.4';
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
vitest_1.vi.mock('./HaikuProvider', () => ({
    HaikuProvider: class MockHaikuProvider {
        supportsAppToolExecutor = true;
        modelId = 'haiku';
        async invoke() {
            return {
                output: 'unused',
                usage: { inputTokens: 0, outputTokens: 0, durationMs: 0 },
            };
        }
    },
}));
vitest_1.vi.mock('../chatKnowledge/ChatKnowledgeStore', () => ({
    chatKnowledgeStore: {
        recordUserMessage: chatRecordUserMessageMock,
        recordAssistantMessage: chatRecordAssistantMessageMock,
        threadSummary: () => null,
        buildInvocationContext: () => null,
        readLast: () => ({ text: '', messages: [], tokenEstimate: 0, truncated: false }),
    },
}));
vitest_1.vi.mock('../models/taskMemoryStore', () => ({
    taskMemoryStore: {
        hasEntries: () => false,
        get: () => ({ entries: [] }),
        buildContext: () => null,
        recordUserPrompt: taskRecordUserPromptMock,
        recordInvocationResult: taskRecordInvocationResultMock,
    },
}));
vitest_1.vi.mock('../fileKnowledge/FileKnowledgeStore', () => ({
    fileKnowledgeStore: {
        getStats: () => ({ fileCount: 0, chunkCount: 0, indexedAt: null }),
    },
}));
const AgentRuntime_1 = require("./AgentRuntime");
const AgentModelService_1 = require("./AgentModelService");
const researchGrounding = __importStar(require("./researchGrounding"));
(0, vitest_1.describe)('AgentModelService Phase 6.5 runtime hardening', () => {
    (0, vitest_1.beforeEach)(() => {
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
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.restoreAllMocks();
    });
    (0, vitest_1.it)('keeps browser research tools available for research prompts without pre-running grounded research', async () => {
        const runSpy = vitest_1.vi.spyOn(AgentRuntime_1.AgentRuntime.prototype, 'run').mockResolvedValue({
            output: 'ok',
            usage: { inputTokens: 1, outputTokens: 1, durationMs: 1 },
            codexItems: [],
        });
        const groundingSpy = vitest_1.vi.spyOn(researchGrounding, 'runGroundedResearchPipeline');
        const service = new AgentModelService_1.AgentModelService();
        service.init();
        await service.invoke('task-grounded-report', 'Create a new report using only current web sources with at least 3 sources with links.');
        const runtimeConfig = runSpy.mock.calls[0]?.[0];
        (0, vitest_1.expect)(runtimeConfig.allowedTools).toEqual(vitest_1.expect.arrayContaining([
            'browser.research_search',
            'browser.search_page_cache',
            'browser.read_cached_chunk',
        ]));
        (0, vitest_1.expect)(groundingSpy).not.toHaveBeenCalled();
        (0, vitest_1.expect)(runtimeConfig.requiresGroundedResearchHydration).toBe(false);
    });
    (0, vitest_1.it)('keeps artifact update prompts in-process without auto-grounding browser research first', async () => {
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
        const runSpy = vitest_1.vi.spyOn(AgentRuntime_1.AgentRuntime.prototype, 'run').mockResolvedValue({
            output: 'ok',
            usage: { inputTokens: 1, outputTokens: 1, durationMs: 1 },
            codexItems: [],
        });
        const groundingSpy = vitest_1.vi.spyOn(researchGrounding, 'runGroundedResearchPipeline');
        const service = new AgentModelService_1.AgentModelService();
        service.init();
        await service.invoke('task-grounded-update', 'Update this report using only current web sources with links and remove unverifiable claims.');
        const runtimeConfig = runSpy.mock.calls.at(-1)?.[0];
        (0, vitest_1.expect)(runtimeConfig).toBeTruthy();
        (0, vitest_1.expect)(runtimeConfig.allowedTools).toEqual(vitest_1.expect.arrayContaining([
            'browser.research_search',
            'browser.search_page_cache',
            'browser.read_cached_chunk',
            'artifact.read',
        ]));
        (0, vitest_1.expect)(groundingSpy).not.toHaveBeenCalled();
        (0, vitest_1.expect)(runtimeConfig.requiresGroundedResearchHydration).toBe(false);
    });
    (0, vitest_1.it)('does not add unnecessary research tools to normal non-grounded implementation work', async () => {
        const runSpy = vitest_1.vi.spyOn(AgentRuntime_1.AgentRuntime.prototype, 'run').mockResolvedValue({
            output: 'ok',
            usage: { inputTokens: 1, outputTokens: 1, durationMs: 1 },
            codexItems: [],
        });
        const groundingSpy = vitest_1.vi.spyOn(researchGrounding, 'runGroundedResearchPipeline');
        const service = new AgentModelService_1.AgentModelService();
        service.init();
        await service.invoke('task-impl', 'Patch this TypeScript file and run the local build.');
        const runtimeConfig = runSpy.mock.calls.at(-1)?.[0];
        (0, vitest_1.expect)(runtimeConfig).toBeTruthy();
        (0, vitest_1.expect)(groundingSpy).not.toHaveBeenCalled();
        (0, vitest_1.expect)(runtimeConfig.allowedTools).toEqual(vitest_1.expect.arrayContaining([
            'filesystem.read',
            'filesystem.patch',
            'terminal.exec',
        ]));
        (0, vitest_1.expect)(runtimeConfig.allowedTools).not.toEqual(vitest_1.expect.arrayContaining([
            'browser.research_search',
            'browser.search_page_cache',
            'browser.read_cached_chunk',
        ]));
    });
    (0, vitest_1.it)('does not initialize the browser surface from keyword-driven research prompts alone', async () => {
        vitest_1.vi.spyOn(AgentRuntime_1.AgentRuntime.prototype, 'run').mockResolvedValue({
            output: 'ok',
            usage: { inputTokens: 1, outputTokens: 1, durationMs: 1 },
            codexItems: [],
        });
        const groundingSpy = vitest_1.vi.spyOn(researchGrounding, 'runGroundedResearchPipeline');
        const service = new AgentModelService_1.AgentModelService();
        service.init();
        await service.invoke('task-browser-ready', 'Create a report using only current web sources with links.');
        (0, vitest_1.expect)(ensureWindowMock).not.toHaveBeenCalled();
        (0, vitest_1.expect)(browserCreateSurfaceMock).not.toHaveBeenCalled();
        (0, vitest_1.expect)(groundingSpy).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('does not auto-open a browser search tab from the raw user prompt for research tasks', async () => {
        vitest_1.vi.spyOn(AgentRuntime_1.AgentRuntime.prototype, 'run').mockResolvedValue({
            output: 'ok',
            usage: { inputTokens: 1, outputTokens: 1, durationMs: 1 },
            codexItems: [],
        });
        const service = new AgentModelService_1.AgentModelService();
        service.init();
        await service.invoke('task-no-auto-search', 'Find current pricing for browser automation tools and compare the top options.');
        (0, vitest_1.expect)(browserCreateTabMock).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=AgentModelService.phase65.test.js.map