import { describe, it, expect } from 'vitest';
import { pruneExpiredEntries } from './AppServerProvider';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

describe('thread registry persistence helpers', () => {
  describe('pruneExpiredEntries', () => {
    it('removes entries older than 7 days', () => {
      const now = Date.now();
      const entries = {
        'task-old': { threadId: 'thread-old', savedAt: now - SEVEN_DAYS_MS - 1 },
        'task-new': { threadId: 'thread-new', savedAt: now - 1000 },
      };
      const pruned = pruneExpiredEntries(entries, now);
      expect(pruned['task-old']).toBeUndefined();
      expect(pruned['task-new']).toBeDefined();
    });

    it('keeps entries exactly at 7 days boundary', () => {
      const now = Date.now();
      const entries = {
        'task-boundary': { threadId: 'thread-b', savedAt: now - SEVEN_DAYS_MS },
      };
      const pruned = pruneExpiredEntries(entries, now);
      expect(pruned['task-boundary']).toBeDefined();
    });
  });
});

describe('MCP name translation', () => {
  it('dots become __ (round-trip)', () => {
    expect('filesystem.list'.replace(/\./g, '__')).toBe('filesystem__list');
    expect('filesystem__list'.replace(/__/g, '.')).toBe('filesystem.list');
  });
});
