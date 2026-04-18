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
const { writeFileSyncMock } = vitest_1.vi.hoisted(() => ({
    writeFileSyncMock: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('fs', async () => {
    const actual = await vitest_1.vi.importActual('fs');
    writeFileSyncMock.mockImplementation(actual.writeFileSync.bind(actual));
    return {
        ...actual,
        writeFileSync: writeFileSyncMock,
    };
});
vitest_1.vi.mock('electron', () => ({
    app: {
        getPath: () => process.env.V2_TEST_USER_DATA || os.tmpdir(),
    },
}));
(0, vitest_1.describe)('ArtifactService', () => {
    let userDataDir = '';
    let workspaceDir = '';
    (0, vitest_1.beforeEach)(() => {
        userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-artifacts-user-data-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-artifacts-workspace-'));
        process.env.V2_TEST_USER_DATA = userDataDir;
        process.env.V2_WORKSPACE_ROOT = workspaceDir;
    });
    (0, vitest_1.afterEach)(() => {
        delete process.env.V2_TEST_USER_DATA;
        delete process.env.V2_WORKSPACE_ROOT;
        fs.rmSync(userDataDir, { recursive: true, force: true });
        fs.rmSync(workspaceDir, { recursive: true, force: true });
        writeFileSyncMock.mockClear();
        vitest_1.vi.resetModules();
    });
    (0, vitest_1.it)('creates artifacts with managed storage, persists them, and stores task linkage', async () => {
        const { appStateStore } = await Promise.resolve().then(() => __importStar(require('../state/appStateStore')));
        const { ActionType } = await Promise.resolve().then(() => __importStar(require('../state/actions')));
        const { artifactService } = await Promise.resolve().then(() => __importStar(require('./ArtifactService')));
        appStateStore.dispatch({
            type: ActionType.ADD_TASK,
            task: {
                id: 'task-1',
                title: 'Draft report',
                status: 'queued',
                owner: 'user',
                artifactIds: [],
                createdAt: 1,
                updatedAt: 1,
            },
        });
        appStateStore.dispatch({
            type: ActionType.ADD_TASK,
            task: {
                id: 'task-2',
                title: 'Follow-up edits',
                status: 'queued',
                owner: 'user',
                artifactIds: [],
                createdAt: 2,
                updatedAt: 2,
            },
        });
        const created = artifactService.createArtifact({
            title: 'Q2 Strategy Memo',
            format: 'md',
            createdBy: 'task-1',
            taskId: 'task-1',
        });
        (0, vitest_1.expect)(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        (0, vitest_1.expect)(created.workingPath).toBe(path.join(workspaceDir, 'artifacts', created.id, 'q2-strategy-memo.md'));
        (0, vitest_1.expect)(fs.existsSync(created.workingPath)).toBe(true);
        (0, vitest_1.expect)(created.status).toBe('created');
        (0, vitest_1.expect)(created.linkedTaskIds).toEqual(['task-1']);
        const linked = artifactService.linkArtifactToTask(created.id, 'task-2');
        (0, vitest_1.expect)(linked.linkedTaskIds).toEqual(['task-1', 'task-2']);
        const listed = artifactService.listArtifacts();
        (0, vitest_1.expect)(listed).toHaveLength(1);
        (0, vitest_1.expect)(listed[0].id).toBe(created.id);
        (0, vitest_1.expect)(artifactService.getActiveArtifact()?.id).toBe(created.id);
        const stateBeforeReload = appStateStore.getState();
        (0, vitest_1.expect)(stateBeforeReload.tasks.find((task) => task.id === 'task-1')?.artifactIds).toContain(created.id);
        (0, vitest_1.expect)(stateBeforeReload.tasks.find((task) => task.id === 'task-2')?.artifactIds).toContain(created.id);
        (0, vitest_1.expect)(stateBeforeReload.activeArtifactId).toBe(created.id);
        appStateStore.persistNow();
        vitest_1.vi.resetModules();
        const { artifactService: reloadedArtifactService } = await Promise.resolve().then(() => __importStar(require('./ArtifactService')));
        const { appStateStore: reloadedAppStateStore } = await Promise.resolve().then(() => __importStar(require('../state/appStateStore')));
        const reloaded = reloadedArtifactService.getArtifact(created.id);
        (0, vitest_1.expect)(reloaded).toBeTruthy();
        (0, vitest_1.expect)(reloaded?.title).toBe('Q2 Strategy Memo');
        (0, vitest_1.expect)(reloaded?.format).toBe('md');
        (0, vitest_1.expect)(reloaded?.linkedTaskIds).toEqual(['task-1', 'task-2']);
        (0, vitest_1.expect)(reloadedArtifactService.listArtifacts()).toHaveLength(1);
        (0, vitest_1.expect)(reloadedArtifactService.getActiveArtifact()?.id).toBe(created.id);
        (0, vitest_1.expect)(reloadedAppStateStore.getState().tasks.find((task) => task.id === 'task-1')?.artifactIds).toContain(created.id);
        (0, vitest_1.expect)(reloadedAppStateStore.getState().tasks.find((task) => task.id === 'task-2')?.artifactIds).toContain(created.id);
    });
    (0, vitest_1.it)('allows explicitly switching the active artifact', async () => {
        const { artifactService } = await Promise.resolve().then(() => __importStar(require('./ArtifactService')));
        const first = artifactService.createArtifact({
            title: 'Notes',
            format: 'txt',
            createdBy: 'user',
        });
        const second = artifactService.createArtifact({
            title: 'Tracking Table',
            format: 'csv',
            createdBy: 'system',
        });
        (0, vitest_1.expect)(artifactService.getActiveArtifact()?.id).toBe(second.id);
        artifactService.setActiveArtifact(first.id);
        (0, vitest_1.expect)(artifactService.getActiveArtifact()?.id).toBe(first.id);
    });
    (0, vitest_1.it)('deletes managed artifacts, removes task linkage, and promotes the next active artifact', async () => {
        const { appStateStore } = await Promise.resolve().then(() => __importStar(require('../state/appStateStore')));
        const { ActionType } = await Promise.resolve().then(() => __importStar(require('../state/actions')));
        const { artifactService } = await Promise.resolve().then(() => __importStar(require('./ArtifactService')));
        appStateStore.dispatch({
            type: ActionType.ADD_TASK,
            task: {
                id: 'task-delete',
                title: 'Delete artifact',
                status: 'queued',
                owner: 'user',
                artifactIds: [],
                createdAt: 1,
                updatedAt: 1,
            },
        });
        const first = artifactService.createArtifact({
            title: 'First Note',
            format: 'md',
            createdBy: 'task-delete',
            taskId: 'task-delete',
        });
        const second = artifactService.createArtifact({
            title: 'Second Note',
            format: 'txt',
            createdBy: 'user',
        });
        (0, vitest_1.expect)(fs.existsSync(second.workingPath)).toBe(true);
        const deleted = artifactService.deleteArtifact(second.id, 'user');
        (0, vitest_1.expect)(deleted.deletedArtifactId).toBe(second.id);
        (0, vitest_1.expect)(deleted.nextActiveArtifact?.id).toBe(first.id);
        (0, vitest_1.expect)(fs.existsSync(path.join(workspaceDir, 'artifacts', second.id))).toBe(false);
        (0, vitest_1.expect)(artifactService.getArtifact(second.id)).toBeNull();
        (0, vitest_1.expect)(artifactService.getActiveArtifact()?.id).toBe(first.id);
        (0, vitest_1.expect)(appStateStore.getState().tasks.find((task) => task.id === 'task-delete')?.artifactIds).toEqual([first.id]);
    });
    (0, vitest_1.it)('replaces content, transitions status, updates provenance, and persists after restart', async () => {
        const { appStateStore } = await Promise.resolve().then(() => __importStar(require('../state/appStateStore')));
        const { ActionType } = await Promise.resolve().then(() => __importStar(require('../state/actions')));
        const { artifactService } = await Promise.resolve().then(() => __importStar(require('./ArtifactService')));
        appStateStore.dispatch({
            type: ActionType.ADD_TASK,
            task: {
                id: 'task-replace',
                title: 'Write draft',
                status: 'queued',
                owner: 'user',
                artifactIds: [],
                createdAt: 1,
                updatedAt: 1,
            },
        });
        appStateStore.dispatch({ type: ActionType.SET_ACTIVE_TASK, taskId: 'task-replace' });
        const artifact = artifactService.createArtifact({
            title: 'Draft',
            format: 'md',
            createdBy: 'user',
        });
        const updated = artifactService.replaceContent(artifact.id, '# Draft\n\nHello world');
        (0, vitest_1.expect)(fs.readFileSync(updated.workingPath, 'utf-8')).toBe('# Draft\n\nHello world');
        (0, vitest_1.expect)(updated.status).toBe('active');
        (0, vitest_1.expect)(updated.lastUpdatedBy).toBe('task-replace');
        (0, vitest_1.expect)(updated.linkedTaskIds).toContain('task-replace');
        appStateStore.persistNow();
        vitest_1.vi.resetModules();
        const { artifactService: reloadedArtifactService } = await Promise.resolve().then(() => __importStar(require('./ArtifactService')));
        const reloaded = reloadedArtifactService.getArtifact(artifact.id);
        (0, vitest_1.expect)(reloaded?.status).toBe('active');
        (0, vitest_1.expect)(reloaded?.lastUpdatedBy).toBe('task-replace');
        (0, vitest_1.expect)(fs.readFileSync(reloaded.workingPath, 'utf-8')).toBe('# Draft\n\nHello world');
    });
    (0, vitest_1.it)('appends content for text artifacts', async () => {
        const { artifactService } = await Promise.resolve().then(() => __importStar(require('./ArtifactService')));
        const artifact = artifactService.createArtifact({
            title: 'Notes',
            format: 'txt',
            createdBy: 'user',
        });
        artifactService.replaceContent(artifact.id, 'alpha');
        const appended = artifactService.appendContent(artifact.id, '\nbeta', 'user');
        (0, vitest_1.expect)(fs.readFileSync(appended.workingPath, 'utf-8')).toBe('alpha\nbeta');
        (0, vitest_1.expect)(appended.status).toBe('active');
        (0, vitest_1.expect)(appended.lastUpdatedBy).toBe('user');
    });
    (0, vitest_1.it)('appends csv rows with newline-safe separation', async () => {
        const { artifactService } = await Promise.resolve().then(() => __importStar(require('./ArtifactService')));
        const artifact = artifactService.createArtifact({
            title: 'Tracking',
            format: 'csv',
            createdBy: 'system',
        });
        artifactService.replaceContent(artifact.id, 'name,value');
        const appended = artifactService.appendContent(artifact.id, 'row1,1\r\nrow2,2\r', 'system');
        (0, vitest_1.expect)(fs.readFileSync(appended.workingPath, 'utf-8')).toBe('name,value\nrow1,1\nrow2,2');
        (0, vitest_1.expect)(appended.status).toBe('active');
    });
    (0, vitest_1.it)('rejects append for html artifacts', async () => {
        const { artifactService } = await Promise.resolve().then(() => __importStar(require('./ArtifactService')));
        const artifact = artifactService.createArtifact({
            title: 'Page',
            format: 'html',
            createdBy: 'user',
        });
        (0, vitest_1.expect)(() => artifactService.appendContent(artifact.id, '<div>more</div>')).toThrow('Append is not supported for html artifacts.');
    });
    (0, vitest_1.it)('marks artifact failed when a write errors during replace', async () => {
        const { artifactService } = await Promise.resolve().then(() => __importStar(require('./ArtifactService')));
        const artifact = artifactService.createArtifact({
            title: 'Broken',
            format: 'txt',
            createdBy: 'user',
        });
        writeFileSyncMock.mockImplementationOnce(() => {
            throw new Error('disk full');
        });
        (0, vitest_1.expect)(() => artifactService.replaceContent(artifact.id, 'data', 'system')).toThrow('disk full');
        (0, vitest_1.expect)(artifactService.getArtifact(artifact.id)?.status).toBe('failed');
    });
    (0, vitest_1.it)('can use the active artifact helper path for writes', async () => {
        const { artifactService } = await Promise.resolve().then(() => __importStar(require('./ArtifactService')));
        const first = artifactService.createArtifact({
            title: 'One',
            format: 'txt',
            createdBy: 'user',
        });
        artifactService.createArtifact({
            title: 'Two',
            format: 'txt',
            createdBy: 'user',
        });
        artifactService.setActiveArtifact(first.id);
        const updated = artifactService.replaceActiveArtifactContent('focused', 'user');
        (0, vitest_1.expect)(updated.id).toBe(first.id);
        (0, vitest_1.expect)(fs.readFileSync(updated.workingPath, 'utf-8')).toBe('focused');
    });
});
//# sourceMappingURL=ArtifactService.test.js.map