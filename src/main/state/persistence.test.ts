import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRIMARY_PROVIDER_ID } from '../../shared/types/model';

vi.mock('electron', () => ({
  app: {
    getPath: () => process.env.V2_TEST_USER_DATA || os.tmpdir(),
  },
}));

import { buildInitialState } from './persistence';

describe('buildInitialState', () => {
  let userDataDir = '';

  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-persist-user-data-'));
    process.env.V2_TEST_USER_DATA = userDataDir;
  });

  afterEach(() => {
    delete process.env.V2_TEST_USER_DATA;
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it('restores codex task ownership from persisted state', () => {
    const statePath = path.join(userDataDir, 'workspace-state.json');
    fs.writeFileSync(statePath, JSON.stringify({
      executionSplit: { preset: 'balanced', ratio: 0.5 },
      windows: {
        command: { role: 'command', bounds: { x: 0, y: 0, width: 800, height: 600 }, isVisible: true, isFocused: false, displayId: 0 },
        execution: { role: 'execution', bounds: { x: 100, y: 100, width: 1200, height: 800 }, isVisible: true, isFocused: false, displayId: 0 },
      },
      tasks: [
        {
          id: 'task-1',
          title: 'Codex task',
          status: 'completed',
          owner: PRIMARY_PROVIDER_ID,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      activeTaskId: 'task-1',
    }), 'utf-8');

    const state = buildInitialState();

    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].owner).toBe(PRIMARY_PROVIDER_ID);
    expect(state.activeTaskId).toBe('task-1');
  });
});
