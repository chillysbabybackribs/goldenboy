import * as path from 'path';
import type { CodexItem } from '../../../shared/types/model';
import type { AgentToolCallRecord, AgentToolResult, ValidationStatus } from '../AgentTypes';
import { AgentProvider } from '../AgentTypes';
import { SubAgentRecord, SubAgentResult, SubAgentSpawnInput } from './SubAgentTypes';
import { SubAgentRuntime } from './SubAgentRuntime';
import { agentRunStore } from '../AgentRunStore';
import { chatKnowledgeStore } from '../../chatKnowledge/ChatKnowledgeStore';
import { taskMemoryStore } from '../../models/taskMemoryStore';
import { APP_WORKSPACE_ROOT } from '../../workspaceRoot';

function makeSubAgentId(): string {
  return `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const MAX_SUB_AGENT_RECORDS = 200;
const COMPLETED_SUB_AGENT_TTL_MS = 6 * 60 * 60 * 1000;

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const value = item.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function limitList(items: string[], limit = 6): string[] {
  return unique(items).slice(0, limit);
}

function toRelativeWorkspacePath(rawPath: string): string {
  const absolute = path.isAbsolute(rawPath) ? rawPath : path.resolve(APP_WORKSPACE_ROOT, rawPath);
  const relative = path.relative(APP_WORKSPACE_ROOT, absolute);
  if (!relative || relative.startsWith('..')) return rawPath;
  return relative;
}

function toolResultShape(value: unknown): AgentToolResult | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<AgentToolResult>;
  return typeof candidate.summary === 'string' ? candidate as AgentToolResult : null;
}

function extractFindings(output: string, toolCalls: AgentToolCallRecord[]): string[] {
  const bulletLines = output
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^[-*•]\s+/, '').replace(/^\d+\.\s+/, ''))
    .filter((line, index, all) => index < all.length && line.length > 0 && line.length <= 220);

  const bulletsOnly = bulletLines.filter(line => output.includes(`- ${line}`) || output.includes(`* ${line}`) || output.match(new RegExp(`\\d+\\.\\s+${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)));
  if (bulletsOnly.length > 0) return limitList(bulletsOnly, 5);

  const paragraphs = output
    .split(/\n{2,}/)
    .map(part => part.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  if (paragraphs.length > 0) return limitList(paragraphs, 3);

  return limitList(
    toolCalls
      .map(call => toolResultShape(call.output)?.summary || call.error || '')
      .filter(Boolean),
    3,
  );
}

function extractChangedFiles(toolCalls: AgentToolCallRecord[], codexItems?: CodexItem[]): string[] {
  const files: string[] = [];
  for (const item of codexItems || []) {
    if (item.type !== 'file_change') continue;
    for (const change of item.changes) files.push(toRelativeWorkspacePath(change.path));
  }

  for (const call of toolCalls) {
    const output = toolResultShape(call.output);
    if (!output) continue;
    const data = output.data || {};
    switch (call.toolName) {
      case 'filesystem.write':
      case 'filesystem.patch':
      case 'filesystem.delete':
      case 'filesystem.mkdir':
        if (typeof data.path === 'string') files.push(toRelativeWorkspacePath(data.path));
        break;
      case 'filesystem.move':
        if (typeof data.from === 'string') files.push(toRelativeWorkspacePath(data.from));
        if (typeof data.to === 'string') files.push(toRelativeWorkspacePath(data.to));
        break;
      default:
        break;
    }
  }

  return limitList(files, 20);
}

function extractCommands(toolCalls: AgentToolCallRecord[], codexItems?: CodexItem[]): string[] {
  const commands: string[] = [];

  for (const item of codexItems || []) {
    if (item.type !== 'command_execution') continue;
    const suffix = item.exit_code === null ? '' : ` (exit ${item.exit_code})`;
    commands.push(`${item.command}${suffix}`);
  }

  for (const call of toolCalls) {
    if (call.toolName !== 'terminal.exec' && call.toolName !== 'terminal.spawn') continue;
    const input = (call.input && typeof call.input === 'object') ? call.input as Record<string, unknown> : {};
    const output = toolResultShape(call.output);
    const base = typeof input.command === 'string' ? input.command : '';
    const exitCode = output?.data && typeof output.data.exitCode === 'number'
      ? ` (exit ${output.data.exitCode})`
      : '';
    if (base) commands.push(`${base}${exitCode}`);
  }

  return limitList(commands, 20);
}

function summarizeValidation(toolCalls: AgentToolCallRecord[]): SubAgentResult['validation'] {
  const summary = { total: 0, valid: 0, invalid: 0, incomplete: 0 };
  for (const call of toolCalls) {
    const validation = toolResultShape(call.output)?.validation;
    if (!validation) continue;
    summary.total += 1;
    if (validation.status === 'VALID') summary.valid += 1;
    else if (validation.status === 'INVALID') summary.invalid += 1;
    else summary.incomplete += 1;
  }
  return summary;
}

function summarizeToolCalls(toolCalls: AgentToolCallRecord[]): SubAgentResult['toolCalls'] {
  return toolCalls.map((call) => {
    const output = toolResultShape(call.output);
    const validationStatus = output?.validation?.status as ValidationStatus | undefined;
    return {
      toolName: call.toolName,
      status: call.status,
      summary: output?.summary || call.error || `${call.toolName} ${call.status}`,
      validationStatus,
    };
  });
}

function extractBlockers(status: SubAgentResult['status'], summary: string, toolCalls: AgentToolCallRecord[]): string[] {
  const blockers: string[] = [];
  if (status === 'failed' || status === 'cancelled') blockers.push(summary);

  for (const call of toolCalls) {
    if (call.status === 'failed' && call.error) {
      blockers.push(`${call.toolName}: ${call.error}`);
      continue;
    }
    const validation = toolResultShape(call.output)?.validation;
    if (validation && validation.status !== 'VALID') {
      blockers.push(`${call.toolName}: ${validation.summary}`);
    }
  }

  return limitList(blockers, 8);
}

function emptyValidation(): SubAgentResult['validation'] {
  return { total: 0, valid: 0, invalid: 0, incomplete: 0 };
}

export class SubAgentManager {
  private records = new Map<string, SubAgentRecord>();
  private results = new Map<string, SubAgentResult>();
  private runPromises = new Map<string, Promise<SubAgentResult>>();

  constructor(private readonly providerFactory: (input: SubAgentSpawnInput) => AgentProvider) {}

  spawn(parentRunId: string, input: SubAgentSpawnInput): SubAgentRecord {
    const record: SubAgentRecord = {
      id: makeSubAgentId(),
      taskId: input.taskId ?? null,
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
    const runtime = new SubAgentRuntime(this.providerFactory(input));

    const promise = (async (): Promise<SubAgentResult> => {
      if (this.records.get(record.id)?.status === 'cancelled') {
        const cancelled: SubAgentResult = {
          id: record.id,
          status: 'cancelled',
          summary: 'Cancelled before start',
          findings: [],
          changedFiles: [],
          commands: [],
          blockers: ['Cancelled before start'],
          toolCalls: [],
          validation: emptyValidation(),
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
        runId: result.runId ?? null,
        status: 'completed',
        completedAt: Date.now(),
        summary,
      };
      this.records.set(record.id, completed);
      const toolCalls = result.runId ? agentRunStore.listToolCalls(result.runId) : [];
      const subResult: SubAgentResult = {
        id: record.id,
        status: 'completed',
        summary,
        findings: extractFindings(result.output, toolCalls),
        changedFiles: extractChangedFiles(toolCalls, result.codexItems),
        commands: extractCommands(toolCalls, result.codexItems),
        blockers: extractBlockers('completed', summary, toolCalls),
        toolCalls: summarizeToolCalls(toolCalls),
        validation: summarizeValidation(toolCalls),
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
      const toolCalls = record.runId ? agentRunStore.listToolCalls(record.runId) : [];
      const subResult: SubAgentResult = {
        id: record.id,
        status,
        summary: message,
        findings: [],
        changedFiles: extractChangedFiles(toolCalls),
        commands: extractCommands(toolCalls),
        blockers: extractBlockers(status, message, toolCalls),
        toolCalls: summarizeToolCalls(toolCalls),
        validation: summarizeValidation(toolCalls),
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
      commands: [],
      blockers: ['Cancelled'],
      toolCalls: [],
      validation: emptyValidation(),
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
