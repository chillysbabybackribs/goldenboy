import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { writeFileSyncMock } = vi.hoisted(() => ({
  writeFileSyncMock: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  writeFileSyncMock.mockImplementation(actual.writeFileSync.bind(actual));
  return {
    ...actual,
    writeFileSync: writeFileSyncMock,
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: () => process.env.V2_TEST_USER_DATA || os.tmpdir(),
  },
}));

describe('ArtifactService', () => {
  let userDataDir = '';
  let workspaceDir = '';

  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-artifacts-user-data-'));
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-artifacts-workspace-'));
    process.env.V2_TEST_USER_DATA = userDataDir;
    process.env.V2_WORKSPACE_ROOT = workspaceDir;
  });

  afterEach(() => {
    delete process.env.V2_TEST_USER_DATA;
    delete process.env.V2_WORKSPACE_ROOT;
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    writeFileSyncMock.mockClear();
    vi.resetModules();
  });

  it('creates artifacts with managed storage, persists them, and stores task linkage', async () => {
    const { appStateStore } = await import('../state/appStateStore');
    const { ActionType } = await import('../state/actions');
    const { artifactService } = await import('./ArtifactService');

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

    expect(created.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(created.workingPath).toBe(
      path.join(workspaceDir, 'artifacts', created.id, 'q2-strategy-memo.md'),
    );
    expect(fs.existsSync(created.workingPath)).toBe(true);
    expect(created.status).toBe('created');
    expect(created.linkedTaskIds).toEqual(['task-1']);

    const linked = artifactService.linkArtifactToTask(created.id, 'task-2');
    expect(linked.linkedTaskIds).toEqual(['task-1', 'task-2']);

    const listed = artifactService.listArtifacts();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(created.id);
    expect(artifactService.getActiveArtifact()?.id).toBe(created.id);

    const stateBeforeReload = appStateStore.getState();
    expect(stateBeforeReload.tasks.find((task) => task.id === 'task-1')?.artifactIds).toContain(created.id);
    expect(stateBeforeReload.tasks.find((task) => task.id === 'task-2')?.artifactIds).toContain(created.id);
    expect(stateBeforeReload.activeArtifactId).toBe(created.id);

    appStateStore.persistNow();

    vi.resetModules();

    const { artifactService: reloadedArtifactService } = await import('./ArtifactService');
    const { appStateStore: reloadedAppStateStore } = await import('../state/appStateStore');

    const reloaded = reloadedArtifactService.getArtifact(created.id);
    expect(reloaded).toBeTruthy();
    expect(reloaded?.title).toBe('Q2 Strategy Memo');
    expect(reloaded?.format).toBe('md');
    expect(reloaded?.linkedTaskIds).toEqual(['task-1', 'task-2']);
    expect(reloadedArtifactService.listArtifacts()).toHaveLength(1);
    expect(reloadedArtifactService.getActiveArtifact()?.id).toBe(created.id);
    expect(reloadedAppStateStore.getState().tasks.find((task) => task.id === 'task-1')?.artifactIds).toContain(created.id);
    expect(reloadedAppStateStore.getState().tasks.find((task) => task.id === 'task-2')?.artifactIds).toContain(created.id);
  });

  it('allows explicitly switching the active artifact', async () => {
    const { artifactService } = await import('./ArtifactService');

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

    expect(artifactService.getActiveArtifact()?.id).toBe(second.id);
    artifactService.setActiveArtifact(first.id);
    expect(artifactService.getActiveArtifact()?.id).toBe(first.id);
  });

  it('deletes managed artifacts, removes task linkage, and promotes the next active artifact', async () => {
    const { appStateStore } = await import('../state/appStateStore');
    const { ActionType } = await import('../state/actions');
    const { artifactService } = await import('./ArtifactService');

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

    expect(fs.existsSync(second.workingPath)).toBe(true);
    const deleted = artifactService.deleteArtifact(second.id, 'user');

    expect(deleted.deletedArtifactId).toBe(second.id);
    expect(deleted.nextActiveArtifact?.id).toBe(first.id);
    expect(fs.existsSync(path.join(workspaceDir, 'artifacts', second.id))).toBe(false);
    expect(artifactService.getArtifact(second.id)).toBeNull();
    expect(artifactService.getActiveArtifact()?.id).toBe(first.id);
    expect(appStateStore.getState().tasks.find((task) => task.id === 'task-delete')?.artifactIds).toEqual([first.id]);
  });

  it('replaces content, transitions status, updates provenance, and persists after restart', async () => {
    const { appStateStore } = await import('../state/appStateStore');
    const { ActionType } = await import('../state/actions');
    const { artifactService } = await import('./ArtifactService');

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
    expect(fs.readFileSync(updated.workingPath, 'utf-8')).toBe('# Draft\n\nHello world');
    expect(updated.status).toBe('active');
    expect(updated.lastUpdatedBy).toBe('task-replace');
    expect(updated.linkedTaskIds).toContain('task-replace');

    appStateStore.persistNow();
    vi.resetModules();

    const { artifactService: reloadedArtifactService } = await import('./ArtifactService');
    const reloaded = reloadedArtifactService.getArtifact(artifact.id);
    expect(reloaded?.status).toBe('active');
    expect(reloaded?.lastUpdatedBy).toBe('task-replace');
    expect(fs.readFileSync(reloaded!.workingPath, 'utf-8')).toBe('# Draft\n\nHello world');
  });

  it('appends content for text artifacts', async () => {
    const { artifactService } = await import('./ArtifactService');

    const artifact = artifactService.createArtifact({
      title: 'Notes',
      format: 'txt',
      createdBy: 'user',
    });

    artifactService.replaceContent(artifact.id, 'alpha');
    const appended = artifactService.appendContent(artifact.id, '\nbeta', 'user');

    expect(fs.readFileSync(appended.workingPath, 'utf-8')).toBe('alpha\nbeta');
    expect(appended.status).toBe('active');
    expect(appended.lastUpdatedBy).toBe('user');
  });

  it('appends csv rows with newline-safe separation', async () => {
    const { artifactService } = await import('./ArtifactService');

    const artifact = artifactService.createArtifact({
      title: 'Tracking',
      format: 'csv',
      createdBy: 'system',
    });

    artifactService.replaceContent(artifact.id, 'name,value');
    const appended = artifactService.appendContent(artifact.id, 'row1,1\r\nrow2,2\r', 'system');

    expect(fs.readFileSync(appended.workingPath, 'utf-8')).toBe('name,value\nrow1,1\nrow2,2');
    expect(appended.status).toBe('active');
  });

  it('rejects append for html artifacts', async () => {
    const { artifactService } = await import('./ArtifactService');

    const artifact = artifactService.createArtifact({
      title: 'Page',
      format: 'html',
      createdBy: 'user',
    });

    expect(() => artifactService.appendContent(artifact.id, '<div>more</div>')).toThrow(
      'Append is not supported for html artifacts.',
    );
  });

  it('marks artifact failed when a write errors during replace', async () => {
    const { artifactService } = await import('./ArtifactService');

    const artifact = artifactService.createArtifact({
      title: 'Broken',
      format: 'txt',
      createdBy: 'user',
    });

    writeFileSyncMock.mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    expect(() => artifactService.replaceContent(artifact.id, 'data', 'system')).toThrow('disk full');
    expect(artifactService.getArtifact(artifact.id)?.status).toBe('failed');
  });

  it('can use the active artifact helper path for writes', async () => {
    const { artifactService } = await import('./ArtifactService');

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
    expect(updated.id).toBe(first.id);
    expect(fs.readFileSync(updated.workingPath, 'utf-8')).toBe('focused');
  });
});
