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

  it('auto-captures 3+ step user lists into an active checklist and scratchpad', () => {
    const store = new TaskMemoryStore();
    store.recordUserPrompt('task-3b', [
      'Prompt optimization queue:',
      '1. Add structured build verification',
      '2. Add structured test verification',
      '3. Persist active-plan scratchpad state',
    ].join('\n'));

    const snapshot = store.getPlanSnapshot('task-3b');
    const context = store.buildContext('task-3b');
    const scratchpadPath = path.join(userDataDir, 'task-scratchpads', 'task-3b.md');

    expect(snapshot?.activeChecklist).toMatchObject({
      planName: 'Prompt optimization queue',
      currentItemId: '1',
      items: [
        { id: '1', text: 'Add structured build verification', status: 'pending' },
        { id: '2', text: 'Add structured test verification', status: 'pending' },
        { id: '3', text: 'Persist active-plan scratchpad state', status: 'pending' },
      ],
    });
    expect(context).toContain('### Active Checklist');
    expect(context).toContain('[pending] 2. Add structured test verification');
    expect(fs.existsSync(scratchpadPath)).toBe(true);
    expect(fs.readFileSync(scratchpadPath, 'utf-8')).toContain('## Active Checklist');
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

  it('surfaces active checklist items in the plan snapshot for continuity', () => {
    const store = new TaskMemoryStore();
    store.recordPlan('task-6', 'Captured checklist: Slice 1 | items=3', {
      category: 'plan',
      stage: 'checklist-captured',
      planId: 'plan_1',
      planName: 'Slice 1',
      currentItemId: '1',
      items: [
        { id: '1', text: 'Add structured build tool', status: 'completed' },
        { id: '2', text: 'Add structured test tool', status: 'pending' },
        { id: '3', text: 'Add scratchpad recall', status: 'pending' },
      ],
      nextAction: 'Add structured test tool',
    });

    const context = store.buildPlanContext('task-6');
    const snapshot = store.getPlanSnapshot('task-6');

    expect(context).toContain('Next action: Add structured test tool');
    expect(snapshot?.activeChecklist?.items[1]).toMatchObject({
      id: '2',
      text: 'Add structured test tool',
      status: 'pending',
    });
  });

  it('progresses the active checklist one item at a time', () => {
    const store = new TaskMemoryStore();
    store.recordUserPrompt('task-7', [
      'Slice 1:',
      '1. Add structured build tool',
      '2. Add structured test tool',
      '3. Add scratchpad recall',
    ].join('\n'));

    const started = store.beginActiveChecklistItem('task-7', 'user said continue');
    const afterStart = store.getPlanSnapshot('task-7');
    const completed = store.completeActiveChecklistItem('task-7', 'implementation turn succeeded');
    const afterComplete = store.getPlanSnapshot('task-7');

    expect(started).toMatchObject({
      id: '1',
      text: 'Add structured build tool',
      status: 'in_progress',
    });
    expect(afterStart?.activeChecklist?.items[0]).toMatchObject({
      id: '1',
      status: 'in_progress',
    });
    expect(completed).toEqual({
      completedItemId: '1',
      nextItemId: '2',
    });
    expect(afterComplete?.activeChecklist).toMatchObject({
      currentItemId: '2',
    });
    expect(afterComplete?.activeChecklist?.items).toEqual([
      expect.objectContaining({ id: '1', status: 'completed' }),
      expect.objectContaining({ id: '2', status: 'in_progress' }),
      expect.objectContaining({ id: '3', status: 'pending' }),
    ]);
  });

  it('can target a specific checklist item without rewriting the whole list', () => {
    const store = new TaskMemoryStore();
    store.recordUserPrompt('task-8', [
      'Slice 1:',
      '1. Add structured build tool',
      '2. Add structured test tool',
      '3. Add scratchpad recall',
    ].join('\n'));

    const targeted = store.beginSpecificChecklistItem('task-8', '2', { reason: 'user said do #2' });
    const afterTarget = store.getPlanSnapshot('task-8');
    const completed = store.completeActiveChecklistItem('task-8', 'item 2 done');
    const afterComplete = store.getPlanSnapshot('task-8');

    expect(targeted).toMatchObject({
      id: '2',
      text: 'Add structured test tool',
      status: 'in_progress',
    });
    expect(afterTarget?.activeChecklist?.items).toEqual([
      expect.objectContaining({ id: '1', status: 'pending' }),
      expect.objectContaining({ id: '2', status: 'in_progress' }),
      expect.objectContaining({ id: '3', status: 'pending' }),
    ]);
    expect(completed).toEqual({
      completedItemId: '2',
      nextItemId: '3',
    });
    expect(afterComplete?.activeChecklist?.items).toEqual([
      expect.objectContaining({ id: '1', status: 'pending' }),
      expect.objectContaining({ id: '2', status: 'completed' }),
      expect.objectContaining({ id: '3', status: 'in_progress' }),
    ]);
  });

  it('can skip earlier pending checklist items when retargeting ahead', () => {
    const store = new TaskMemoryStore();
    store.recordUserPrompt('task-9', [
      'Slice 1:',
      '1. Add structured build tool',
      '2. Add structured test tool',
      '3. Add scratchpad recall',
    ].join('\n'));

    const targeted = store.beginSpecificChecklistItem('task-9', '3', {
      skipPriorPending: true,
      reason: 'user said skip 1 and 2, start 3',
    });
    const snapshot = store.getPlanSnapshot('task-9');

    expect(targeted).toMatchObject({
      id: '3',
      status: 'in_progress',
    });
    expect(snapshot?.activeChecklist?.items).toEqual([
      expect.objectContaining({ id: '1', status: 'dropped' }),
      expect.objectContaining({ id: '2', status: 'dropped' }),
      expect.objectContaining({ id: '3', status: 'in_progress' }),
    ]);
  });

  it('can target a checklist item by text from the user prompt', () => {
    const store = new TaskMemoryStore();
    store.recordUserPrompt('task-10', [
      'Slice 1:',
      '1. Add structured build tool',
      '2. Add structured test tool',
      '3. Add scratchpad recall',
    ].join('\n'));

    const targeted = store.beginChecklistItemForPrompt('task-10', 'do the scratchpad one', 'user prompt');
    const snapshot = store.getPlanSnapshot('task-10');

    expect(targeted).toMatchObject({
      id: '3',
      text: 'Add scratchpad recall',
      status: 'in_progress',
    });
    expect(snapshot?.activeChecklist?.currentItemId).toBe('3');
  });

  it('can skip a named earlier step and start a later named one', () => {
    const store = new TaskMemoryStore();
    store.recordUserPrompt('task-11', [
      'Slice 1:',
      '1. Add structured build tool',
      '2. Add structured test tool',
      '3. Add scratchpad recall',
    ].join('\n'));

    const targeted = store.beginChecklistItemForPrompt('task-11', 'skip the build step and do tests', 'user prompt');
    const snapshot = store.getPlanSnapshot('task-11');

    expect(targeted).toMatchObject({
      id: '2',
      text: 'Add structured test tool',
      status: 'in_progress',
    });
    expect(snapshot?.activeChecklist?.items).toEqual([
      expect.objectContaining({ id: '1', status: 'dropped' }),
      expect.objectContaining({ id: '2', status: 'in_progress' }),
      expect.objectContaining({ id: '3', status: 'pending' }),
    ]);
  });
});
