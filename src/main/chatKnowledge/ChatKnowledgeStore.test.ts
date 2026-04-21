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

  it('can omit the live user turn when the prompt already carries it', () => {
    const store = new ChatKnowledgeStore();
    const taskId = 'task-chat-context-no-echo';

    store.recordAssistantMessage(taskId, 'Previous answer with the earlier plan.');
    const current = store.recordUserMessage(taskId, 'Follow the same plan but include tests.');

    const context = store.buildInvocationContext(taskId, current.id, { includeCurrentMessage: false });

    expect(context).not.toContain('### Current User Message');
    expect(context).toContain('### Recent Prior Messages');
    expect(context).toContain('Previous answer with the earlier plan.');
  });

  describe('listPriorTurns', () => {
    it('returns chronological role-tagged chat turns, excluding the current user message', () => {
      const store = new ChatKnowledgeStore();
      const taskId = 'task-prior-turns';

      store.recordUserMessage(taskId, 'What does the memory system do?');
      store.recordAssistantMessage(taskId, 'It caches chat turns on disk and injects recent context.');
      const current = store.recordUserMessage(taskId, 'OK now how does auto-invalidation work?');

      const turns = store.listPriorTurns(taskId, { excludeMessageIds: [current.id] });

      expect(turns).toEqual([
        { role: 'user', content: 'What does the memory system do?' },
        { role: 'assistant', content: 'It caches chat turns on disk and injects recent context.' },
      ]);
    });

    it('skips tool and system messages, keeping only real chat roles', () => {
      const store = new ChatKnowledgeStore();
      const taskId = 'task-prior-turns-filter';

      store.recordUserMessage(taskId, 'Run the thing.');
      store.recordToolMessage(taskId, 'terminal output noise');
      store.recordAssistantMessage(taskId, 'Done, here is the result.');

      const turns = store.listPriorTurns(taskId);

      expect(turns).toEqual([
        { role: 'user', content: 'Run the thing.' },
        { role: 'assistant', content: 'Done, here is the result.' },
      ]);
    });

    it('trims the oldest turns first when total content exceeds maxChars', () => {
      const store = new ChatKnowledgeStore();
      const taskId = 'task-prior-turns-trim';

      // Use clearly differentiated content so we can assert which turn survived.
      store.recordUserMessage(taskId, 'OLDEST_USER ' + 'a'.repeat(200));
      store.recordAssistantMessage(taskId, 'OLDEST_ASSISTANT ' + 'b'.repeat(200));
      store.recordUserMessage(taskId, 'NEWEST_USER ' + 'c'.repeat(200));

      const turns = store.listPriorTurns(taskId, { maxChars: 300 });

      // Most recent turn must survive; oldest drops first.
      expect(turns.length).toBeGreaterThanOrEqual(1);
      expect(turns[turns.length - 1].content.startsWith('NEWEST_USER')).toBe(true);
      expect(turns.some((turn) => turn.content.startsWith('OLDEST_USER'))).toBe(false);
    });

    it('returns an empty list for a task with no prior messages', () => {
      const store = new ChatKnowledgeStore();
      expect(store.listPriorTurns('task-empty')).toEqual([]);
    });
  });
});
