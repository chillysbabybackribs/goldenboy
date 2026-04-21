import { AgentProvider, AgentToolDefinition, AgentToolName } from '../AgentTypes';
import { SubAgentManager } from '../subagents/SubAgentManager';
import { SubAgentSpawnInput, SubAgentWaitInput } from '../subagents/SubAgentTypes';
import {
  GEMINI_PROVIDER_ID,
  HAIKU_PROVIDER_ID,
  PRIMARY_PROVIDER_ID,
  type ProviderId,
} from '../../../shared/types/model';
import { appStateStore } from '../../state/appStateStore';
import { ActionType } from '../../state/actions';
import { generateId } from '../../../shared/utils/ids';

let sharedManager: SubAgentManager | null = null;

function getManager(providerFactory: (input: SubAgentSpawnInput) => AgentProvider): SubAgentManager {
  if (!sharedManager) sharedManager = new SubAgentManager(providerFactory);
  return sharedManager;
}

function objectInput(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Expected non-empty string input: ${key}`);
  }
  return value;
}

function parseAllowedTools(value: unknown): 'all' | AgentToolName[] | undefined {
  if (value === 'all') return 'all';
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is AgentToolName => typeof item === 'string') as AgentToolName[];
}

function parseProviderId(value: unknown): ProviderId | 'auto' | undefined {
  if (value === 'auto') return 'auto';
  if (value === PRIMARY_PROVIDER_ID || value === HAIKU_PROVIDER_ID || value === GEMINI_PROVIDER_ID) return value;
  if (value === 'codex') return PRIMARY_PROVIDER_ID;
  if (value === 'haiku') return HAIKU_PROVIDER_ID;
  if (value === 'gemini') return GEMINI_PROVIDER_ID;
  return undefined;
}

function logSubAgent(level: 'info' | 'warn' | 'error', message: string): void {
  appStateStore.dispatch({
    type: ActionType.ADD_LOG,
    log: {
      id: generateId('log'),
      timestamp: Date.now(),
      level,
      source: 'system',
      message,
    },
  });
}

export function createSubAgentToolDefinitions(providerFactory: (input: SubAgentSpawnInput) => AgentProvider): AgentToolDefinition[] {
  const manager = getManager(providerFactory);

  return [
    {
      name: 'subagent.spawn',
      description: 'Spawn a runtime-managed child agent. Use for independent delegated browser, filesystem, debugging, or research subtasks. Scope children with allowedTools and canSpawnSubagents when possible.',
      inputSchema: {
        type: 'object',
        required: ['task'],
        properties: {
          task: { type: 'string' },
          role: { type: 'string' },
          mode: { type: 'string', enum: ['unrestricted-dev', 'guarded', 'production'] },
          inheritedContext: { type: 'string', enum: ['full', 'summary', 'none'] },
          providerId: {
            type: 'string',
            enum: ['auto', PRIMARY_PROVIDER_ID, HAIKU_PROVIDER_ID, GEMINI_PROVIDER_ID, 'codex', 'haiku', 'gemini'],
          },
          allowedTools: { oneOf: [{ type: 'string', enum: ['all'] }, { type: 'array', items: { type: 'string' } }] },
          canSpawnSubagents: { type: 'boolean' },
        },
      },
      async execute(input: unknown, context) {
        const obj = objectInput(input);
        const spawnInput: SubAgentSpawnInput = {
          task: requireString(obj, 'task'),
          taskId: context.taskId,
          role: typeof obj.role === 'string' ? obj.role : 'subagent',
          mode: obj.mode === 'guarded' || obj.mode === 'production' ? obj.mode : 'unrestricted-dev',
          inheritedContext: obj.inheritedContext === 'full' || obj.inheritedContext === 'none' ? obj.inheritedContext : 'summary',
          providerId: parseProviderId(obj.providerId),
          allowedTools: parseAllowedTools(obj.allowedTools),
          canSpawnSubagents: typeof obj.canSpawnSubagents === 'boolean' ? obj.canSpawnSubagents : true,
        };
        const scope = manager.resolveScope(spawnInput);
        const { record, reused } = manager.spawnBackground(context.runId, spawnInput);
        logSubAgent(
          reused ? 'warn' : 'info',
          `${reused ? 'Reused' : 'Spawned'} sub-agent ${record.id}: ${record.role} scopeSource=${scope.source} scope=${scope.allowedTools === 'all' ? 'all' : scope.allowedTools.join(',')}`,
        );
        return {
          summary: reused ? `Reused running sub-agent ${record.id}` : `Spawned sub-agent ${record.id}`,
          data: { subagent: record, reused, scopeSource: scope.source, allowedTools: scope.allowedTools },
        };
      },
    },
    {
      name: 'subagent.wait',
      description: 'Wait for a child agent to complete and return its summary.',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
          timeoutMs: { type: 'number' },
        },
      },
      async execute(input: unknown) {
        const obj = objectInput(input);
        const waitInput: SubAgentWaitInput = {
          id: requireString(obj, 'id'),
          timeoutMs: typeof obj.timeoutMs === 'number' ? obj.timeoutMs : 120_000,
        };
        const result = await manager.wait(waitInput.id, waitInput.timeoutMs);
        logSubAgent(result.status === 'completed' ? 'info' : 'warn', `Sub-agent ${result.id} ${result.status}`);
        return {
          summary: `Sub-agent ${result.id} ${result.status}`,
          data: { result },
        };
      },
    },
    {
      name: 'subagent.cancel',
      description: 'Cancel a child agent record. In-flight model calls may finish, but future waits report cancellation.',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      async execute(input: unknown) {
        const record = manager.cancel(requireString(objectInput(input), 'id'));
        logSubAgent('warn', `Cancelled sub-agent ${record.id}`);
        return {
          summary: `Cancelled sub-agent ${record.id}`,
          data: { subagent: record },
        };
      },
    },
    {
      name: 'subagent.message',
      description: 'Append a message to a sub-agent. Not implemented yet; use spawn for self-contained child tasks.',
      inputSchema: {
        type: 'object',
        required: ['id', 'message'],
        properties: {
          id: { type: 'string' },
          message: { type: 'string' },
        },
      },
      async execute(input: unknown) {
        const obj = objectInput(input);
        const id = requireString(obj, 'id');
        requireString(obj, 'message');
        const record = manager.get(id);
        if (!record) throw new Error(`Sub-agent not found: ${id}`);
        return {
          summary: `Sub-agent ${id} does not support follow-up messages yet`,
          data: { subagent: record, supported: false },
        };
      },
    },
    {
      name: 'subagent.list',
      description: 'List runtime-managed child agents.',
      inputSchema: { type: 'object', properties: { parentRunId: { type: 'string' } } },
      async execute(input: unknown) {
        const parentRunId = typeof input === 'object' && input && 'parentRunId' in input
          ? String((input as { parentRunId?: unknown }).parentRunId || '')
          : '';
        return {
          summary: 'Listed sub-agents',
          data: { subagents: manager.list(parentRunId || undefined) },
        };
      },
    },
  ];
}
