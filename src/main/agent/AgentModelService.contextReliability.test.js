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
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const vitest_1 = require("vitest");
const { fakeState, dispatchMock, eventEmitMock, eventOnMock, ensureWindowMock, browserIsCreatedMock, browserCreateSurfaceMock, browserCreateTabMock, artifactReadContentMock, prewarmMock, } = vitest_1.vi.hoisted(() => ({
    fakeState: {
        providers: {},
        artifacts: [],
        activeArtifactId: null,
        activeTaskId: null,
        browserRuntime: {
            activeTabId: null,
            tabs: [],
        },
        tasks: [],
    },
    dispatchMock: vitest_1.vi.fn(),
    eventEmitMock: vitest_1.vi.fn(),
    eventOnMock: vitest_1.vi.fn(),
    ensureWindowMock: vitest_1.vi.fn(() => ({ id: 'execution-window' })),
    browserIsCreatedMock: vitest_1.vi.fn(() => true),
    browserCreateSurfaceMock: vitest_1.vi.fn(),
    browserCreateTabMock: vitest_1.vi.fn(),
    artifactReadContentMock: vitest_1.vi.fn(() => ({ content: '# Artifact preview\n' })),
    prewarmMock: vitest_1.vi.fn(async () => undefined),
}));
vitest_1.vi.mock('electron', () => ({
    app: {
        getPath: () => process.env.V2_TEST_USER_DATA || os.tmpdir(),
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
        on: eventOnMock,
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
        getState: () => ({
            activeTabId: 'tab-1',
            navigation: {
                url: 'https://example.com',
                isLoading: false,
            },
        }),
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
                codexItems: [],
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
                codexItems: [],
            };
        }
    },
}));
vitest_1.vi.mock('./researchGrounding', async () => {
    const actual = await vitest_1.vi.importActual('./researchGrounding');
    return {
        ...actual,
        shouldUseGroundedResearchPipeline: () => false,
    };
});
const AgentModelService_1 = require("./AgentModelService");
const AgentRuntime_1 = require("./AgentRuntime");
const ChatKnowledgeStore_1 = require("../chatKnowledge/ChatKnowledgeStore");
const taskMemoryStore_1 = require("../models/taskMemoryStore");
function buildResult(output) {
    return {
        output,
        usage: { inputTokens: 10, outputTokens: 10, durationMs: 1 },
        codexItems: [],
    };
}
function makeTaskId(label) {
    return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function normalizeTaskText(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function contextForTask(runSpy, task) {
    const normalizedTask = normalizeTaskText(task);
    const matched = runSpy.mock.calls.find((call) => {
        const candidate = call[0]?.task;
        if (typeof candidate !== 'string')
            return false;
        const normalizedCandidate = normalizeTaskText(candidate);
        return normalizedCandidate === normalizedTask
            || normalizedCandidate.includes(normalizedTask)
            || normalizedTask.includes(normalizedCandidate);
    })?.[0]?.contextPrompt;
    if (typeof matched === 'string' && matched.trim()) {
        return matched;
    }
    return runSpy.mock.calls
        .map((call) => call[0]?.contextPrompt)
        .filter((value) => typeof value === 'string' && value.trim().length > 0)
        .join('\n\n');
}
function activeArtifact(overrides) {
    return {
        id: 'artifact-1',
        title: 'Launch Brief',
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
        ...overrides,
    };
}
(0, vitest_1.describe)('AgentModelService conversation context reliability', () => {
    let userDataDir = '';
    const createdTaskIds = [];
    (0, vitest_1.beforeEach)(() => {
        userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-context-reliability-'));
        process.env.V2_TEST_USER_DATA = userDataDir;
        createdTaskIds.length = 0;
        dispatchMock.mockReset();
        eventEmitMock.mockReset();
        eventOnMock.mockReset();
        ensureWindowMock.mockClear();
        browserIsCreatedMock.mockReset();
        browserIsCreatedMock.mockReturnValue(true);
        browserCreateSurfaceMock.mockReset();
        browserCreateTabMock.mockReset();
        artifactReadContentMock.mockReset();
        artifactReadContentMock.mockReturnValue({ content: '# Artifact preview\n' });
        prewarmMock.mockClear();
        fakeState.providers = {};
        fakeState.artifacts = [];
        fakeState.activeArtifactId = null;
        fakeState.activeTaskId = null;
        fakeState.browserRuntime = {
            activeTabId: null,
            tabs: [],
        };
        fakeState.tasks = [];
    });
    (0, vitest_1.afterEach)(() => {
        for (const taskId of createdTaskIds) {
            taskMemoryStore_1.taskMemoryStore.clearTask(taskId);
        }
        delete process.env.V2_TEST_USER_DATA;
        fs.rmSync(userDataDir, { recursive: true, force: true });
        vitest_1.vi.restoreAllMocks();
    });
    (0, vitest_1.it)('keeps sequential artifact refinements grounded in the same conversation', async () => {
        const taskId = makeTaskId('sequential-refinement');
        createdTaskIds.push(taskId);
        const runSpy = vitest_1.vi.spyOn(AgentRuntime_1.AgentRuntime.prototype, 'run')
            .mockResolvedValueOnce(buildResult('Created artifact "Launch Brief" with sections 1, 2, and 3.'))
            .mockResolvedValueOnce(buildResult('Section 2 now focuses on rollout risks and owners.'))
            .mockResolvedValueOnce(buildResult('Section 3 removed from the artifact.'))
            .mockResolvedValueOnce(buildResult('Summary: Launch Brief now contains sections 1 and 2 only.'));
        const service = new AgentModelService_1.AgentModelService();
        service.init();
        await service.invoke(taskId, 'Create a markdown artifact with sections 1, 2, and 3.', 'gpt-5.4');
        fakeState.artifacts = [activeArtifact()];
        fakeState.activeArtifactId = 'artifact-1';
        artifactReadContentMock.mockReturnValue({
            content: '# Launch Brief\n\n## 1\nOverview\n\n## 2\nPlan\n\n## 3\nRisks\n',
        });
        await service.invoke(taskId, 'Update section 2 with rollout risks and owners.', 'gpt-5.4');
        artifactReadContentMock.mockReturnValue({
            content: '# Launch Brief\n\n## 1\nOverview\n\n## 2\nRollout risks and owners\n\n## 3\nRisks\n',
        });
        await service.invoke(taskId, 'Remove section 3.', 'gpt-5.4');
        artifactReadContentMock.mockReturnValue({
            content: '# Launch Brief\n\n## 1\nOverview\n\n## 2\nRollout risks and owners\n',
        });
        await service.invoke(taskId, 'Summarize the result.', 'gpt-5.4');
        const secondContext = contextForTask(runSpy, 'Update section 2 with rollout risks and owners.');
        const thirdContext = contextForTask(runSpy, 'Remove section 3.');
        const fourthContext = contextForTask(runSpy, 'Summarize the result.');
        (0, vitest_1.expect)(secondContext).toContain('Earlier, the user said: Create a markdown artifact with sections 1, 2, and 3.');
        (0, vitest_1.expect)(secondContext).toContain('Then, the assistant replied: Created artifact "Launch Brief" with sections 1, 2, and 3.');
        (0, vitest_1.expect)(thirdContext).toContain('Then, the user said: Update section 2 with rollout risks and owners.');
        (0, vitest_1.expect)(thirdContext).toContain('Then, the assistant replied: Section 2 now focuses on rollout risks and owners.');
        (0, vitest_1.expect)(fourthContext).toContain('Then, the user said: Remove section 3.');
        (0, vitest_1.expect)(fourthContext).toContain('Then, the assistant replied: Section 3 removed from the artifact.');
    });
    (0, vitest_1.it)('includes shared ledger continuity when the provider changes on the same task', async () => {
        const taskId = makeTaskId('provider-switch');
        createdTaskIds.push(taskId);
        fakeState.tasks = [{
                id: taskId,
                title: 'Provider Switch Task',
                status: 'queued',
                owner: 'user',
                artifactIds: [],
                createdAt: Date.now(),
                updatedAt: Date.now(),
            }];
        const runSpy = vitest_1.vi.spyOn(AgentRuntime_1.AgentRuntime.prototype, 'run')
            .mockResolvedValueOnce(buildResult('Drafted the initial release checklist.'))
            .mockResolvedValueOnce(buildResult('Added deployment verification steps.'));
        const service = new AgentModelService_1.AgentModelService();
        service.init();
        await service.invoke(taskId, 'Draft the initial release checklist.', 'gpt-5.4');
        await service.invoke(taskId, 'Continue this and add deployment verification steps.', 'haiku');
        const secondContext = contextForTask(runSpy, 'Continue this and add deployment verification steps.');
        (0, vitest_1.expect)(secondContext).toContain('## Shared Runtime Ledger');
        (0, vitest_1.expect)(secondContext).toContain('active model changed to haiku');
        (0, vitest_1.expect)(secondContext).toContain('Latest user request: Draft the initial release checklist.');
        (0, vitest_1.expect)(secondContext).toContain('Latest model result: Drafted the initial release checklist.');
    });
    (0, vitest_1.it)('preserves chained follow-ups across compare, focus, convert, and append steps', async () => {
        const taskId = makeTaskId('context-chain');
        createdTaskIds.push(taskId);
        const runSpy = vitest_1.vi.spyOn(AgentRuntime_1.AgentRuntime.prototype, 'run')
            .mockResolvedValueOnce(buildResult('Comparison: option A is cheaper, option B is faster.'))
            .mockResolvedValueOnce(buildResult('Focus: option B wins on latency and operational simplicity.'))
            .mockResolvedValueOnce(buildResult('option,reason\nB,latency and simplicity'))
            .mockResolvedValueOnce(buildResult('Appended row: B,benchmark confidence'));
        const service = new AgentModelService_1.AgentModelService();
        service.init();
        await service.invoke(taskId, 'Compare option A vs option B.', 'gpt-5.4');
        await service.invoke(taskId, 'Focus only on B.', 'gpt-5.4');
        await service.invoke(taskId, 'Convert that to CSV.', 'gpt-5.4');
        await service.invoke(taskId, 'Append a row for benchmark confidence.', 'gpt-5.4');
        const secondContext = contextForTask(runSpy, 'Focus only on B.');
        const thirdContext = contextForTask(runSpy, 'Convert that to CSV.');
        const fourthContext = contextForTask(runSpy, 'Append a row for benchmark confidence.');
        (0, vitest_1.expect)(secondContext).toContain('Earlier, the user said: Compare option A vs option B.');
        (0, vitest_1.expect)(secondContext).toContain('Then, the assistant replied: Comparison: option A is cheaper, option B is faster.');
        (0, vitest_1.expect)(thirdContext).toContain('Then, the user said: Focus only on B.');
        (0, vitest_1.expect)(thirdContext).toContain('Then, the assistant replied: Focus: option B wins on latency and operational simplicity.');
        (0, vitest_1.expect)(fourthContext).toContain('Then, the user said: Convert that to CSV.');
        (0, vitest_1.expect)(fourthContext).toContain('Then, the assistant replied:\noption,reason');
    });
    (0, vitest_1.it)('hydrates the shared thread context when switching from Codex to Haiku', async () => {
        const taskId = makeTaskId('provider-switch');
        createdTaskIds.push(taskId);
        const runSpy = vitest_1.vi.spyOn(AgentRuntime_1.AgentRuntime.prototype, 'run')
            .mockResolvedValueOnce(buildResult('Draft plan: discovery, migration, rollout.'))
            .mockResolvedValueOnce(buildResult('Rollout phase now includes risks and rollback criteria.'));
        const service = new AgentModelService_1.AgentModelService();
        service.init();
        await service.invoke(taskId, 'Start a rollout plan for the migration.', 'gpt-5.4');
        await service.invoke(taskId, 'Continue this and add risks for rollout.', 'haiku');
        const switchedContext = contextForTask(runSpy, 'Continue this and add risks for rollout.');
        (0, vitest_1.expect)(switchedContext).toContain('The task began with the request: Start a rollout plan for the migration.');
        (0, vitest_1.expect)(switchedContext).toContain('Earlier, the user said: Start a rollout plan for the migration.');
        (0, vitest_1.expect)(switchedContext).toContain('Then, the assistant replied: Draft plan: discovery, migration, rollout.');
    });
    (0, vitest_1.it)('does not auto-hydrate prior thread history on provider switch for a fresh standalone prompt', async () => {
        const taskId = makeTaskId('provider-switch-fresh');
        createdTaskIds.push(taskId);
        const runSpy = vitest_1.vi.spyOn(AgentRuntime_1.AgentRuntime.prototype, 'run')
            .mockResolvedValueOnce(buildResult('Draft plan: discovery, migration, rollout.'))
            .mockResolvedValueOnce(buildResult('One-line note: Thanks for the update.'));
        const service = new AgentModelService_1.AgentModelService();
        service.init();
        await service.invoke(taskId, 'Start a rollout plan for the migration.', 'gpt-5.4');
        await service.invoke(taskId, 'Write a one-line thank-you note.', 'haiku');
        const switchedContext = contextForTask(runSpy, 'Write a one-line thank-you note.');
        (0, vitest_1.expect)(switchedContext).not.toContain('The task began with the request: Start a rollout plan for the migration.');
        (0, vitest_1.expect)(switchedContext).not.toContain('Earlier, the user said: Start a rollout plan for the migration.');
        (0, vitest_1.expect)(switchedContext).not.toContain('Then, the assistant replied: Draft plan: discovery, migration, rollout.');
    });
    (0, vitest_1.it)('hydrates the most recent prior thread when the prompt explicitly asks for the previous chat', async () => {
        const priorTaskId = makeTaskId('previous-chat-source');
        const currentTaskId = makeTaskId('previous-chat-target');
        createdTaskIds.push(priorTaskId, currentTaskId);
        const runSpy = vitest_1.vi.spyOn(AgentRuntime_1.AgentRuntime.prototype, 'run')
            .mockResolvedValueOnce(buildResult('Draft plan: discovery, migration, rollout.'))
            .mockResolvedValueOnce(buildResult('Continued from prior thread.'));
        const service = new AgentModelService_1.AgentModelService();
        service.init();
        await service.invoke(priorTaskId, 'Start a rollout plan for the migration.', 'gpt-5.4');
        fakeState.tasks = [
            {
                id: priorTaskId,
                title: 'Prior chat',
                status: 'completed',
                owner: 'gpt-5.4',
                artifactIds: [],
                createdAt: 100,
                updatedAt: 200,
            },
            {
                id: currentTaskId,
                title: 'Current chat',
                status: 'queued',
                owner: 'user',
                artifactIds: [],
                createdAt: 300,
                updatedAt: 400,
            },
        ];
        await service.invoke(currentTaskId, 'Reference the previous chat and continue the rollout plan.', 'gpt-5.4');
        const recalledContext = contextForTask(runSpy, 'Reference the previous chat and continue the rollout plan.');
        (0, vitest_1.expect)(recalledContext).toContain('## Previous Chat Recall');
        (0, vitest_1.expect)(recalledContext).toContain('Earlier, the user said: Start a rollout plan for the migration.');
        (0, vitest_1.expect)(recalledContext).toContain('Then, the assistant replied: Draft plan: discovery, migration, rollout.');
    });
    (0, vitest_1.it)('keeps long conversations understandable even when tool messages are interleaved', async () => {
        const taskId = makeTaskId('long-conversation');
        createdTaskIds.push(taskId);
        const runSpy = vitest_1.vi.spyOn(AgentRuntime_1.AgentRuntime.prototype, 'run')
            .mockResolvedValueOnce(buildResult('Found vendors Alpha, Beta, and Gamma.'))
            .mockResolvedValueOnce(buildResult('Beta has the strongest reliability profile.'))
            .mockResolvedValueOnce(buildResult('Verified risks for Beta: migration time and contract lock-in.'));
        const service = new AgentModelService_1.AgentModelService();
        service.init();
        await service.invoke(taskId, 'Research three vendors.', 'gpt-5.4');
        ChatKnowledgeStore_1.chatKnowledgeStore.recordToolMessage(taskId, JSON.stringify({
            tool: 'browser.research_search',
            input: { query: 'three vendors' },
            result: { payload: `${'x'.repeat(1200)}VERY_LARGE_TOOL_PAYLOAD` },
        }, null, 2), 'gpt-5.4');
        await service.invoke(taskId, 'Focus on Beta.', 'gpt-5.4');
        ChatKnowledgeStore_1.chatKnowledgeStore.recordToolMessage(taskId, JSON.stringify({
            tool: 'browser.read_cached_chunk',
            input: { pageId: 'beta' },
            result: { payload: `${'y'.repeat(1200)}VERY_LARGE_TOOL_PAYLOAD` },
        }, null, 2), 'gpt-5.4');
        await service.invoke(taskId, 'Continue this and list only verified risks.', 'gpt-5.4');
        const continuationContext = contextForTask(runSpy, 'Continue this and list only verified risks.');
        (0, vitest_1.expect)(continuationContext).toContain('Earlier, the user said: Research three vendors.');
        (0, vitest_1.expect)(continuationContext).toContain('Then, the assistant replied: Found vendors Alpha, Beta, and Gamma.');
        (0, vitest_1.expect)(continuationContext).toContain('Then, the user said: Focus on Beta.');
        (0, vitest_1.expect)(continuationContext).toContain('Then, the assistant replied: Beta has the strongest reliability profile.');
        (0, vitest_1.expect)(continuationContext).not.toContain('VERY_LARGE_TOOL_PAYLOAD');
    });
    (0, vitest_1.it)('includes both active artifact state and prior assistant output when follow-ups say "this"', async () => {
        const taskId = makeTaskId('artifact-overlap');
        createdTaskIds.push(taskId);
        const runSpy = vitest_1.vi.spyOn(AgentRuntime_1.AgentRuntime.prototype, 'run')
            .mockResolvedValueOnce(buildResult('The budget tradeoff is cost versus reliability.'))
            .mockResolvedValueOnce(buildResult('Converted the budget tradeoff into CSV format.'));
        const service = new AgentModelService_1.AgentModelService();
        service.init();
        fakeState.artifacts = [activeArtifact({
                title: 'Budget Sheet',
                format: 'csv',
            })];
        fakeState.activeArtifactId = 'artifact-1';
        artifactReadContentMock.mockReturnValue({
            content: 'category,cost,reliability\ncurrent,low,medium\n',
        });
        await service.invoke(taskId, 'Explain the budget tradeoffs briefly.', 'gpt-5.4');
        await service.invoke(taskId, 'Update this to CSV.', 'gpt-5.4');
        const overlapContext = contextForTask(runSpy, 'Update this to CSV.');
        (0, vitest_1.expect)(overlapContext).toContain('Then, the assistant replied: The budget tradeoff is cost versus reliability.');
        (0, vitest_1.expect)(overlapContext).toContain('Active artifact: Budget Sheet [id=artifact-1] (csv');
        (0, vitest_1.expect)(overlapContext).toContain('Use artifact.get_active to resolve requests like "update this document"');
    });
    (0, vitest_1.it)('resolves affirmative follow-ups against the latest assistant proposal', async () => {
        const taskId = makeTaskId('affirmative-followup');
        createdTaskIds.push(taskId);
        const runSpy = vitest_1.vi.spyOn(AgentRuntime_1.AgentRuntime.prototype, 'run')
            .mockResolvedValueOnce(buildResult('I can install pnpm and update PATH for you. Would you like me to do that?'))
            .mockResolvedValueOnce(buildResult('Installed pnpm and updated PATH.'));
        const service = new AgentModelService_1.AgentModelService();
        service.init();
        await service.invoke(taskId, 'My shell cannot find pnpm.', 'gpt-5.4');
        await service.invoke(taskId, 'go ahead', 'haiku');
        const followUpContext = contextForTask(runSpy, 'go ahead');
        (0, vitest_1.expect)(followUpContext).toContain('## Follow-Up Resolution');
        (0, vitest_1.expect)(followUpContext).toContain('Latest prior assistant message:');
        (0, vitest_1.expect)(followUpContext).toContain('I can install pnpm and update PATH for you. Would you like me to do that?');
        (0, vitest_1.expect)(followUpContext).toContain('Treat this as approval to carry out the most recent concrete assistant proposal');
    });
    (0, vitest_1.it)('resolves pronoun-only follow-ups against the latest identified fix target', async () => {
        const taskId = makeTaskId('pronoun-followup');
        createdTaskIds.push(taskId);
        const runSpy = vitest_1.vi.spyOn(AgentRuntime_1.AgentRuntime.prototype, 'run')
            .mockResolvedValueOnce(buildResult('The failure is coming from a missing PATH export in your shell profile. I can help you fix this.'))
            .mockResolvedValueOnce(buildResult('Updated the shell profile to export PATH.'));
        const service = new AgentModelService_1.AgentModelService();
        service.init();
        await service.invoke(taskId, 'Why does pnpm fail in this terminal?', 'gpt-5.4');
        await service.invoke(taskId, 'help me fix this', 'haiku');
        const followUpContext = contextForTask(runSpy, 'help me fix this');
        (0, vitest_1.expect)(followUpContext).toContain('## Follow-Up Resolution');
        (0, vitest_1.expect)(followUpContext).toContain('Latest prior assistant message:');
        (0, vitest_1.expect)(followUpContext).toContain('missing PATH export in your shell profile');
        (0, vitest_1.expect)(followUpContext).toContain('Treat references like "it", "this", or "that" as pointing to the most recent concrete assistant proposal');
    });
});
//# sourceMappingURL=AgentModelService.contextReliability.test.js.map