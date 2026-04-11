import { AgentRunRecord, AgentRunStatus, AgentToolCallRecord, AgentToolName, AgentToolStatus } from './AgentTypes';

const MAX_RUN_RECORDS = 250;
const MAX_TOOL_CALL_RECORDS = 1000;
const COMPLETED_RECORD_TTL_MS = 6 * 60 * 60 * 1000;

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class AgentRunStore {
  private runs = new Map<string, AgentRunRecord>();
  private toolCalls = new Map<string, AgentToolCallRecord>();

  createRun(input: Omit<AgentRunRecord, 'id' | 'startedAt' | 'completedAt' | 'status' | 'resultSummary' | 'error'>): AgentRunRecord {
    const run: AgentRunRecord = {
      ...input,
      id: makeId('run'),
      status: 'queued',
      startedAt: Date.now(),
      completedAt: null,
      resultSummary: null,
      error: null,
    };
    this.runs.set(run.id, run);
    this.prune();
    return { ...run };
  }

  updateRun(id: string, patch: Partial<Pick<AgentRunRecord, 'status' | 'completedAt' | 'resultSummary' | 'error'>>): AgentRunRecord {
    const current = this.runs.get(id);
    if (!current) throw new Error(`Agent run not found: ${id}`);
    const next = { ...current, ...patch };
    this.runs.set(id, next);
    return { ...next };
  }

  finishRun(id: string, status: Exclude<AgentRunStatus, 'queued' | 'running'>, resultSummary: string | null, error: string | null = null): AgentRunRecord {
    return this.updateRun(id, {
      status,
      resultSummary,
      error,
      completedAt: Date.now(),
    });
  }

  getRun(id: string): AgentRunRecord | null {
    const run = this.runs.get(id);
    return run ? { ...run } : null;
  }

  listRuns(): AgentRunRecord[] {
    return Array.from(this.runs.values()).map(run => ({ ...run }));
  }

  startToolCall(input: {
    runId: string;
    agentId: string;
    toolName: AgentToolName;
    toolInput: unknown;
  }): AgentToolCallRecord {
    const record: AgentToolCallRecord = {
      id: makeId('tool'),
      runId: input.runId,
      agentId: input.agentId,
      toolName: input.toolName,
      input: input.toolInput,
      output: null,
      status: 'running',
      startedAt: Date.now(),
      completedAt: null,
      error: null,
    };
    this.toolCalls.set(record.id, record);
    this.prune();
    return { ...record };
  }

  finishToolCall(id: string, status: AgentToolStatus, output: unknown, error: string | null = null): AgentToolCallRecord {
    const current = this.toolCalls.get(id);
    if (!current) throw new Error(`Agent tool call not found: ${id}`);
    const next: AgentToolCallRecord = {
      ...current,
      status,
      output,
      error,
      completedAt: Date.now(),
    };
    this.toolCalls.set(id, next);
    return { ...next };
  }

  listToolCalls(runId?: string): AgentToolCallRecord[] {
    const calls = Array.from(this.toolCalls.values());
    return calls
      .filter(call => !runId || call.runId === runId)
      .map(call => ({ ...call }));
  }

  prune(now = Date.now()): void {
    const removableRuns = Array.from(this.runs.values())
      .filter(run => run.status !== 'queued' && run.status !== 'running')
      .filter(run => (run.completedAt ?? run.startedAt) <= now - COMPLETED_RECORD_TTL_MS)
      .sort((a, b) => (a.completedAt ?? a.startedAt) - (b.completedAt ?? b.startedAt));

    for (const run of removableRuns) {
      this.runs.delete(run.id);
      for (const call of Array.from(this.toolCalls.values())) {
        if (call.runId === run.id) this.toolCalls.delete(call.id);
      }
    }

    this.pruneMapByAge(this.runs, MAX_RUN_RECORDS, run => run.status !== 'queued' && run.status !== 'running', run => run.completedAt ?? run.startedAt);
    this.pruneMapByAge(this.toolCalls, MAX_TOOL_CALL_RECORDS, call => call.status !== 'running', call => call.completedAt ?? call.startedAt);
  }

  private pruneMapByAge<T extends { id: string }>(
    map: Map<string, T>,
    maxSize: number,
    canRemove: (value: T) => boolean,
    timestamp: (value: T) => number,
  ): void {
    if (map.size <= maxSize) return;

    const candidates = Array.from(map.values())
      .filter(canRemove)
      .sort((a, b) => timestamp(a) - timestamp(b));

    for (const candidate of candidates) {
      if (map.size <= maxSize) break;
      map.delete(candidate.id);
    }
  }
}

export const agentRunStore = new AgentRunStore();
