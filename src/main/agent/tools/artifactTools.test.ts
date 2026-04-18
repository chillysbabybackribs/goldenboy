import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => process.env.V2_TEST_USER_DATA || os.tmpdir(),
  },
}));

describe('artifact tool definitions', () => {
  let userDataDir = '';
  let workspaceDir = '';

  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-artifact-tools-user-data-'));
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-artifact-tools-workspace-'));
    process.env.V2_TEST_USER_DATA = userDataDir;
    process.env.V2_WORKSPACE_ROOT = workspaceDir;
  });

  afterEach(() => {
    delete process.env.V2_TEST_USER_DATA;
    delete process.env.V2_WORKSPACE_ROOT;
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it('creates, reads, replaces, and appends managed artifacts through artifact tools', async () => {
    const { appStateStore } = await import('../../state/appStateStore');
    const { ActionType } = await import('../../state/actions');
    const { createArtifactToolDefinitions } = await import('./artifactTools');

    appStateStore.dispatch({
      type: ActionType.ADD_TASK,
      task: {
        id: 'task-artifact',
        title: 'Artifact task',
        status: 'queued',
        owner: 'user',
        artifactIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    });
    appStateStore.dispatch({ type: ActionType.SET_ACTIVE_TASK, taskId: 'task-artifact' });

    const tools = createArtifactToolDefinitions();
    const createTool = tools.find((tool) => tool.name === 'artifact.create')!;
    const deleteTool = tools.find((tool) => tool.name === 'artifact.delete')!;
    const listTool = tools.find((tool) => tool.name === 'artifact.list')!;
    const readTool = tools.find((tool) => tool.name === 'artifact.read')!;
    const replaceTool = tools.find((tool) => tool.name === 'artifact.replace_content')!;
    const appendTool = tools.find((tool) => tool.name === 'artifact.append_content')!;

    const context = {
      runId: 'run-1',
      agentId: 'gpt-5.4',
      mode: 'unrestricted-dev' as const,
      taskId: 'task-artifact',
    };

    const created = await createTool.execute({
      title: 'Weekly Research Note',
      format: 'md',
    }, context);
    const artifact = created.data.artifact as { id: string; linkedTaskIds: string[] };

    expect(artifact.id).toBeTruthy();
    expect(artifact.linkedTaskIds).toContain('task-artifact');

    await replaceTool.execute({
      artifactId: artifact.id,
      content: '# Weekly Research Note',
    }, context);
    await appendTool.execute({
      artifactId: artifact.id,
      content: '\n\nNext steps',
    }, context);

    const read = await readTool.execute({ artifactId: artifact.id }, context);
    expect(read.data.content).toBe('# Weekly Research Note\n\nNext steps');
    const workingPath = path.join(workspaceDir, 'artifacts', artifact.id, 'weekly-research-note.md');
    expect(fs.readFileSync(workingPath, 'utf-8')).toBe('# Weekly Research Note\n\nNext steps');

    const listed = await listTool.execute({}, context);
    expect(Array.isArray(listed.data.artifacts)).toBe(true);
    expect((listed.data.artifacts as Array<{ id: string }>).some((entry) => entry.id === artifact.id)).toBe(true);
    expect(appStateStore.getState().tasks.find((task) => task.id === 'task-artifact')?.artifactIds).toContain(artifact.id);

    const deleted = await deleteTool.execute({ artifactId: artifact.id }, context);
    expect(deleted.summary).toBe('Deleted Weekly Research Note');
    expect((await listTool.execute({}, context)).data.artifacts).toEqual([]);
  });

  it('uses the active artifact fallback and rejects html append', async () => {
    const { createArtifactToolDefinitions } = await import('./artifactTools');

    const tools = createArtifactToolDefinitions();
    const createTool = tools.find((tool) => tool.name === 'artifact.create')!;
    const readActiveTool = tools.find((tool) => tool.name === 'artifact.get_active')!;
    const replaceTool = tools.find((tool) => tool.name === 'artifact.replace_content')!;
    const appendTool = tools.find((tool) => tool.name === 'artifact.append_content')!;

    const context = {
      runId: 'run-2',
      agentId: 'gpt-5.4',
      mode: 'unrestricted-dev' as const,
      taskId: undefined,
    };

    const created = await createTool.execute({
      title: 'Landing Page',
      format: 'html',
    }, context);
    const artifact = created.data.artifact as { id: string };

    const active = await readActiveTool.execute({}, context);
    expect(active.data.artifact.id).toBe(artifact.id);

    await replaceTool.execute({ content: '<main>hello</main>' }, context);
    await expect(appendTool.execute({ content: '<footer>nope</footer>' }, context)).rejects.toThrow(
      'Append is not supported for html artifacts.',
    );
  });
});
