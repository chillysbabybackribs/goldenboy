import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => process.env.V2_TEST_USER_DATA || os.tmpdir(),
  },
}));

import { createMemoryToolDefinitions } from './index';
import { taskMemoryStore } from '../../../models/taskMemoryStore';

describe('memory.plan_update', () => {
  let userDataDir = '';

  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-memory-tool-user-data-'));
    process.env.V2_TEST_USER_DATA = userDataDir;
    taskMemoryStore.clearTask('task-memory-tool');
    taskMemoryStore.recordUserPrompt('task-memory-tool', [
      'Slice 1:',
      '1. Add structured build tool',
      '2. Add structured test tool',
      '3. Add scratchpad recall',
    ].join('\n'));
  });

  afterEach(() => {
    taskMemoryStore.clearTask('task-memory-tool');
    delete process.env.V2_TEST_USER_DATA;
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it('starts a targeted checklist item', async () => {
    const tool = createMemoryToolDefinitions().find((item) => item.name === 'memory.plan_update');
    expect(tool).toBeTruthy();

    const result = await tool!.execute(
      { action: 'start_item', itemId: '2' },
      { runId: 'run_1', agentId: 'agent_1', mode: 'unrestricted-dev', taskId: 'task-memory-tool' },
    );

    expect(result.summary).toBe('Updated active checklist via start_item');
    expect(result.data.updated).toMatchObject({
      id: '2',
      status: 'in_progress',
    });
    expect(result.data.after).toMatchObject({
      currentItemId: '2',
    });
  });

  it('completes the current checklist item and advances the next one', async () => {
    const tool = createMemoryToolDefinitions().find((item) => item.name === 'memory.plan_update');
    expect(tool).toBeTruthy();

    await tool!.execute(
      { action: 'start_item', itemId: '2' },
      { runId: 'run_1', agentId: 'agent_1', mode: 'unrestricted-dev', taskId: 'task-memory-tool' },
    );
    const result = await tool!.execute(
      { action: 'complete_current' },
      { runId: 'run_1', agentId: 'agent_1', mode: 'unrestricted-dev', taskId: 'task-memory-tool' },
    );

    expect(result.data.updated).toEqual({
      completedItemId: '2',
      nextItemId: '3',
    });
    expect(result.data.after).toMatchObject({
      currentItemId: '3',
      items: [
        expect.objectContaining({ id: '1', status: 'pending' }),
        expect.objectContaining({ id: '2', status: 'completed' }),
        expect.objectContaining({ id: '3', status: 'in_progress' }),
      ],
    });
  });
});
