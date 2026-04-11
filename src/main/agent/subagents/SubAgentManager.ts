import { AgentProvider } from '../AgentTypes';
import { SubAgentRecord, SubAgentResult, SubAgentSpawnInput } from './SubAgentTypes';
import { SubAgentRuntime } from './SubAgentRuntime';
import { chatKnowledgeStore } from '../../chatKnowledge/ChatKnowledgeStore';
import { taskMemoryStore } from '../../models/taskMemoryStore';

function makeSubAgentId(): string {
  return `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const MAX_SUB_AGENT_RECORDS = 200;
const COMPLETED_SUB_AGENT_TTL_MS = 6 * 60 * 60 * 1000;

export class SubAgentManager {
  private records = new Map<string, SubAgentRecord>();
  private results = new Map<string, SubAgentResult>();
  private runPromises = new Map<string, Promise<SubAgentResult>>();

  constructor(private readonly providerFactory: () => AgentProvider) {}

  spawn(parentRunId: string, input: SubAgentSpawnInput): SubAgentRecord {
    const record: SubAgentRecord = {
      id: makeSubAgentId(),
      parentRunId,
      runId: null,
      role: input.role || 'subagent',
      task: input.task,
      mode: input.mode || 'unrestricted-dev',
      status: 'running',
      createdAt: Date.now(),
      completedAt: null,
      summary: null,
      error: null,
    };
    this.records.set(record.id, record);
    this.prune();
    return { ...record };
  }

  run(parentRunId: string, input: SubAgentSpawnInput): Promise<SubAgentResult> {
    const record = this.spawn(parentRunId, input);
    const runtime = new SubAgentRuntime(this.providerFactory());

    const promise = (async (): Promise<SubAgentResult> => {
      if (this.records.get(record.id)?.status === 'cancelled') {
        const cancelled: SubAgentResult = {
          id: record.id,
          status: 'cancelled',
          summary: 'Cancelled before start',
          findings: [],
          changedFiles: [],
        };
        this.results.set(record.id, cancelled);
        return cancelled;
      }

      const result = await runtime.run({
        mode: record.mode,
        agentId: record.id,
        role: record.role,
        task: record.task,
        taskId: input.taskId,
        contextPrompt: this.contextForSpawn(input),
        parentRunId,
        depth: 1,
        skillNames: this.skillNamesForRole(record.role, input.canSpawnSubagents !== false),
        allowedTools: input.allowedTools || 'all',
        canSpawnSubagents: input.canSpawnSubagents,
      });
      const summary = result.output.slice(0, 1000);
      const completed: SubAgentRecord = {
        ...record,
        status: 'completed',
        completedAt: Date.now(),
        summary,
      };
      this.records.set(record.id, completed);
      const subResult: SubAgentResult = {
        id: record.id,
        status: 'completed',
        summary,
        findings: [],
        changedFiles: [],
      };
      this.results.set(record.id, subResult);
      this.prune();
      return subResult;
    })().catch((err): SubAgentResult => {
      const message = err instanceof Error ? err.message : String(err);
      const current = this.records.get(record.id) || record;
      const status = current.status === 'cancelled' ? 'cancelled' : 'failed';
      this.records.set(record.id, {
        ...record,
        status,
        completedAt: Date.now(),
        error: message,
      });
      const subResult: SubAgentResult = {
        id: record.id,
        status,
        summary: message,
        findings: [],
        changedFiles: [],
      };
      this.results.set(record.id, subResult);
      this.prune();
      return subResult;
    });

    this.runPromises.set(record.id, promise);
    return promise;
  }

  spawnBackground(parentRunId: string, input: SubAgentSpawnInput): SubAgentRecord {
    const promise = this.run(parentRunId, input);
    promise.catch(() => {});
    const id = Array.from(this.records.values())
      .filter(record => record.parentRunId === parentRunId)
      .sort((a, b) => b.createdAt - a.createdAt)[0]?.id;
    if (!id) throw new Error('Failed to create sub-agent');
    return this.get(id)!;
  }

  async wait(id: string, timeoutMs: number = 120_000): Promise<SubAgentResult> {
    const existing = this.results.get(id);
    if (existing) return { ...existing };

    const promise = this.runPromises.get(id);
    if (!promise) throw new Error(`Sub-agent not found: ${id}`);

    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<SubAgentResult>((_, reject) => {
          timeout = setTimeout(() => reject(new Error(`Timed out waiting for sub-agent ${id}`)), timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  cancel(id: string): SubAgentRecord {
    const record = this.records.get(id);
    if (!record) throw new Error(`Sub-agent not found: ${id}`);
    const next: SubAgentRecord = {
      ...record,
      status: 'cancelled',
      completedAt: Date.now(),
      error: 'Cancelled',
    };
    this.records.set(id, next);
    this.results.set(id, {
      id,
      status: 'cancelled',
      summary: 'Cancelled',
      findings: [],
      changedFiles: [],
    });
    this.prune();
    return { ...next };
  }

  get(id: string): SubAgentRecord | null {
    const record = this.records.get(id);
    return record ? { ...record } : null;
  }

  list(parentRunId?: string): SubAgentRecord[] {
    return Array.from(this.records.values())
      .filter(record => !parentRunId || record.parentRunId === parentRunId)
      .map(record => ({ ...record }));
  }

  private skillNamesForRole(role: string, canSpawnSubagents: boolean): string[] {
    const normalized = role.toLowerCase();
    const skills = canSpawnSubagents ? ['subagent-coordination'] : [];
    if (normalized.includes('browser') || normalized.includes('research')) skills.push('browser-operation');
    if (normalized.includes('file') || normalized.includes('code')) skills.push('filesystem-operation');
    if (normalized.includes('debug') || normalized.includes('terminal')) skills.push('local-debug');
    if (skills.length === 0 || (canSpawnSubagents && skills.length === 1)) {
      skills.push('browser-operation', 'filesystem-operation', 'local-debug');
    }
    return skills;
  }

  private contextForSpawn(input: SubAgentSpawnInput): string | null {
    if (!input.taskId || input.inheritedContext === 'none') return null;

    const parts: string[] = [];
    if (input.inheritedContext === 'full') {
      const chatContext = chatKnowledgeStore.buildInvocationContext(input.taskId);
      const taskMemory = taskMemoryStore.buildContext(input.taskId);
      if (chatContext) parts.push(chatContext);
      if (taskMemory) parts.push(taskMemory);
    } else {
      const summary = chatKnowledgeStore.threadSummary(input.taskId);
      if (summary) parts.push(['## Parent Conversation Summary', summary].join('\n'));
    }

    const context = parts.join('\n\n').trim();
    if (!context) return null;
    return context.length > 4_000 ? `${context.slice(0, 4_000)}\n...[sub-agent context truncated]` : context;
  }

  private prune(now = Date.now()): void {
    const removable = Array.from(this.records.values())
      .filter(record => record.status !== 'running')
      .filter(record => (record.completedAt ?? record.createdAt) <= now - COMPLETED_SUB_AGENT_TTL_MS)
      .sort((a, b) => (a.completedAt ?? a.createdAt) - (b.completedAt ?? b.createdAt));

    for (const record of removable) this.deleteRecord(record.id);

    if (this.records.size <= MAX_SUB_AGENT_RECORDS) return;

    const overflowCandidates = Array.from(this.records.values())
      .filter(record => record.status !== 'running')
      .sort((a, b) => (a.completedAt ?? a.createdAt) - (b.completedAt ?? b.createdAt));

    for (const record of overflowCandidates) {
      if (this.records.size <= MAX_SUB_AGENT_RECORDS) break;
      this.deleteRecord(record.id);
    }
  }

  private deleteRecord(id: string): void {
    this.records.delete(id);
    this.results.delete(id);
    this.runPromises.delete(id);
  }
}
