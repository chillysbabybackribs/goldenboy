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

  it('persists compact plan state separately from chronological history', () => {
    const store = new TaskMemoryStore();
    store.recordUserPrompt('task-2', 'Plan a repo-wide migration');
    store.recordPlan('task-2', 'Objective: migrate safely. Tracks: prompt contract, scope policy, tests.', {
      category: 'plan',
      stage: 'scaffold',
      objective: 'migrate safely',
      tracks: ['prompt contract', 'scope policy', 'tests'],
      nextAction: 'patch prompt contract',
    });

    const context = store.buildContext('task-2');

    expect(store.hasPlan('task-2')).toBe(true);
    expect(context).toContain('### Planning State');
    expect(context).toContain('**Plans:** Plan: Objective: migrate safely. Tracks: prompt contract, scope policy, tests.');
    expect(context).toContain('### History');
  });

  it('tracks whether a task has plan entries', () => {
    const store = new TaskMemoryStore();
    expect(store.hasPlan('task-3')).toBe(false);

    store.recordPlan('task-3', 'Objective: coordinate execution.');

    expect(store.hasPlan('task-3')).toBe(true);
  });

  it('builds a focused plan continuation context with the latest milestone first', () => {
    const store = new TaskMemoryStore();
    store.recordPlan('task-4', 'Objective: coordinate execution.', {
      category: 'plan',
      stage: 'scaffold',
      objective: 'coordinate execution',
      tracks: ['runtime scope', 'tests'],
      delegation: ['research sub-agent'],
      validation: ['observed runtime events'],
    });
    store.recordPlan('task-4', 'Sub-agent research running | task="Inspect renderer build pipeline"', {
      category: 'plan',
      stage: 'subagent-spawn',
      role: 'research',
      subagentId: 'sub_1',
      task: 'Inspect renderer build pipeline',
      status: 'running',
    });
    store.recordPlan('task-4', 'Parent completed orchestration turn | Tracks: runtime scope | Next action: patch prompt assembly.', {
      category: 'plan',
      stage: 'parent-turn-complete',
      tracks: ['runtime scope'],
      nextAction: 'patch prompt assembly',
    });

    const context = store.buildPlanContext('task-4');

    expect(context).toContain('## Plan Continuation');
    expect(context).toContain('Latest milestone: Plan: Parent completed orchestration turn | Tracks: runtime scope | Next action: patch prompt assembly.');
    expect(context).toContain('Objective: coordinate execution');
    expect(context).toContain('Next action: patch prompt assembly');
    expect(context).toContain('Tracks: runtime scope | tests');
    expect(context).toContain('Delegation: research sub-agent');
    expect(context).toContain('Validation: observed runtime events');
    expect(context).toContain('- Plan: Objective: coordinate execution.');
    expect(context).toContain('- Plan: Sub-agent research running | task="Inspect renderer build pipeline"');
  });

  it('builds a structured plan snapshot for runtime decision support', () => {
    const store = new TaskMemoryStore();
    store.recordPlan('task-5', 'Objective: coordinate execution.', {
      category: 'plan',
      stage: 'scaffold',
      objective: 'coordinate execution',
      tracks: ['runtime scope', 'tests'],
      delegation: ['research sub-agent'],
      validation: ['observed runtime events'],
      nextAction: 'wait for research findings',
    });
    store.recordPlan('task-5', 'Sub-agent research running | task="Inspect renderer build pipeline"', {
      category: 'plan',
      stage: 'subagent-spawn',
      role: 'research',
      subagentId: 'sub_running',
      task: 'Inspect renderer build pipeline',
      status: 'running',
    });
    store.recordPlan('task-5', 'Sub-agent code failed | task="Patch prompt assembly" | blockers=Type error', {
      category: 'plan',
      stage: 'subagent-failed',
      role: 'code',
      subagentId: 'sub_failed',
      task: 'Patch prompt assembly',
      status: 'failed',
      blockers: ['Type error'],
    });
    store.recordPlan('task-5', 'Sub-agent review completed | task="Review orchestration scope"', {
      category: 'plan',
      stage: 'subagent-complete',
      role: 'review',
      subagentId: 'sub_done',
      task: 'Review orchestration scope',
      status: 'completed',
    });

    const snapshot = store.getPlanSnapshot('task-5');

    expect(snapshot).toMatchObject({
      objective: 'coordinate execution',
      nextAction: 'wait for research findings',
      latestStage: 'subagent-complete',
      tracks: ['runtime scope', 'tests'],
      delegation: ['research sub-agent'],
      validation: ['observed runtime events'],
    });
    expect(snapshot?.runningSubagents).toEqual([
      { role: 'research', task: 'Inspect renderer build pipeline', subagentId: 'sub_running' },
    ]);
    expect(snapshot?.blockedSubagents).toEqual([
      { role: 'code', task: 'Patch prompt assembly', blockers: ['Type error'] },
    ]);
    expect(snapshot?.completedSubagents).toEqual([
      { role: 'review', task: 'Review orchestration scope' },
    ]);
  });
});
