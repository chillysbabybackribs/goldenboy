import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => process.env.V2_TEST_USER_DATA || os.tmpdir(),
  },
}));

import { ChatKnowledgeStore } from './ChatKnowledgeStore';

describe('ChatKnowledgeStore', () => {
  let userDataDir = '';

  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-chat-cache-user-data-'));
    process.env.V2_TEST_USER_DATA = userDataDir;
  });

  afterEach(() => {
    delete process.env.V2_TEST_USER_DATA;
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it('includes the live user turn alongside prior thread context', () => {
    const store = new ChatKnowledgeStore();
    const taskId = 'task-chat-context';

    store.recordAssistantMessage(taskId, 'Previous answer with the earlier plan.');
    const current = store.recordUserMessage(taskId, 'Follow the same plan but include tests.');

    const context = store.buildInvocationContext(taskId, current.id);

    expect(context).toContain('### Current User Message');
    expect(context).toContain('Follow the same plan but include tests.');
    expect(context).toContain('### Recent Prior Messages');
    expect(context).toContain('Previous answer with the earlier plan.');
  });
});
