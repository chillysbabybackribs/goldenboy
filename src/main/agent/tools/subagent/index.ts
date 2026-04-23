import { AgentProvider, AgentToolDefinition, AgentToolName } from '../../AgentTypes';
import { SubAgentManager, type SubAgentUsageRecorder } from '../../subagents/SubAgentManager';
import { SubAgentSpawnInput } from '../../subagents/SubAgentTypes';
import { appStateStore } from '../../../state/appStateStore';
import { ActionType } from '../../../state/actions';
import { generateId } from '../../../../shared/utils/ids';
import { activeToolNames } from '../../toolScopeState';

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
      description: 'Delegate a bounded subtask to a child agent; the child runs immediately and returns its result.',
      inputSchema: {
        type: 'object',
        required: ['task'],
        properties: {
          task: { type: 'string' },
          role: { type: 'string' },
          mode: { type: 'string', enum: ['unrestricted-dev', 'guarded', 'production'] },
          inheritedContext: { type: 'string', enum: ['full', 'summary', 'none'] },
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
          allowedTools: parseAllowedTools(obj.allowedTools),
          parentAllowedTools: context.toolScope
            ? activeToolNames(context.toolScope)
            : (context.runtimeAllowedTools ?? 'all'),
          canSpawnSubagents: typeof obj.canSpawnSubagents === 'boolean' ? obj.canSpawnSubagents : true,
          timeoutMs: typeof obj.timeoutMs === 'number' ? obj.timeoutMs : undefined,
          onStatus: (status) => context.onProgress?.(status),
        };
        const scope = manager.resolveScope(spawnInput);
        context.onProgress?.(`subagent-start:${spawnInput.role || 'subagent'} -> ${spawnInput.task}`);
        const { record, result } = await manager.run(context.runId, spawnInput);
        logSubAgent(
          result.status === 'completed' ? 'info' : 'warn',
          `Ran sub-agent ${record.id}: status=${result.status}`,
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
