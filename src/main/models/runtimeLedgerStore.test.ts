import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fakeState, eventBusOnMock } = vi.hoisted(() => ({
  fakeState: {
    activeTaskId: null,
    activeArtifactId: null,
    artifacts: [],
    browserRuntime: {
      activeTabId: null,
      tabs: [],
    },
    tasks: [],
  } as {
    activeTaskId: string | null;
    activeArtifactId: string | null;
    artifacts: Array<Record<string, unknown>>;
    browserRuntime: {
      activeTabId: string | null;
      tabs: Array<Record<string, unknown>>;
    };
    tasks: Array<Record<string, unknown>>;
  },
  eventBusOnMock: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => process.env.V2_TEST_USER_DATA || os.tmpdir(),
  },
}));

vi.mock('../state/appStateStore', () => ({
  appStateStore: {
    getState: () => fakeState,
  },
}));

vi.mock('../events/eventBus', () => ({
  eventBus: {
    on: eventBusOnMock,
  },
}));

import { RuntimeLedgerStore } from './runtimeLedgerStore';

describe('RuntimeLedgerStore', () => {
  let userDataDir = '';

  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-runtime-ledger-'));
    process.env.V2_TEST_USER_DATA = userDataDir;
    eventBusOnMock.mockReset();
    fakeState.activeTaskId = null;
    fakeState.activeArtifactId = null;
    fakeState.artifacts = [];
    fakeState.browserRuntime = {
      activeTabId: null,
      tabs: [],
    };
    fakeState.tasks = [
      {
        id: 'task-current',
        title: 'Current Task',
        status: 'queued',
        owner: 'user',
        artifactIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: 'task-prior',
        title: 'Release Rollout Task',
        status: 'completed',
        owner: 'gpt-5.4',
        artifactIds: [],
        createdAt: Date.now() - 5_000,
        updatedAt: Date.now() - 4_000,
      },
    ];
  });

  afterEach(() => {
    delete process.env.V2_TEST_USER_DATA;
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it('builds prior-task continuity from the shared ledger for continuation prompts', () => {
    const store = new RuntimeLedgerStore();

    store.recordTaskMemoryEntry({
      id: 'prior-user',
      taskId: 'task-prior',
      kind: 'user_prompt',
      text: 'Prepare the release rollout plan with deployment phases.',
      createdAt: Date.now() - 3_000,
    });
    store.recordTaskMemoryEntry({
      id: 'prior-result',
      taskId: 'task-prior',
      kind: 'model_result',
      text: 'Drafted the rollout plan with phased deployment and rollback checks.',
      providerId: 'gpt-5.4',
      createdAt: Date.now() - 2_500,
      metadata: { success: true },
    });
    store.recordTaskMemoryEntry({
      id: 'prior-evidence',
      taskId: 'task-prior',
      kind: 'system',
      text: 'Verified staging rollout timings against the checklist.',
      createdAt: Date.now() - 2_000,
      metadata: { category: 'evidence' },
    });
    store.recordTaskMemoryEntry({
      id: 'prior-critique',
      taskId: 'task-prior',
      kind: 'system',
      text: 'Open issue: production owner approval still missing.',
      createdAt: Date.now() - 1_500,
      metadata: { category: 'critique' },
    });

    const context = store.buildTaskSwitchContext({
      taskId: 'task-current',
      prompt: 'continue the rollout task from before and finish it',
    });

    expect(context).toContain('## Prior Task Continuity');
    expect(context).toContain('Prior task: Release Rollout Task');
    expect(context).toContain('Latest prior model result: Drafted the rollout plan with phased deployment and rollback checks.');
    expect(context).toContain('Verified staging rollout timings against the checklist.');
    expect(context).toContain('Open issue: production owner approval still missing.');
  });

  it('does not inject prior-task continuity for unrelated prompts when current task already has state', () => {
    const store = new RuntimeLedgerStore();

    store.recordTaskMemoryEntry({
      id: 'current-user',
      taskId: 'task-current',
      kind: 'user_prompt',
      text: 'Write a fresh brainstorm for a homepage refresh.',
      createdAt: Date.now() - 1_000,
    });
    store.recordTaskMemoryEntry({
      id: 'current-result',
      taskId: 'task-current',
      kind: 'model_result',
      text: 'Outlined three distinct homepage concepts.',
      providerId: 'haiku',
      createdAt: Date.now() - 500,
      metadata: { success: true },
    });
    store.recordTaskMemoryEntry({
      id: 'current-browser',
      taskId: 'task-current',
      kind: 'browser_finding',
      text: 'Reviewed current homepage references and visual patterns.',
      createdAt: Date.now() - 450,
    });
    store.recordTaskMemoryEntry({
      id: 'current-note',
      taskId: 'task-current',
      kind: 'system',
      text: 'Verified that the new brainstorm should stay within the marketing site scope.',
      createdAt: Date.now() - 400,
      metadata: { category: 'verification' },
    });
    store.recordTaskMemoryEntry({
      id: 'prior-user',
      taskId: 'task-prior',
      kind: 'user_prompt',
      text: 'Prepare the release rollout plan with deployment phases.',
      createdAt: Date.now() - 3_000,
    });

    const context = store.buildTaskSwitchContext({
      taskId: 'task-current',
      prompt: 'start a new visual brainstorm for the marketing site',
    });

    expect(context).toBeNull();
  });

  it('derives run, artifact, browser, decision, and evidence snapshots for a task', () => {
    fakeState.activeArtifactId = 'artifact-1';
    fakeState.artifacts = [{
      id: 'artifact-1',
      title: 'Launch Brief',
      format: 'md',
      status: 'ready',
      updatedAt: Date.now() - 200,
      createdAt: Date.now() - 5_000,
      createdBy: 'user',
      lastUpdatedBy: 'user',
      linkedTaskIds: ['task-current'],
      previewable: true,
      exportable: true,
      archived: false,
    }];
    fakeState.browserRuntime = {
      activeTabId: 'tab-1',
      tabs: [{
        id: 'tab-1',
        navigation: {
          title: 'Release Notes',
          url: 'https://example.com/release',
          isLoading: false,
        },
      }],
    };

    const store = new RuntimeLedgerStore();
    store.recordTaskStatus({
      taskId: 'task-current',
      providerId: 'gpt-5.4',
      runId: 'run-1',
      status: 'running',
      summary: 'Codex started implementation work',
    });
    store.recordToolEvent({
      taskId: 'task-current',
      runId: 'run-1',
      summary: 'Completed tool browser.extract_page: captured release notes',
      metadata: {
        toolName: 'browser.extract_page',
        status: 'completed',
      },
    });
    store.recordArtifactEvent({
      taskId: 'task-current',
      summary: 'Activated artifact Launch Brief',
      metadata: {
        artifactId: 'artifact-1',
        action: 'set-active',
      },
    });
    store.recordBrowserEvent({
      taskId: 'task-current',
      summary: 'Browser navigation: Release Notes',
      metadata: {
        tabId: 'tab-1',
        action: 'navigation-updated',
        title: 'Release Notes',
        url: 'https://example.com/release',
        isLoading: false,
      },
    });
    store.recordTaskMemoryEntry({
      id: 'evidence-1',
      taskId: 'task-current',
      kind: 'system',
      text: 'Verified release timing against the published notes.',
      createdAt: Date.now() - 100,
      metadata: { category: 'evidence' },
    });
    store.recordTaskMemoryEntry({
      id: 'decision-1',
      taskId: 'task-current',
      kind: 'system',
      text: 'Decision: ship with the staged rollout plan.',
      createdAt: Date.now() - 50,
      metadata: { category: 'verification' },
    });

    const snapshot = store.getTaskEntitySnapshot('task-current');

    expect(snapshot.currentRun).toEqual(expect.objectContaining({
      runId: 'run-1',
      providerId: 'gpt-5.4',
      status: 'running',
      latestToolCallLabel: 'browser.extract_page',
    }));
    expect(snapshot.currentRun?.latestToolSummary).toContain('captured release notes');
    expect(snapshot.artifacts).toEqual([
      expect.objectContaining({
        artifactId: 'artifact-1',
        title: 'Launch Brief',
        isActive: true,
        lastAction: 'set-active',
      }),
    ]);
    expect(snapshot.browserTabs).toEqual([
      expect.objectContaining({
        tabId: 'tab-1',
        title: 'Release Notes',
        url: 'https://example.com/release',
        isActive: true,
      }),
    ]);
    expect(snapshot.evidence[0]).toEqual(expect.objectContaining({
      summary: 'Verified release timing against the published notes.',
      sourceKind: 'evidence',
    }));
    expect(snapshot.decisions[0]).toEqual(expect.objectContaining({
      summary: 'Decision: ship with the staged rollout plan.',
      sourceKind: 'verification',
    }));

    const hydration = store.buildHydrationContext({
      taskId: 'task-current',
      currentProviderId: 'gpt-5.4',
    });
    expect(hydration).toContain('### Current Run');
    expect(hydration).toContain('### Entity Snapshots');
    expect(hydration).toContain('Artifact Launch Brief (md, status=ready, active)');
    expect(hydration).toContain('Browser tab Release Notes (active)');
  });
});
