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
const { fakeState, eventBusOnMock } = vitest_1.vi.hoisted(() => ({
    fakeState: {
        activeTaskId: null,
        activeArtifactId: null,
        artifacts: [],
        browserRuntime: {
            activeTabId: null,
            tabs: [],
        },
        tasks: [],
    },
    eventBusOnMock: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('electron', () => ({
    app: {
        getPath: () => process.env.V2_TEST_USER_DATA || os.tmpdir(),
    },
}));
vitest_1.vi.mock('../state/appStateStore', () => ({
    appStateStore: {
        getState: () => fakeState,
    },
}));
vitest_1.vi.mock('../events/eventBus', () => ({
    eventBus: {
        on: eventBusOnMock,
    },
}));
const runtimeLedgerStore_1 = require("./runtimeLedgerStore");
(0, vitest_1.describe)('RuntimeLedgerStore', () => {
    let userDataDir = '';
    (0, vitest_1.beforeEach)(() => {
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
    (0, vitest_1.afterEach)(() => {
        delete process.env.V2_TEST_USER_DATA;
        fs.rmSync(userDataDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)('builds prior-task continuity from the shared ledger for continuation prompts', () => {
        const store = new runtimeLedgerStore_1.RuntimeLedgerStore();
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
        (0, vitest_1.expect)(context).toContain('## Prior Task Continuity');
        (0, vitest_1.expect)(context).toContain('Prior task: Release Rollout Task');
        (0, vitest_1.expect)(context).toContain('Latest prior model result: Drafted the rollout plan with phased deployment and rollback checks.');
        (0, vitest_1.expect)(context).toContain('Verified staging rollout timings against the checklist.');
        (0, vitest_1.expect)(context).toContain('Open issue: production owner approval still missing.');
    });
    (0, vitest_1.it)('does not inject prior-task continuity for unrelated prompts when current task already has state', () => {
        const store = new runtimeLedgerStore_1.RuntimeLedgerStore();
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
        (0, vitest_1.expect)(context).toBeNull();
    });
    (0, vitest_1.it)('derives run, artifact, browser, decision, and evidence snapshots for a task', () => {
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
        const store = new runtimeLedgerStore_1.RuntimeLedgerStore();
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
        (0, vitest_1.expect)(snapshot.currentRun).toEqual(vitest_1.expect.objectContaining({
            runId: 'run-1',
            providerId: 'gpt-5.4',
            status: 'running',
            latestToolCallLabel: 'browser.extract_page',
        }));
        (0, vitest_1.expect)(snapshot.currentRun?.latestToolSummary).toContain('captured release notes');
        (0, vitest_1.expect)(snapshot.artifacts).toEqual([
            vitest_1.expect.objectContaining({
                artifactId: 'artifact-1',
                title: 'Launch Brief',
                isActive: true,
                lastAction: 'set-active',
            }),
        ]);
        (0, vitest_1.expect)(snapshot.browserTabs).toEqual([
            vitest_1.expect.objectContaining({
                tabId: 'tab-1',
                title: 'Release Notes',
                url: 'https://example.com/release',
                isActive: true,
            }),
        ]);
        (0, vitest_1.expect)(snapshot.evidence[0]).toEqual(vitest_1.expect.objectContaining({
            summary: 'Verified release timing against the published notes.',
            sourceKind: 'evidence',
        }));
        (0, vitest_1.expect)(snapshot.decisions[0]).toEqual(vitest_1.expect.objectContaining({
            summary: 'Decision: ship with the staged rollout plan.',
            sourceKind: 'verification',
        }));
        const hydration = store.buildHydrationContext({
            taskId: 'task-current',
            currentProviderId: 'gpt-5.4',
        });
        (0, vitest_1.expect)(hydration).toContain('### Current Run');
        (0, vitest_1.expect)(hydration).toContain('### Entity Snapshots');
        (0, vitest_1.expect)(hydration).toContain('Artifact Launch Brief (md, status=ready, active)');
        (0, vitest_1.expect)(hydration).toContain('Browser tab Release Notes (active)');
    });
});
//# sourceMappingURL=runtimeLedgerStore.test.js.map