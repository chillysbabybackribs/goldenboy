import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { generateId } from '../../shared/utils/ids';
import type {
  HandoffPacket,
  InvocationResult,
  TaskMemoryEntry,
  TaskPlanMetadata,
  TaskMemoryRecord,
} from '../../shared/types/model';
import { createEmptyTaskMemoryRecord } from '../../shared/types/model';
import type { BrowserFinding } from '../../shared/types/browserIntelligence';

const TASK_MEMORY_FILE = 'task-memory.json';
const MAX_ENTRIES_PER_TASK = 200;
const MAX_CONTEXT_ENTRIES = 10;
const MAX_CONTEXT_CHARS = 2000;
const MAX_PLAN_CONTEXT_ENTRIES = 6;
const MAX_PLAN_CONTEXT_CHARS = 1200;
const NUMBER_WORDS = new Set([
  'zero', 'one', 'two', 'three', 'four', 'five', 'six',
  'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
]);

function getTaskMemoryPath(): string {
  return path.join(app.getPath('userData'), TASK_MEMORY_FILE);
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

  clearTask(taskId: string): void {
    if (!this.memoryByTask.has(taskId)) return;
    this.memoryByTask.delete(taskId);
    saveMemory(Array.from(this.memoryByTask.values()));
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
      runningSubagents,
      blockedSubagents,
      completedSubagents,
    };
  }

  recordUserPrompt(taskId: string, text: string, metadata?: Record<string, unknown>): TaskMemoryRecord {
    return this.append(taskId, {
      id: generateId('mem'),
      taskId,
      kind: 'user_prompt',
      text,
      createdAt: Date.now(),
      metadata,
    });
  }

  recordInvocationResult(result: InvocationResult): TaskMemoryRecord {
    return this.append(result.taskId, {
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

  recordHandoff(packet: HandoffPacket): TaskMemoryRecord {
    return this.append(packet.taskId, {
      id: generateId('mem'),
      taskId: packet.taskId,
      kind: 'handoff',
      text: packet.summary,
      providerId: packet.toProvider,
      createdAt: Date.now(),
      metadata: {
        fromProvider: packet.fromProvider,
        toProvider: packet.toProvider,
        artifactCount: packet.artifacts.length,
      },
    });
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
            case 'handoff': return 'Handoff';
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

    return { objective, tracks, delegation, validation, nextAction };
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
