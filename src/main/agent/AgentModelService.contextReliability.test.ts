import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  fakeState,
  dispatchMock,
  eventEmitMock,
  eventOnMock,
  ensureWindowMock,
  browserIsCreatedMock,
  browserCreateSurfaceMock,
  browserCreateTabMock,
  artifactReadContentMock,
  prewarmMock,
} = vi.hoisted(() => ({
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
  } as {
    providers: Record<string, unknown>;
    artifacts: Array<Record<string, unknown>>;
    activeArtifactId: string | null;
    activeTaskId: string | null;
    browserRuntime: {
      activeTabId: string | null;
      tabs: Array<Record<string, unknown>>;
    };
    tasks: Array<Record<string, unknown>>;
  },
  dispatchMock: vi.fn(),
  eventEmitMock: vi.fn(),
  eventOnMock: vi.fn(),
  ensureWindowMock: vi.fn(() => ({ id: 'execution-window' })),
  browserIsCreatedMock: vi.fn(() => true),
  browserCreateSurfaceMock: vi.fn(),
  browserCreateTabMock: vi.fn(),
  artifactReadContentMock: vi.fn(() => ({ content: '# Artifact preview\n' })),
  prewarmMock: vi.fn(async () => undefined),
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => process.env.V2_TEST_USER_DATA || os.tmpdir(),
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
    on: eventOnMock,
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
    getState: () => ({
      activeTabId: 'tab-1',
      navigation: {
        url: 'https://example.com',
        isLoading: false,
      },
    }),
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
        codexItems: [],
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
        codexItems: [],
      };
    }
  },
}));

vi.mock('./researchGrounding', async () => {
  const actual = await vi.importActual<typeof import('./researchGrounding')>('./researchGrounding');
  return {
    ...actual,
    shouldUseGroundedResearchPipeline: () => false,
  };
});

import { AgentModelService } from './AgentModelService';
import { AgentRuntime } from './AgentRuntime';
import { chatKnowledgeStore } from '../chatKnowledge/ChatKnowledgeStore';
import { taskMemoryStore } from '../models/taskMemoryStore';

type RuntimeResult = {
  output: string;
  usage: { inputTokens: number; outputTokens: number; durationMs: number };
  codexItems: [];
};

function buildResult(output: string): RuntimeResult {
  return {
    output,
    usage: { inputTokens: 10, outputTokens: 10, durationMs: 1 },
    codexItems: [],
  };
}

function makeTaskId(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeTaskText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function contextForTask(runSpy: ReturnType<typeof vi.spyOn>, task: string): string {
  const normalizedTask = normalizeTaskText(task);
  const matched = runSpy.mock.calls.find((call) => {
    const candidate = call[0]?.task;
    if (typeof candidate !== 'string') return false;
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
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n\n');
}

function activeArtifact(overrides?: Partial<Record<string, unknown>>) {
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

function invokeWithoutSubagents(
  service: AgentModelService,
  taskId: string,
  prompt: string,
  owner?: string,
  options?: Parameters<typeof service.invoke>[3],
) {
  return service.invoke(taskId, prompt, owner, {
    taskProfile: { canSpawnSubagents: false, ...options?.taskProfile },
    ...options,
  });
}

describe('AgentModelService conversation context reliability', () => {
  let userDataDir = '';
  const createdTaskIds: string[] = [];

  beforeEach(() => {
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

  afterEach(() => {
    for (const taskId of createdTaskIds) {
      taskMemoryStore.clearTask(taskId);
    }
    delete process.env.V2_TEST_USER_DATA;
    fs.rmSync(userDataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('keeps sequential artifact refinements grounded in the same conversation', async () => {
    const taskId = makeTaskId('sequential-refinement');
    createdTaskIds.push(taskId);
    const runSpy = vi.spyOn(AgentRuntime.prototype, 'run')
      .mockResolvedValueOnce(buildResult('Created artifact "Launch Brief" with sections 1, 2, and 3.'))
      .mockResolvedValueOnce(buildResult('Section 2 now focuses on rollout risks and owners.'))
      .mockResolvedValueOnce(buildResult('Section 3 removed from the artifact.'))
      .mockResolvedValueOnce(buildResult('Summary: Launch Brief now contains sections 1 and 2 only.'));

    const service = new AgentModelService();
    service.init();

    await invokeWithoutSubagents(service, taskId, 'Create a markdown artifact with sections 1, 2, and 3.', 'gpt-5.4');

    fakeState.artifacts = [activeArtifact()];
    fakeState.activeArtifactId = 'artifact-1';
    artifactReadContentMock.mockReturnValue({
      content: '# Launch Brief\n\n## 1\nOverview\n\n## 2\nPlan\n\n## 3\nRisks\n',
    });
    await invokeWithoutSubagents(service, taskId, 'Update section 2 with rollout risks and owners.', 'gpt-5.4');

    artifactReadContentMock.mockReturnValue({
      content: '# Launch Brief\n\n## 1\nOverview\n\n## 2\nRollout risks and owners\n\n## 3\nRisks\n',
    });
    await invokeWithoutSubagents(service, taskId, 'Remove section 3.', 'gpt-5.4');

    artifactReadContentMock.mockReturnValue({
      content: '# Launch Brief\n\n## 1\nOverview\n\n## 2\nRollout risks and owners\n',
    });
    await invokeWithoutSubagents(service, taskId, 'Summarize the result.', 'gpt-5.4');

    const secondContext = contextForTask(runSpy, 'Update section 2 with rollout risks and owners.');
    const thirdContext = contextForTask(runSpy, 'Remove section 3.');
    const fourthContext = contextForTask(runSpy, 'Summarize the result.');

    expect(secondContext).toContain('Earlier, the user said: Create a markdown artifact with sections 1, 2, and 3.');
    expect(secondContext).toContain('Then, the assistant replied: Created artifact "Launch Brief" with sections 1, 2, and 3.');
    expect(thirdContext).toContain('Then, the user said: Update section 2 with rollout risks and owners.');
    expect(thirdContext).toContain('Then, the assistant replied: Section 2 now focuses on rollout risks and owners.');
    expect(fourthContext).toContain('Then, the user said: Remove section 3.');
    expect(fourthContext).toContain('Then, the assistant replied: Section 3 removed from the artifact.');
  });

  it('includes shared ledger continuity when the provider changes on the same task', async () => {
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

    const runSpy = vi.spyOn(AgentRuntime.prototype, 'run')
      .mockResolvedValueOnce(buildResult('Drafted the initial release checklist.'))
      .mockResolvedValueOnce(buildResult('Added deployment verification steps.'));

    const service = new AgentModelService();
    service.init();

    await invokeWithoutSubagents(service, taskId, 'Draft the initial release checklist.', 'gpt-5.4');
    await invokeWithoutSubagents(service, taskId, 'Continue this and add deployment verification steps.', 'haiku');

    const secondContext = contextForTask(runSpy, 'Continue this and add deployment verification steps.');

    expect(secondContext).toContain('## Shared Runtime Ledger');
    expect(secondContext).toContain('active model changed to haiku');
    expect(secondContext).toContain('Latest user request: Draft the initial release checklist.');
    expect(secondContext).toContain('Latest model result: Drafted the initial release checklist.');
  });

  it('preserves chained follow-ups across compare, focus, convert, and append steps', async () => {
    const taskId = makeTaskId('context-chain');
    createdTaskIds.push(taskId);
    const runSpy = vi.spyOn(AgentRuntime.prototype, 'run')
      .mockResolvedValueOnce(buildResult('Comparison: option A is cheaper, option B is faster.'))
      .mockResolvedValueOnce(buildResult('Focus: option B wins on latency and operational simplicity.'))
      .mockResolvedValueOnce(buildResult('option,reason\nB,latency and simplicity'))
      .mockResolvedValueOnce(buildResult('Appended row: B,benchmark confidence'));

    const service = new AgentModelService();
    service.init();

    await invokeWithoutSubagents(service, taskId, 'Compare option A vs option B.', 'gpt-5.4');
    await invokeWithoutSubagents(service, taskId, 'Focus only on B.', 'gpt-5.4');
    await invokeWithoutSubagents(service, taskId, 'Convert that to CSV.', 'gpt-5.4');
    await invokeWithoutSubagents(service, taskId, 'Append a row for benchmark confidence.', 'gpt-5.4');

    const secondContext = contextForTask(runSpy, 'Focus only on B.');
    const thirdContext = contextForTask(runSpy, 'Convert that to CSV.');
    const fourthContext = contextForTask(runSpy, 'Append a row for benchmark confidence.');

    expect(secondContext).toContain('Earlier, the user said: Compare option A vs option B.');
    expect(secondContext).toContain('Then, the assistant replied: Comparison: option A is cheaper, option B is faster.');
    expect(thirdContext).toContain('Then, the user said: Focus only on B.');
    expect(thirdContext).toContain('Then, the assistant replied: Focus: option B wins on latency and operational simplicity.');
    expect(fourthContext).toContain('Then, the user said: Convert that to CSV.');
    expect(fourthContext).toContain('Then, the assistant replied:\noption,reason');
  });

  it('hydrates the shared thread context when switching from Codex to Haiku', async () => {
    const taskId = makeTaskId('provider-switch');
    createdTaskIds.push(taskId);
    const runSpy = vi.spyOn(AgentRuntime.prototype, 'run')
      .mockResolvedValueOnce(buildResult('Draft plan: discovery, migration, rollout.'))
      .mockResolvedValueOnce(buildResult('Rollout phase now includes risks and rollback criteria.'));

    const service = new AgentModelService();
    service.init();

    await invokeWithoutSubagents(service, taskId, 'Start a rollout plan for the migration.', 'gpt-5.4');
    await invokeWithoutSubagents(service, taskId, 'Continue this and add risks for rollout.', 'haiku');

    const switchedContext = contextForTask(runSpy, 'Continue this and add risks for rollout.');
    expect(switchedContext).toContain('## Continuation Context');
    expect(switchedContext).toContain('### Relevant Prior Work');
    expect(switchedContext).toContain('User: Start a rollout plan for the migration.');
    expect(switchedContext).toContain('Assistant (gpt-5.4): Draft plan: discovery, migration, rollout.');
  });

  it('does not auto-hydrate prior thread history on provider switch for a fresh standalone prompt', async () => {
    const taskId = makeTaskId('provider-switch-fresh');
    createdTaskIds.push(taskId);
    const runSpy = vi.spyOn(AgentRuntime.prototype, 'run')
      .mockResolvedValueOnce(buildResult('Draft plan: discovery, migration, rollout.'))
      .mockResolvedValueOnce(buildResult('One-line note: Thanks for the update.'));

    const service = new AgentModelService();
    service.init();

    await invokeWithoutSubagents(service, taskId, 'Start a rollout plan for the migration.', 'gpt-5.4');
    await invokeWithoutSubagents(service, taskId, 'Write a one-line thank-you note.', 'haiku');

    const switchedContext = contextForTask(runSpy, 'Write a one-line thank-you note.');
    expect(switchedContext).not.toContain('The task began with the request: Start a rollout plan for the migration.');
    expect(switchedContext).not.toContain('Earlier, the user said: Start a rollout plan for the migration.');
    expect(switchedContext).not.toContain('Then, the assistant replied: Draft plan: discovery, migration, rollout.');
  });

  it('hydrates the most recent prior thread when the prompt explicitly asks for the previous chat', async () => {
    const priorTaskId = makeTaskId('previous-chat-source');
    const currentTaskId = makeTaskId('previous-chat-target');
    createdTaskIds.push(priorTaskId, currentTaskId);
    const runSpy = vi.spyOn(AgentRuntime.prototype, 'run')
      .mockResolvedValueOnce(buildResult('Draft plan: discovery, migration, rollout.'))
      .mockResolvedValueOnce(buildResult('Continued from prior thread.'));

    const service = new AgentModelService();
    service.init();

    await invokeWithoutSubagents(service, priorTaskId, 'Start a rollout plan for the migration.', 'gpt-5.4');

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

    await invokeWithoutSubagents(service, currentTaskId, 'Reference the previous chat and continue the rollout plan.', 'gpt-5.4');

    const recalledContext = contextForTask(runSpy, 'Reference the previous chat and continue the rollout plan.');
    expect(recalledContext).toContain('## Previous Chat Recall');
    expect(recalledContext).toContain('Earlier, the user said: Start a rollout plan for the migration.');
    expect(recalledContext).toContain('Then, the assistant replied: Draft plan: discovery, migration, rollout.');
  });

  it('keeps long conversations understandable even when tool messages are interleaved', async () => {
    const taskId = makeTaskId('long-conversation');
    createdTaskIds.push(taskId);
    const runSpy = vi.spyOn(AgentRuntime.prototype, 'run')
      .mockResolvedValueOnce(buildResult('Found vendors Alpha, Beta, and Gamma.'))
      .mockResolvedValueOnce(buildResult('Beta has the strongest reliability profile.'))
      .mockResolvedValueOnce(buildResult('Verified risks for Beta: migration time and contract lock-in.'));

    const service = new AgentModelService();
    service.init();

    await invokeWithoutSubagents(service, taskId, 'Research three vendors.', 'gpt-5.4');
    chatKnowledgeStore.recordToolMessage(taskId, JSON.stringify({
      tool: 'browser.research_search',
      input: { query: 'three vendors' },
      result: { payload: `${'x'.repeat(1200)}VERY_LARGE_TOOL_PAYLOAD` },
    }, null, 2), 'gpt-5.4');
    await invokeWithoutSubagents(service, taskId, 'Focus on Beta.', 'gpt-5.4');
    chatKnowledgeStore.recordToolMessage(taskId, JSON.stringify({
      tool: 'browser.read_cached_chunk',
      input: { pageId: 'beta' },
      result: { payload: `${'y'.repeat(1200)}VERY_LARGE_TOOL_PAYLOAD` },
    }, null, 2), 'gpt-5.4');
    await invokeWithoutSubagents(service, taskId, 'Continue this and list only verified risks.', 'gpt-5.4');

    const continuationContext = contextForTask(runSpy, 'Continue this and list only verified risks.');
    expect(continuationContext).toContain('Earlier, the user said: Research three vendors.');
    expect(continuationContext).toContain('Then, the assistant replied: Found vendors Alpha, Beta, and Gamma.');
    expect(continuationContext).toContain('Then, the user said: Focus on Beta.');
    expect(continuationContext).toContain('Then, the assistant replied: Beta has the strongest reliability profile.');
    expect(continuationContext).not.toContain('VERY_LARGE_TOOL_PAYLOAD');
  });

  it('includes both active artifact state and prior assistant output when follow-ups say "this"', async () => {
    const taskId = makeTaskId('artifact-overlap');
    createdTaskIds.push(taskId);
    const runSpy = vi.spyOn(AgentRuntime.prototype, 'run')
      .mockResolvedValueOnce(buildResult('The budget tradeoff is cost versus reliability.'))
      .mockResolvedValueOnce(buildResult('Converted the budget tradeoff into CSV format.'));

    const service = new AgentModelService();
    service.init();

    fakeState.artifacts = [activeArtifact({
      title: 'Budget Sheet',
      format: 'csv',
    })];
    fakeState.activeArtifactId = 'artifact-1';
    artifactReadContentMock.mockReturnValue({
      content: 'category,cost,reliability\ncurrent,low,medium\n',
    });

    await invokeWithoutSubagents(service, taskId, 'Explain the budget tradeoffs briefly.', 'gpt-5.4');
    await invokeWithoutSubagents(service, taskId, 'Update this to CSV.', 'gpt-5.4');

    const overlapContext = contextForTask(runSpy, 'Update this to CSV.');
    expect(overlapContext).toContain('Then, the assistant replied: The budget tradeoff is cost versus reliability.');
    expect(overlapContext).toContain('Active artifact: Budget Sheet (csv)');
    expect(overlapContext).toContain('## Task Memory');
  });

  it('resolves affirmative follow-ups against the latest assistant proposal', async () => {
    const taskId = makeTaskId('affirmative-followup');
    createdTaskIds.push(taskId);
    const runSpy = vi.spyOn(AgentRuntime.prototype, 'run')
      .mockResolvedValueOnce(buildResult('I can install pnpm and update PATH for you. Would you like me to do that?'))
      .mockResolvedValueOnce(buildResult('Installed pnpm and updated PATH.'));

    const service = new AgentModelService();
    service.init();

    await invokeWithoutSubagents(service, taskId, 'My shell cannot find pnpm.', 'gpt-5.4');
    await invokeWithoutSubagents(service, taskId, 'go ahead', 'haiku');

    const followUpContext = contextForTask(runSpy, 'go ahead');
    expect(followUpContext).toContain('## Follow-Up Resolution');
    expect(followUpContext).toContain('Latest prior assistant message:');
    expect(followUpContext).toContain('I can install pnpm and update PATH for you. Would you like me to do that?');
    expect(followUpContext).toContain('Treat this as approval to carry out the most recent concrete assistant proposal');
  });

  it('resolves pronoun-only follow-ups against the latest identified fix target', async () => {
    const taskId = makeTaskId('pronoun-followup');
    createdTaskIds.push(taskId);
    const runSpy = vi.spyOn(AgentRuntime.prototype, 'run')
      .mockResolvedValueOnce(buildResult('The failure is coming from a missing PATH export in your shell profile. I can help you fix this.'))
      .mockResolvedValueOnce(buildResult('Updated the shell profile to export PATH.'));

    const service = new AgentModelService();
    service.init();

    await invokeWithoutSubagents(service, taskId, 'Why does pnpm fail in this terminal?', 'gpt-5.4');
    await invokeWithoutSubagents(service, taskId, 'help me fix this', 'haiku');

    const followUpContext = contextForTask(runSpy, 'help me fix this');
    expect(followUpContext).toContain('## Follow-Up Resolution');
    expect(followUpContext).toContain('Latest prior assistant message:');
    expect(followUpContext).toContain('missing PATH export in your shell profile');
    expect(followUpContext).toContain('Treat references like "it", "this", or "that" as pointing to the most recent concrete assistant proposal');
  });
});
