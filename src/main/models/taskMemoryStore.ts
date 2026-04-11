import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { generateId } from '../../shared/utils/ids';
import type {
  HandoffPacket,
  InvocationResult,
  TaskMemoryEntry,
  TaskMemoryRecord,
} from '../../shared/types/model';
import { createEmptyTaskMemoryRecord } from '../../shared/types/model';
import type { BrowserFinding } from '../../shared/types/browserIntelligence';

const TASK_MEMORY_FILE = 'task-memory.json';
const MAX_ENTRIES_PER_TASK = 200;
const MAX_CONTEXT_ENTRIES = 10;
const MAX_CONTEXT_CHARS = 2000;
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

  recordUserPrompt(taskId: string, text: string): TaskMemoryRecord {
    return this.append(taskId, {
      id: generateId('mem'),
      taskId,
      kind: 'user_prompt',
      text,
      createdAt: Date.now(),
    });
  }

  recordInvocationResult(result: InvocationResult): TaskMemoryRecord {
    return this.append(result.taskId, {
      id: generateId('mem'),
      taskId: result.taskId,
      kind: 'model_result',
      text: result.success ? result.output : (result.error || 'Invocation failed'),
      providerId: result.providerId,
      createdAt: Date.now(),
      metadata: {
        success: result.success,
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
        chronological.push(`${prefix}: ${entry.text}`);
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
}

export const taskMemoryStore = new TaskMemoryStore();
