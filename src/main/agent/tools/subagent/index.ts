import { AgentProvider, AgentToolDefinition, AgentToolName } from '../../AgentTypes';
import { SubAgentManager, type SubAgentUsageRecorder } from '../../subagents/SubAgentManager';
import { SubAgentSpawnInput } from '../../subagents/SubAgentTypes';
import {
  GEMINI_PROVIDER_ID,
  HAIKU_PROVIDER_ID,
  PRIMARY_PROVIDER_ID,
  type ProviderId,
} from '../../../../shared/types/model';
import { appStateStore } from '../../../state/appStateStore';
import { ActionType } from '../../../state/actions';
import { generateId } from '../../../../shared/utils/ids';

let sharedManager: SubAgentManager | null = null;

function getManager(
  providerFactory: (input: SubAgentSpawnInput) => AgentProvider,
  recordUsage: SubAgentUsageRecorder | null,
): SubAgentManager {
  if (!sharedManager) sharedManager = new SubAgentManager(providerFactory, recordUsage);
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
  if (value === 'anthropic') return HAIKU_PROVIDER_ID;
  if (value === 'google') return GEMINI_PROVIDER_ID;
  return undefined;
}

function parseModelId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
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

export function createSubAgentToolDefinitions(
  providerFactory: (input: SubAgentSpawnInput) => AgentProvider,
  recordUsage: SubAgentUsageRecorder | null = null,
): AgentToolDefinition[] {
  const manager = getManager(providerFactory, recordUsage);

  return [
    {
      name: 'subagent.spawn',
      description: 'Delegate a bounded subtask to a child agent; the child runs immediately and returns its result. providerId picks the runtime (codex/haiku/gemini); modelId pins a specific model inside that runtime.',
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
            enum: ['auto', PRIMARY_PROVIDER_ID, HAIKU_PROVIDER_ID, GEMINI_PROVIDER_ID, 'codex', 'haiku', 'gemini', 'anthropic', 'google'],
          },
          modelId: { type: 'string' },
          allowedTools: { oneOf: [{ type: 'string', enum: ['all'] }, { type: 'array', items: { type: 'string' } }] },
          canSpawnSubagents: { type: 'boolean' },
          timeoutMs: { type: 'number' },
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
          modelId: parseModelId(obj.modelId),
          allowedTools: parseAllowedTools(obj.allowedTools),
          canSpawnSubagents: typeof obj.canSpawnSubagents === 'boolean' ? obj.canSpawnSubagents : true,
          timeoutMs: typeof obj.timeoutMs === 'number' ? obj.timeoutMs : undefined,
          onStatus: (status) => context.onProgress?.(status),
        };
        const scope = manager.resolveScope(spawnInput);
        context.onProgress?.(`subagent-start:${spawnInput.role || 'subagent'} -> ${spawnInput.task}`);
        const { record, result } = await manager.run(context.runId, spawnInput);
        logSubAgent(
          result.status === 'completed' ? 'info' : 'warn',
          `Ran sub-agent ${record.id}: status=${result.status} provider=${record.providerId ?? 'auto'} model=${record.modelId ?? 'default'}`,
        );
        context.onProgress?.(`subagent-done:${record.id} -> ${result.status}`);
        return {
          summary: `Sub-agent ${record.id} ${result.status}`,
          data: {
            subagent: record,
            scopeSource: scope.source,
            allowedTools: scope.allowedTools,
            result,
          },
        };
      },
    },
  ];
}
