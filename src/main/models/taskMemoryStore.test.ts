import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => process.env.V2_TEST_USER_DATA || os.tmpdir(),
  },
}));

import { TaskMemoryStore } from './taskMemoryStore';

describe('TaskMemoryStore', () => {
  let userDataDir = '';

  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-task-memory-user-data-'));
    process.env.V2_TEST_USER_DATA = userDataDir;
  });

  afterEach(() => {
    delete process.env.V2_TEST_USER_DATA;
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it('keeps attachment summaries in task context even for image-only turns', () => {
    const store = new TaskMemoryStore();
    store.recordUserPrompt('task-1', '', {
      attachmentSummary: '[Attached image: diagram.png]',
      attachments: [{
        type: 'image',
        mediaType: 'image/png',
        data: 'ZmFrZQ==',
        name: 'diagram.png',
      }],
    });

    const context = store.buildContext('task-1');
    const entry = store.get('task-1').entries[0];

    expect(context).toContain('User: [Attached image: diagram.png]');
    expect(entry.metadata?.attachments).toBeTruthy();
  });

  it('renders a compact current state before recent history', () => {
    const store = new TaskMemoryStore();
    store.recordUserPrompt('task-2', 'Create a rollout plan.');
    store.recordInvocationResult({
      taskId: 'task-2',
      providerId: 'gpt-5.4',
      success: true,
      output: 'Draft plan: discovery, migration, rollout.',
      usage: { inputTokens: 1, outputTokens: 1, durationMs: 1 },
    } as any);
    store.recordUserPrompt('task-2', 'Add rollback criteria.');

    const context = store.buildContext('task-2');

    expect(context).toContain('### Current State');
    expect(context).toContain('Latest user request: Add rollback criteria.');
    expect(context).toContain('Latest model result: Draft plan: discovery, migration, rollout.');
    expect(context).toContain('### Recent History');
    expect(context).toContain('User: Create a rollout plan.');
  });
});
