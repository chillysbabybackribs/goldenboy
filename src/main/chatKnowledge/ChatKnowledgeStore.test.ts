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
    expect(context).toContain('### Recent Conversation');
    expect(context).toContain('Assistant: Previous answer with the earlier plan.');
  });

  it('builds silent hydration context without explicit transcript headings', () => {
    const store = new ChatKnowledgeStore();
    const taskId = 'task-silent-hydration';

    store.recordUserMessage(taskId, 'Start a rollout plan for the migration.');
    store.recordAssistantMessage(taskId, 'Draft plan: discovery, migration, rollout.', 'gpt-5.4');
    const current = store.recordUserMessage(taskId, 'Continue this and add risks for rollout.');

    const context = store.buildSilentHydrationContext(taskId, {
      need: 'full',
      currentMessageId: current.id,
      excludeToolResults: true,
    });

    expect(context).toContain('The task began with the request: Start a rollout plan for the migration.');
    expect(context).toContain('The latest assistant result was: Draft plan: discovery, migration, rollout.');
    expect(context).toContain('Earlier, the user said: Start a rollout plan for the migration.');
    expect(context).toContain('Then, the assistant replied: Draft plan: discovery, migration, rollout.');
    expect(context).not.toContain('## Conversation Context');
    expect(context).not.toContain('Initial goal:');
    expect(context).not.toContain('User: ');
    expect(context).not.toContain('Assistant (gpt-5.4):');
  });
});
