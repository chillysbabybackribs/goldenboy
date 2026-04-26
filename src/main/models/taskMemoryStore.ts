import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { generateId } from '../../shared/utils/ids';
import type {
  InvocationResult,
  TaskMemoryEntry,
  TaskMemoryEntryKind,
  TaskPlanMetadata,
  TaskMemoryRecord,
} from '../../shared/types/model';
import { createEmptyTaskMemoryRecord } from '../../shared/types/model';
import type { BrowserFinding } from '../../shared/types/browserIntelligence';

const TASK_MEMORY_FILE = 'task-memory.json';
const TASK_SCRATCHPAD_DIR = 'task-scratchpads';
const MAX_ENTRIES_PER_TASK = 200;
const MAX_CONTEXT_ENTRIES = 10;
const MAX_CONTEXT_CHARS = 2000;
const MAX_PLAN_CONTEXT_ENTRIES = 6;
const MAX_PLAN_CONTEXT_CHARS = 1200;
const NUMBER_WORDS = new Set([
  'zero', 'one', 'two', 'three', 'four', 'five', 'six',
  'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
]);
const CHECKLIST_TARGET_STOP_WORDS = new Set([
  'a', 'an', 'and', 'begin', 'build', 'do', 'for', 'handle', 'implement', 'item',
  'next', 'one', 'on', 'start', 'step', 'take', 'the', 'this', 'work',
]);

function getTaskMemoryPath(): string {
  return path.join(app.getPath('userData'), TASK_MEMORY_FILE);
}

function getTaskScratchpadDir(): string {
  return path.join(app.getPath('userData'), TASK_SCRATCHPAD_DIR);
}

function safeTaskSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function getTaskScratchpadPath(taskId: string): string {
  return path.join(getTaskScratchpadDir(), `${safeTaskSegment(taskId)}.md`);
}

function loadMemory(): TaskMemoryRecord[] {
  try {
    const filePath = getTaskMemoryPath();
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as TaskMemoryRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveMemory(records: TaskMemoryRecord[]): void {
  try {
    fs.writeFileSync(getTaskMemoryPath(), JSON.stringify(records, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to persist task memory:', err);
  }
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

export class TaskMemoryStore {
  private memoryByTask = new Map<string, TaskMemoryRecord>();

  constructor() {
    for (const record of loadMemory()) {
      if (record?.taskId) {
        this.memoryByTask.set(record.taskId, record);
      }
    }
  }

  get(taskId: string): TaskMemoryRecord {
    return this.memoryByTask.get(taskId) || createEmptyTaskMemoryRecord(taskId);
  }

  getLatestUserPrompt(taskId: string): string | null {
    const latest = [...this.get(taskId).entries].reverse().find((entry) => entry.kind === 'user_prompt');
    return latest?.text?.trim() || null;
  }

  clearTask(taskId: string): void {
    if (!this.memoryByTask.has(taskId)) return;
    this.memoryByTask.delete(taskId);
    saveMemory(Array.from(this.memoryByTask.values()));
    try {
      fs.rmSync(getTaskScratchpadPath(taskId), { force: true });
    } catch {
      // Ignore scratchpad cleanup failures.
    }
  }

  hasEntries(taskId: string): boolean {
    const record = this.memoryByTask.get(taskId);
    return !!record && record.entries.length > 0;
  }

  getCategoryCounts(taskId: string): { claim: number; evidence: number; critique: number; verification: number } {
    const memory = this.get(taskId);
    return memory.entries.reduce((counts, entry) => {
      const category = typeof entry.metadata?.category === 'string' ? entry.metadata.category : '';
      if (category === 'claim' || category === 'evidence' || category === 'critique' || category === 'verification') {
        counts[category] += 1;
      }
      return counts;
    }, { claim: 0, evidence: 0, critique: 0, verification: 0 });
  }

  getReasoningTexts(taskId: string, categories?: Array<'claim' | 'evidence' | 'critique' | 'verification'>): string[] {
    const allowed = categories ? new Set(categories) : null;
    return this.get(taskId).entries
      .filter((entry) => {
        const category = typeof entry.metadata?.category === 'string' ? entry.metadata.category : '';
        return !!category && (!allowed || allowed.has(category as 'claim' | 'evidence' | 'critique' | 'verification'));
      })
      .map(entry => entry.text);
  }

  findEvidenceConsistencyIssues(taskId: string, output: string): string[] {
    const supportCorpus = this.getReasoningTexts(taskId, ['claim', 'evidence']).join(' ').toLowerCase();
    if (!supportCorpus.trim() || !output.trim()) return [];

    const issues = new Set<string>();
    const normalizedOutput = output.toLowerCase();
    const numericTokens = normalizedOutput.match(/\b\d+\b/g) || [];
    for (const token of numericTokens) {
      if (!supportCorpus.includes(token)) {
        issues.add(`Final answer uses unsupported numeric detail "${token}".`);
      }
    }

    const wordTokens = normalizedOutput.match(/\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g) || [];
    for (const token of wordTokens) {
      if (NUMBER_WORDS.has(token) && !supportCorpus.includes(token)) {
        issues.add(`Final answer uses unsupported spelled-out numeric detail "${token}".`);
      }
    }

    return Array.from(issues);
  }

  hasPlan(taskId: string): boolean {
    return this.get(taskId).entries.some(
      (entry) => entry.kind === 'system' && this.isPlanMetadata(entry.metadata),
    );
  }

  buildPlanContext(taskId: string): string | null {
    const plans = this.get(taskId).entries
      .filter((entry): entry is TaskMemoryEntry & { metadata: TaskPlanMetadata } => (
        entry.kind === 'system' && this.isPlanMetadata(entry.metadata)
      ))
      .slice(-MAX_PLAN_CONTEXT_ENTRIES);

    if (plans.length === 0) return null;

    const latest = plans[plans.length - 1];
    const previous = plans.slice(0, -1);
    const sections = [
      '## Plan Continuation',
      `Latest milestone: ${this.formatPlanEntry(latest)}`,
    ];

    const latestState = this.buildStructuredPlanState(taskId);
    if (latestState.objective) sections.push(`Objective: ${latestState.objective}`);
    if (latestState.nextAction) sections.push(`Next action: ${latestState.nextAction}`);
    if (latestState.activeChecklist?.items.length) {
      sections.push('Active checklist:');
      sections.push(...latestState.activeChecklist.items.map((item) => (
        `- [${item.status === 'completed' ? 'x' : item.status === 'in_progress' ? '>' : item.status === 'blocked' ? '!' : item.status === 'dropped' ? '~' : ' '}] ${item.id}. ${item.text}`
      )));
    }
    if (latestState.tracks.length > 0) sections.push(`Tracks: ${latestState.tracks.join(' | ')}`);
    if (latestState.delegation.length > 0) sections.push(`Delegation: ${latestState.delegation.join(' | ')}`);
    if (latestState.validation.length > 0) sections.push(`Validation: ${latestState.validation.join(' | ')}`);

    if (previous.length > 0) {
      sections.push('Recent milestones:');
      sections.push(...previous.map((plan) => `- ${this.formatPlanEntry(plan)}`));
    }

    let context = sections.join('\n');
    if (context.length > MAX_PLAN_CONTEXT_CHARS) {
      context = `${context.slice(0, MAX_PLAN_CONTEXT_CHARS)}\n...[plan context truncated]`;
    }
    return context;
  }

  getPlanSnapshot(taskId: string): {
    objective: string | null;
    tracks: string[];
    delegation: string[];
    validation: string[];
    nextAction: string | null;
    latestStage: TaskPlanMetadata['stage'] | null;
    activeChecklist: {
      planId: string | null;
      planName: string | null;
      currentItemId: string | null;
      items: Array<{
        id: string;
        text: string;
        status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'dropped';
        notes?: string;
      }>;
    } | null;
    runningSubagents: Array<{ role: string; task: string; subagentId: string }>;
    blockedSubagents: Array<{ role: string; task: string; blockers: string[] }>;
    completedSubagents: Array<{ role: string; task: string }>;
    } | null {
    const planEntries = this.get(taskId).entries
      .filter((entry): entry is TaskMemoryEntry & { metadata: TaskPlanMetadata } => (
        entry.kind === 'system' && this.isPlanMetadata(entry.metadata)
      ));

    if (planEntries.length === 0) return null;

    const state = this.buildStructuredPlanState(taskId);
    const latestMetadata = planEntries[planEntries.length - 1]?.metadata;
    const runningSubagents: Array<{ role: string; task: string; subagentId: string }> = [];
    const blockedSubagents: Array<{ role: string; task: string; blockers: string[] }> = [];
    const completedSubagents: Array<{ role: string; task: string }> = [];
    const latestBySubagent = new Map<string, TaskPlanMetadata>();

    for (const entry of planEntries) {
      const metadata = entry.metadata;
      if (metadata.subagentId) latestBySubagent.set(metadata.subagentId, metadata);
    }

    for (const metadata of latestBySubagent.values()) {
      const role = metadata.role?.trim();
      const task = metadata.task?.trim();
      if (!role || !task) continue;
      if (metadata.status === 'running' && metadata.subagentId) {
        runningSubagents.push({ role, task, subagentId: metadata.subagentId });
      } else if (metadata.status === 'failed' || metadata.status === 'cancelled') {
        blockedSubagents.push({ role, task, blockers: metadata.blockers || [] });
      } else if (metadata.status === 'completed') {
        completedSubagents.push({ role, task });
      }
    }

    return {
      ...state,
      latestStage: latestMetadata?.stage || null,
      activeChecklist: this.getActiveChecklist(taskId),
      runningSubagents,
      blockedSubagents,
      completedSubagents,
    };
  }

  recordUserPrompt(taskId: string, text: string, metadata?: Record<string, unknown>): TaskMemoryRecord {
    const record = this.append(taskId, {
      id: generateId('mem'),
      taskId,
      kind: 'user_prompt',
      text,
      createdAt: Date.now(),
      metadata,
    });
    return this.captureChecklistPlan(taskId, text, 'user_prompt') ?? record;
  }

  recordInvocationResult(result: InvocationResult): TaskMemoryRecord {
    const record = this.append(result.taskId, {
      id: generateId('mem'),
      taskId: result.taskId,
      kind: 'model_result',
      text: result.status === 'cancelled'
        ? (result.error || 'Task cancelled by user.')
        : (result.success ? result.output : (result.error || 'Invocation failed')),
      providerId: result.providerId,
      createdAt: Date.now(),
      metadata: {
        success: result.success,
        status: result.status,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        durationMs: result.usage.durationMs,
      },
    });
    return this.captureChecklistPlan(result.taskId, result.output, 'model_result') ?? record;
  }

  recordBrowserFinding(finding: BrowserFinding): TaskMemoryRecord {
    return this.append(finding.taskId, {
      id: generateId('mem'),
      taskId: finding.taskId,
      kind: 'browser_finding',
      text: `${finding.title}: ${finding.summary}`,
      createdAt: Date.now(),
      metadata: {
        tabId: finding.tabId,
        severity: finding.severity,
        snapshotId: finding.snapshotId,
        evidence: finding.evidence,
      },
    });
  }

  recordClaim(taskId: string, text: string, metadata?: Record<string, unknown>): TaskMemoryRecord {
    return this.append(taskId, {
      id: generateId('mem'),
      taskId,
      kind: 'system',
      text: `Claim: ${text}`,
      createdAt: Date.now(),
      metadata: { category: 'claim', ...metadata },
    });
  }

  recordEvidence(taskId: string, text: string, metadata?: Record<string, unknown>): TaskMemoryRecord {
    return this.append(taskId, {
      id: generateId('mem'),
      taskId,
      kind: 'system',
      text: `Evidence: ${text}`,
      createdAt: Date.now(),
      metadata: { category: 'evidence', ...metadata },
    });
  }

  recordCritique(taskId: string, text: string, metadata?: Record<string, unknown>): TaskMemoryRecord {
    return this.append(taskId, {
      id: generateId('mem'),
      taskId,
      kind: 'system',
      text: `Critique: ${text}`,
      createdAt: Date.now(),
      metadata: { category: 'critique', ...metadata },
    });
  }

  recordVerification(taskId: string, text: string, metadata?: Record<string, unknown>): TaskMemoryRecord {
    return this.append(taskId, {
      id: generateId('mem'),
      taskId,
      kind: 'system',
      text: `Verification: ${text}`,
      createdAt: Date.now(),
      metadata: { category: 'verification', ...metadata },
    });
  }

  recordPlan(taskId: string, text: string, metadata?: Record<string, unknown>): TaskMemoryRecord {
    const normalizedMetadata = this.isPlanMetadata(metadata)
      ? metadata
      : undefined;
    const planMetadata: TaskPlanMetadata = {
      category: 'plan',
      scratchpadPath: getTaskScratchpadPath(taskId),
      stage: normalizedMetadata?.stage || 'scaffold',
      ...(normalizedMetadata || {}),
    };
    return this.append(taskId, {
      id: generateId('mem'),
      taskId,
      kind: 'system',
      text: `Plan: ${text}`,
      createdAt: Date.now(),
      metadata: planMetadata,
    });
  }

  beginActiveChecklistItem(taskId: string, reason?: string): {
    id: string;
    text: string;
    status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'dropped';
  } | null {
    const checklistEntry = this.getLatestChecklistEntry(taskId);
    if (!checklistEntry) return null;

    const items = checklistEntry.metadata.items?.map((item) => ({ ...item })) || [];
    const existingInProgress = items.find((item) => item.status === 'in_progress');
    if (existingInProgress) {
      return { ...existingInProgress };
    }

    const nextPending = items.find((item) => item.status === 'pending');
    if (!nextPending) return null;

    nextPending.status = 'in_progress';
    this.recordChecklistUpdate(
      taskId,
      checklistEntry,
      items,
      nextPending.id,
      nextPending.text,
      `Checklist update | started ${nextPending.id}. ${nextPending.text}${reason ? ` | ${reason}` : ''}`,
    );

    return { ...nextPending };
  }

  beginSpecificChecklistItem(
    taskId: string,
    itemId: string,
    options?: { skipPriorPending?: boolean; reason?: string },
  ): {
    id: string;
    text: string;
    status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'dropped';
  } | null {
    const checklistEntry = this.getLatestChecklistEntry(taskId);
    if (!checklistEntry) return null;

    const items = checklistEntry.metadata.items?.map((item) => ({ ...item })) || [];
    const targetIndex = items.findIndex((item) => item.id === itemId);
    if (targetIndex < 0) return null;

    const target = items[targetIndex];
    if (!target || target.status === 'completed' || target.status === 'dropped') return null;

    for (const item of items) {
      if (item.status === 'in_progress') item.status = 'pending';
    }

    if (options?.skipPriorPending) {
      for (const item of items.slice(0, targetIndex)) {
        if (item.status === 'pending') item.status = 'dropped';
      }
    }

    target.status = 'in_progress';
    this.recordChecklistUpdate(
      taskId,
      checklistEntry,
      items,
      target.id,
      target.text,
      `Checklist update | targeted ${target.id}. ${target.text}${options?.skipPriorPending ? ' | skipped earlier pending items' : ''}${options?.reason ? ` | ${options.reason}` : ''}`,
    );

    return { ...target };
  }

  beginChecklistItemForPrompt(
    taskId: string,
    prompt: string,
    reason?: string,
  ): {
    id: string;
    text: string;
    status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'dropped';
  } | null {
    const checklist = this.getActiveChecklist(taskId);
    if (!checklist?.items.length) return null;

    const directive = this.parseChecklistPromptDirective(prompt, checklist.items);
    if (directive?.targetItemId) {
      return this.beginSpecificChecklistItem(taskId, directive.targetItemId, {
        skipPriorPending: directive.skipPriorPending,
        reason,
      });
    }

    return this.beginActiveChecklistItem(taskId, reason);
  }

  setChecklistItemStatus(
    taskId: string,
    itemId: string,
    status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'dropped',
    options?: { notes?: string; skipPriorPending?: boolean; reason?: string },
  ): {
    id: string;
    text: string;
    status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'dropped';
    notes?: string;
  } | null {
    if (status === 'in_progress') {
      return this.beginSpecificChecklistItem(taskId, itemId, {
        skipPriorPending: options?.skipPriorPending,
        reason: options?.reason,
      });
    }

    const checklistEntry = this.getLatestChecklistEntry(taskId);
    if (!checklistEntry) return null;

    const items = checklistEntry.metadata.items?.map((item) => ({ ...item })) || [];
    const target = items.find((item) => item.id === itemId);
    if (!target) return null;

    target.status = status;
    if (typeof options?.notes === 'string' && options.notes.trim()) {
      target.notes = options.notes.trim();
    }

    const currentInProgress = items.find((item) => item.status === 'in_progress');
    const nextPending = !currentInProgress && status === 'completed'
      ? items.find((item) => item.status === 'pending')
      : null;
    if (nextPending) nextPending.status = 'in_progress';

    const currentItemId = currentInProgress?.id ?? nextPending?.id ?? null;
    const nextAction = currentInProgress?.text ?? nextPending?.text;

    this.recordChecklistUpdate(
      taskId,
      checklistEntry,
      items,
      currentItemId,
      nextAction,
      `Checklist update | set ${target.id}. ${target.text} -> ${status}${options?.reason ? ` | ${options.reason}` : ''}`,
    );

    return { ...target };
  }

  completeActiveChecklistItem(taskId: string, reason?: string): {
    completedItemId: string;
    nextItemId: string | null;
  } | null {
    const checklistEntry = this.getLatestChecklistEntry(taskId);
    if (!checklistEntry) return null;

    const items = checklistEntry.metadata.items?.map((item) => ({ ...item })) || [];
    const current = items.find((item) => item.status === 'in_progress')
      || items.find((item) => item.id === checklistEntry.metadata.currentItemId)
      || items.find((item) => item.status === 'pending');
    if (!current) return null;

    const currentIndex = items.findIndex((item) => item.id === current.id);
    current.status = 'completed';
    const nextPending = items.slice(currentIndex + 1).find((item) => item.status === 'pending')
      || items.find((item) => item.status === 'pending');
    if (nextPending) nextPending.status = 'in_progress';

    this.recordChecklistUpdate(
      taskId,
      checklistEntry,
      items,
      nextPending?.id ?? null,
      nextPending?.text,
      nextPending
        ? `Checklist update | completed ${current.id}. ${current.text} | next ${nextPending.id}. ${nextPending.text}${reason ? ` | ${reason}` : ''}`
        : `Checklist update | completed ${current.id}. ${current.text} | checklist complete${reason ? ` | ${reason}` : ''}`,
    );

    return {
      completedItemId: current.id,
      nextItemId: nextPending?.id ?? null,
    };
  }

  buildContext(taskId: string): string | null {
    const memory = this.get(taskId);
    if (memory.entries.length === 0) {
      return null;
    }

    const recent = memory.entries.slice(-MAX_CONTEXT_ENTRIES);

    // Group structured reasoning entries by category for easier reference
    const claims: string[] = [];
    const evidence: string[] = [];
    const critiques: string[] = [];
    const verifications: string[] = [];
    const plans: string[] = [];
    const chronological: string[] = [];

    for (const entry of recent) {
      const category = typeof entry.metadata?.category === 'string' ? entry.metadata.category : '';

      if (category === 'claim') {
        claims.push(entry.text);
      } else if (category === 'evidence') {
        evidence.push(entry.text);
      } else if (category === 'critique') {
        critiques.push(entry.text);
      } else if (category === 'verification') {
        verifications.push(entry.text);
      } else if (category === 'plan') {
        plans.push(entry.text);
      } else {
        const prefix = (() => {
          switch (entry.kind) {
            case 'user_prompt': return 'User';
            case 'model_result': return entry.providerId ? `Model(${entry.providerId})` : 'Model';
            case 'browser_finding': return 'Browser';
            default: return 'System';
          }
        })();
        chronological.push(`${prefix}: ${this.formatEntryText(entry)}`);
      }
    }

    const sections: string[] = ['## Task Memory'];

    if (claims.length > 0 || evidence.length > 0 || critiques.length > 0 || verifications.length > 0) {
      sections.push('### Reasoning State');
      if (claims.length > 0) sections.push('**Claims:** ' + claims.join(' | '));
      if (evidence.length > 0) sections.push('**Evidence:** ' + evidence.join(' | '));
      if (critiques.length > 0) sections.push('**Critiques:** ' + critiques.join(' | '));
      if (verifications.length > 0) sections.push('**Verifications:** ' + verifications.join(' | '));
    }

    if (plans.length > 0) {
      sections.push('### Planning State');
      sections.push('**Plans:** ' + plans.join(' | '));
    }

    const checklist = this.getActiveChecklist(taskId);
    if (checklist && checklist.items.length > 0) {
      sections.push('### Active Checklist');
      if (checklist.planName) sections.push(`Plan: ${checklist.planName}`);
      sections.push(...checklist.items.map((item) => (
        `${item.status === 'completed' ? '[done]' : item.status === 'in_progress' ? '[in-progress]' : item.status === 'blocked' ? '[blocked]' : item.status === 'dropped' ? '[dropped]' : '[pending]'} ${item.id}. ${item.text}`
      )));
    }

    if (chronological.length > 0) {
      sections.push('### History');
      sections.push(...chronological);
    }

    let context = sections.join('\n');
    if (context.length > MAX_CONTEXT_CHARS) {
      context = context.slice(0, MAX_CONTEXT_CHARS) + '\n…[context truncated]';
    }
    return context;
  }

  private append(taskId: string, entry: TaskMemoryEntry): TaskMemoryRecord {
    const current = this.memoryByTask.get(taskId) || createEmptyTaskMemoryRecord(taskId);
    const next: TaskMemoryRecord = {
      taskId,
      lastUpdatedAt: entry.createdAt,
      entries: [...current.entries, entry].slice(-MAX_ENTRIES_PER_TASK),
    };
    this.memoryByTask.set(taskId, next);
    saveMemory(Array.from(this.memoryByTask.values()));
    this.writeScratchpad(taskId);
    return next;
  }

  private isPlanMetadata(value: unknown): value is TaskPlanMetadata {
    return Boolean(
      value
      && typeof value === 'object'
      && (value as Record<string, unknown>).category === 'plan',
    );
  }

  private formatPlanEntry(entry: TaskMemoryEntry & { metadata: TaskPlanMetadata }): string {
    return this.formatEntryText(entry);
  }

  private buildStructuredPlanState(taskId: string): {
    objective: string | null;
    tracks: string[];
    delegation: string[];
    validation: string[];
    nextAction: string | null;
    activeChecklist: {
      planId: string | null;
      planName: string | null;
      currentItemId: string | null;
      items: Array<{
        id: string;
        text: string;
        status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'dropped';
        notes?: string;
      }>;
    } | null;
  } {
    const planEntries = this.get(taskId).entries
      .filter((entry): entry is TaskMemoryEntry & { metadata: TaskPlanMetadata } => (
        entry.kind === 'system' && this.isPlanMetadata(entry.metadata)
      ));

    let objective: string | null = null;
    let nextAction: string | null = null;
    const tracks: string[] = [];
    const delegation: string[] = [];
    const validation: string[] = [];

    for (const entry of planEntries) {
      const metadata = entry.metadata;
      if (!objective && typeof metadata.objective === 'string' && metadata.objective.trim()) {
        objective = metadata.objective.trim();
      }
      if (typeof metadata.nextAction === 'string' && metadata.nextAction.trim()) {
        nextAction = metadata.nextAction.trim();
      }
      for (const value of toStringList(metadata.tracks)) {
        if (typeof value === 'string' && value.trim() && !tracks.includes(value.trim())) tracks.push(value.trim());
      }
      for (const value of toStringList(metadata.delegation)) {
        if (typeof value === 'string' && value.trim() && !delegation.includes(value.trim())) delegation.push(value.trim());
      }
      for (const value of toStringList(metadata.validation)) {
        if (typeof value === 'string' && value.trim() && !validation.includes(value.trim())) validation.push(value.trim());
      }
    }

    return {
      objective,
      tracks,
      delegation,
      validation,
      nextAction,
      activeChecklist: this.getActiveChecklist(taskId),
    };
  }

  private getActiveChecklist(taskId: string): {
    planId: string | null;
    planName: string | null;
    currentItemId: string | null;
    items: Array<{
      id: string;
      text: string;
      status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'dropped';
      notes?: string;
    }>;
  } | null {
    const latestWithItems = this.getLatestChecklistEntry(taskId);

    if (!latestWithItems?.metadata.items?.length) return null;
    return {
      planId: typeof latestWithItems.metadata.planId === 'string' ? latestWithItems.metadata.planId : null,
      planName: typeof latestWithItems.metadata.planName === 'string' ? latestWithItems.metadata.planName : null,
      currentItemId: typeof latestWithItems.metadata.currentItemId === 'string' ? latestWithItems.metadata.currentItemId : null,
      items: latestWithItems.metadata.items,
    };
  }

  private getLatestChecklistEntry(taskId: string): (TaskMemoryEntry & { metadata: TaskPlanMetadata }) | null {
    return [...this.get(taskId).entries].reverse().find(
      (entry): entry is TaskMemoryEntry & { metadata: TaskPlanMetadata } => (
        entry.kind === 'system'
        && this.isPlanMetadata(entry.metadata)
        && Array.isArray(entry.metadata.items)
        && entry.metadata.items.length > 0
      ),
    ) ?? null;
  }

  private captureChecklistPlan(
    taskId: string,
    text: string,
    sourceKind: TaskMemoryEntryKind,
  ): TaskMemoryRecord | null {
    const parsed = this.parseChecklist(text);
    if (!parsed) return null;

    const existing = this.getActiveChecklist(taskId);
    const normalizedExisting = existing?.items.map((item) => item.text.trim().toLowerCase()) ?? [];
    const normalizedNext = parsed.items.map((item) => item.text.trim().toLowerCase());
    if (
      normalizedExisting.length === normalizedNext.length
      && normalizedExisting.every((value, index) => value === normalizedNext[index])
    ) {
      return null;
    }

    const planId = generateId('plan');
    const summary = [
      parsed.planName ? `Captured checklist: ${parsed.planName}` : 'Captured checklist',
      `items=${parsed.items.length}`,
    ].join(' | ');

    return this.recordPlan(taskId, summary, {
      category: 'plan',
      stage: 'checklist-captured',
      planId,
      planName: parsed.planName || undefined,
      sourceKind,
      objective: parsed.planName || undefined,
      nextAction: parsed.items[0]?.text,
      currentItemId: parsed.items[0]?.id,
      items: parsed.items,
    });
  }

  private parseChecklist(text: string): {
    planName: string | null;
    items: Array<{
      id: string;
      text: string;
      status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'dropped';
    }>;
  } | null {
    const normalized = text.replace(/\r\n/g, '\n').trim();
    if (!normalized) return null;

    const lines = normalized.split('\n');
    const listItems: string[] = [];
    let firstListLine = -1;

    for (const [index, line] of lines.entries()) {
      const match = line.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+)(.+?)\s*$/);
      if (!match) continue;
      if (firstListLine === -1) firstListLine = index;
      const item = match[1].trim();
      if (item) listItems.push(item);
    }

    if (listItems.length < 3) {
      const inlineMatches = [...normalized.matchAll(/(?:^|\s)(\d+)[.)]\s+/g)];
      if (inlineMatches.length >= 3) {
        listItems.length = 0;
        for (const [index, match] of inlineMatches.entries()) {
          const start = (match.index ?? 0) + match[0].length;
          const end = index + 1 < inlineMatches.length
            ? (inlineMatches[index + 1].index ?? normalized.length)
            : normalized.length;
          const item = normalized.slice(start, end).replace(/\s+/g, ' ').trim();
          if (item) listItems.push(item);
        }
        firstListLine = 0;
      }
    }

    if (listItems.length < 3) return null;

    const priorLines = firstListLine > 0 ? lines.slice(0, firstListLine).map((line) => line.trim()).filter(Boolean) : [];
    const rawPlanName = priorLines.length > 0 ? priorLines[priorLines.length - 1] : null;
    const planName = rawPlanName ? rawPlanName.replace(/[:.\s]+$/, '').trim() : null;

    return {
      planName: planName || null,
      items: listItems.map((item, index) => ({
        id: `${index + 1}`,
        text: item,
        status: 'pending',
      })),
    };
  }

  private parseChecklistPromptDirective(
    prompt: string,
    items: Array<{ id: string; text: string }>,
  ): { targetItemId: string; skipPriorPending: boolean } | null {
    const skipPriorPending = /\bskip\b/i.test(prompt);
    const numericMatch = prompt.match(/\b(?:do|start|begin|implement|work on|take|handle|pick)\s+(?:step|item)?\s*#?\s*(\d+)\b/i)
      || prompt.match(/\b(?:step|item)\s*#?\s*(\d+)\b/i)
      || prompt.match(/\b#(\d+)\b/);
    if (numericMatch) {
      return {
        targetItemId: numericMatch[1],
        skipPriorPending,
      };
    }

    const targetText = this.extractChecklistTargetText(prompt);
    if (!targetText) return null;

    const targetItem = this.matchChecklistItemByText(items, targetText);
    if (!targetItem) return null;
    return {
      targetItemId: targetItem.id,
      skipPriorPending,
    };
  }

  private extractChecklistTargetText(prompt: string): string | null {
    const trimmed = prompt.trim().replace(/[.?!]+$/, '');
    const skipTarget = trimmed.match(/\bskip\b.*?\b(?:and\s+)?(?:do|start|begin|implement|work on|handle|pick)\s+(.+)$/i);
    if (skipTarget?.[1]) return skipTarget[1].trim();

    const directTarget = trimmed.match(/\b(?:do|start|begin|implement|work on|handle|pick)\s+(.+)$/i);
    if (directTarget?.[1]) return directTarget[1].trim();

    return null;
  }

  private matchChecklistItemByText(
    items: Array<{ id: string; text: string }>,
    targetText: string,
  ): { id: string; text: string } | null {
    const normalizedTarget = targetText.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!normalizedTarget) return null;

    const targetTokens = normalizedTarget
      .split(' ')
      .map((token) => token.replace(/s$/, ''))
      .filter((token) => token.length >= 3 && !CHECKLIST_TARGET_STOP_WORDS.has(token));
    const compactTarget = targetTokens.join(' ');
    if (!compactTarget) return null;

    let best: { id: string; text: string; score: number } | null = null;
    let tie = false;

    for (const item of items) {
      const normalizedItem = item.text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
      const itemTokens = normalizedItem
        .split(' ')
        .map((token) => token.replace(/s$/, ''))
        .filter((token) => token.length >= 3);
      const overlap = targetTokens.filter((token) => itemTokens.includes(token));
      let score = overlap.length * 3;
      if (normalizedItem.includes(compactTarget) || compactTarget.includes(normalizedItem)) score += 8;

      if (score === 0) continue;
      if (!best || score > best.score) {
        best = { ...item, score };
        tie = false;
      } else if (best && score === best.score) {
        tie = true;
      }
    }

    if (!best || tie) return null;
    return { id: best.id, text: best.text };
  }

  private writeScratchpad(taskId: string): void {
    const record = this.get(taskId);
    const hasPlanEntries = record.entries.some(
      (entry) => entry.kind === 'system' && this.isPlanMetadata(entry.metadata),
    );
    if (!hasPlanEntries) return;

    const snapshot = this.getPlanSnapshot(taskId);
    const recentPlans = record.entries
      .filter((entry): entry is TaskMemoryEntry & { metadata: TaskPlanMetadata } => (
        entry.kind === 'system' && this.isPlanMetadata(entry.metadata)
      ))
      .slice(-6);

    const lines = [
      '# Task Scratchpad',
      '',
      `Task: ${taskId}`,
      `Updated: ${new Date(record.lastUpdatedAt ?? Date.now()).toISOString()}`,
    ];

    if (snapshot?.objective) {
      lines.push('', '## Objective', snapshot.objective);
    }

    if (snapshot?.activeChecklist?.items.length) {
      lines.push('', '## Active Checklist');
      if (snapshot.activeChecklist.planName) lines.push(`Plan: ${snapshot.activeChecklist.planName}`);
      lines.push(...snapshot.activeChecklist.items.map((item) => (
        `- [${item.status === 'completed' ? 'x' : item.status === 'in_progress' ? '>' : item.status === 'blocked' ? '!' : item.status === 'dropped' ? '~' : ' '}] ${item.id}. ${item.text}`
      )));
    }

    if (snapshot?.nextAction) {
      lines.push('', '## Next Action', snapshot.nextAction);
    }

    if (recentPlans.length > 0) {
      lines.push('', '## Recent Milestones');
      lines.push(...recentPlans.map((entry) => `- ${this.formatEntryText(entry)}`));
    }

    try {
      fs.mkdirSync(getTaskScratchpadDir(), { recursive: true });
      fs.writeFileSync(getTaskScratchpadPath(taskId), `${lines.join('\n')}\n`, 'utf-8');
    } catch (err) {
      console.error('Failed to persist task scratchpad:', err);
    }
  }

  private recordChecklistUpdate(
    taskId: string,
    checklistEntry: TaskMemoryEntry & { metadata: TaskPlanMetadata },
    items: Array<{
      id: string;
      text: string;
      status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'dropped';
      notes?: string;
    }>,
    currentItemId: string | null,
    nextAction: string | undefined,
    text: string,
  ): TaskMemoryRecord {
    return this.recordPlan(taskId, text, {
      ...checklistEntry.metadata,
      category: 'plan',
      stage: 'checklist-updated',
      items,
      currentItemId: currentItemId ?? undefined,
      nextAction,
    });
  }

  private formatEntryText(entry: TaskMemoryEntry): string {
    const attachmentSummary = typeof entry.metadata?.attachmentSummary === 'string'
      ? entry.metadata.attachmentSummary.trim()
      : '';
    const text = entry.text.trim();
    if (text && attachmentSummary) return `${text} ${attachmentSummary}`;
    if (text) return text;
    if (attachmentSummary) return attachmentSummary;
    return entry.text;
  }
}

export const taskMemoryStore = new TaskMemoryStore();
