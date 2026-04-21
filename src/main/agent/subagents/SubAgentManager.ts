import * as path from 'path';
import type { AgentTaskKind, CodexItem, ProviderId, TaskPlanMetadata } from '../../../shared/types/model';
import type { AgentProviderResult, AgentToolCallRecord, AgentToolResult, ValidationStatus } from '../AgentTypes';
import { AgentProvider } from '../AgentTypes';
import { isOrchestrationExecutionReady } from '../runtimeScope';
import { SubAgentRecord, SubAgentResult, SubAgentScopeResolution, SubAgentSpawnInput } from './SubAgentTypes';
import { SubAgentRuntime } from './SubAgentRuntime';
import { agentRunStore } from '../AgentRunStore';
import { agentToolExecutor } from '../AgentToolExecutor';
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

function taskKindForSubagentRole(role: string, task: string): AgentTaskKind {
  const normalizedRole = role.toLowerCase();
  const normalizedTask = task.toLowerCase();
  if (/\b(review|audit|qa)\b/.test(normalizedRole)) return 'review';
  if (/\b(debug|terminal|fix)\b/.test(normalizedRole)) return 'debug';
  if (/\b(browser|research|search)\b/.test(normalizedRole)) return 'research';
  if (/\b(code|file|implement|patch|edit|refactor)\b/.test(normalizedRole)) return 'implementation';

  if (/\b(review|audit|regression)\b/.test(normalizedTask)) return 'review';
  if (/\b(debug|error|failing|failure|crash|exception)\b/.test(normalizedTask)) return 'debug';
  if (/\b(search|research|latest|current)\b/.test(normalizedTask)) return 'research';
  if (/\b(patch|edit|implement|refactor|file|code|build)\b/.test(normalizedTask)) return 'implementation';
  return 'general';
}

function requiresVerificationHeavyScope(task: string): boolean {
  const normalizedTask = task.toLowerCase();
  return /\b(verify|verification|validate|validation|confirm|check|assert|test|reproduce|compare|regression)\b/.test(normalizedTask);
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs?: number, label = 'sub-agent'): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise;

  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function summarizePlanMilestone(input: {
  role: string;
  task: string;
  status: SubAgentResult['status'] | 'running';
  findings?: string[];
  blockers?: string[];
}): string {
  const task = input.task.replace(/\s+/g, ' ').trim();
  const parts = [
    `Sub-agent ${input.role} ${input.status}`,
    `task="${task.length > 140 ? `${task.slice(0, 140)}...` : task}"`,
  ];
  if (input.findings?.length) parts.push(`findings=${input.findings.slice(0, 2).join('; ')}`);
  if (input.blockers?.length) parts.push(`blockers=${input.blockers.slice(0, 2).join('; ')}`);
  return parts.join(' | ');
}

function buildSubagentPlanMetadata(input: {
  stage: TaskPlanMetadata['stage'];
  role: string;
  task: string;
  subagentId: string;
  status: TaskPlanMetadata['status'];
  findings?: string[];
  blockers?: string[];
  validation?: string[];
}): TaskPlanMetadata {
  return {
    category: 'plan',
    stage: input.stage,
    role: input.role,
    subagentId: input.subagentId,
    status: input.status,
    task: input.task,
    delegation: [`Sub-agent ${input.role}: ${input.task}`],
    findings: input.findings?.slice(0, 3),
    blockers: input.blockers?.slice(0, 3),
    validation: input.validation,
    nextAction: input.status === 'running' ? `Wait for sub-agent ${input.role} if the parent becomes blocked.` : undefined,
  };
}

export type SubAgentUsageRecorder = (params: {
  taskId: string;
  providerId: ProviderId;
  usage: AgentProviderResult['usage'];
}) => void;

export class SubAgentManager {
  private records = new Map<string, SubAgentRecord>();

  constructor(
    private readonly providerFactory: (input: SubAgentSpawnInput) => AgentProvider,
    private readonly recordUsage: SubAgentUsageRecorder | null = null,
  ) {}

  resolveScope(input: SubAgentSpawnInput): SubAgentScopeResolution {
    if (input.allowedTools === 'all') {
      return { allowedTools: 'all', source: 'explicit-all' };
    }
    if (Array.isArray(input.allowedTools)) {
      return { allowedTools: input.allowedTools, source: 'explicit-list' };
    }
    const selectedTools = agentToolExecutor.list()
      .filter((tool) => input.canSpawnSubagents !== false || !tool.name.startsWith('subagent.'))
      .map((tool) => tool.name);
    const snapshot = input.taskId ? taskMemoryStore.getPlanSnapshot(input.taskId) : null;
    const adaptiveSource = isOrchestrationExecutionReady(snapshot) && !requiresVerificationHeavyScope(input.task)
      ? 'derived-runtime-selected-adaptive'
      : 'derived-runtime-selected';
    return {
      allowedTools: selectedTools,
      source: adaptiveSource,
    };
  }

  spawn(parentRunId: string, input: SubAgentSpawnInput): SubAgentRecord {
    const record: SubAgentRecord = {
      id: makeSubAgentId(),
      parentRunId,
      runId: null,
      role: input.role || 'subagent',
      task: input.task,
      mode: input.mode || 'unrestricted-dev',
      providerId: input.providerId || null,
      modelId: input.modelId?.trim() || null,
      status: 'running',
      createdAt: Date.now(),
      completedAt: null,
      summary: null,
      error: null,
    };
    this.records.set(record.id, record);
    if (input.taskId) {
      taskMemoryStore.recordPlan(
        input.taskId,
        summarizePlanMilestone({
          role: record.role,
          task: record.task,
          status: 'running',
        }),
        buildSubagentPlanMetadata({
          stage: 'subagent-spawn',
          role: record.role,
          task: record.task,
          subagentId: record.id,
          status: 'running',
        }),
      );
    }
    this.prune();
    return { ...record };
  }

  async run(
    parentRunId: string,
    input: SubAgentSpawnInput,
  ): Promise<{ record: SubAgentRecord; result: SubAgentResult }> {
    const record = this.spawn(parentRunId, input);
    const provider = this.providerFactory(input);
    const runtime = new SubAgentRuntime(provider);
    const resolvedProviderId = (provider.providerId ?? record.providerId ?? null) as ProviderId | null;
    try {
      const scope = this.resolveScope(input);
      const result = await withTimeout(runtime.run({
        mode: record.mode,
        agentId: record.id,
        role: record.role,
        task: record.task,
        taskId: input.taskId,
        contextPrompt: this.contextForSpawn(input),
        parentRunId,
        depth: 1,
        skillNames: this.skillNamesForRole(record.role, input.canSpawnSubagents !== false),
        allowedTools: scope.allowedTools,
        canSpawnSubagents: input.canSpawnSubagents,
        onStatus: (status) => input.onStatus?.(`subagent ${record.id}: ${status}`),
      }), input.timeoutMs, `sub-agent ${record.id}`);
      if (this.recordUsage && input.taskId && resolvedProviderId && result.usage) {
        try {
          this.recordUsage({
            taskId: input.taskId,
            providerId: resolvedProviderId,
            usage: result.usage,
          });
        } catch {
          // Usage accounting is advisory; never fail a sub-agent run because
          // bookkeeping throws.
        }
      }
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
      if (input.taskId) {
        taskMemoryStore.recordPlan(
          input.taskId,
          summarizePlanMilestone({
            role: record.role,
            task: record.task,
            status: 'completed',
            findings: subResult.findings,
            blockers: subResult.blockers,
          }),
          buildSubagentPlanMetadata({
            stage: 'subagent-complete',
            role: record.role,
            task: record.task,
            subagentId: record.id,
            status: 'completed',
            findings: subResult.findings,
            blockers: subResult.blockers,
            validation: [`valid=${subResult.validation.valid} invalid=${subResult.validation.invalid} incomplete=${subResult.validation.incomplete}`],
          }),
        );
      }
      this.prune();
      return { record: { ...completed }, result: subResult };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = 'failed';
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
      if (input.taskId) {
        taskMemoryStore.recordPlan(
          input.taskId,
          summarizePlanMilestone({
            role: record.role,
            task: record.task,
            status,
            blockers: subResult.blockers,
          }),
          buildSubagentPlanMetadata({
            stage: 'subagent-failed',
            role: record.role,
            task: record.task,
            subagentId: record.id,
            status,
            blockers: subResult.blockers,
            validation: [`valid=${subResult.validation.valid} invalid=${subResult.validation.invalid} incomplete=${subResult.validation.incomplete}`],
          }),
        );
      }
      this.prune();
      return { record: { ...this.records.get(record.id)! }, result: subResult };
    }
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
  }
}
