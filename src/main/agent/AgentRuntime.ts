import { AgentProvider, AgentRuntimeConfig, AgentProviderResult } from './AgentTypes';
import { agentPromptBuilder } from './AgentPromptBuilder';
import { agentRunStore } from './AgentRunStore';
import { agentSkillLoader } from './AgentSkillLoader';
import { agentToolExecutor } from './AgentToolExecutor';
import { appStateStore } from '../state/appStateStore';
import { ActionType } from '../state/actions';
import { generateId } from '../../shared/utils/ids';

export class AgentRuntime {
  constructor(private readonly provider: AgentProvider) {}

  async run(config: AgentRuntimeConfig): Promise<AgentProviderResult> {
    const run = agentRunStore.createRun({
      parentRunId: config.parentRunId ?? null,
      depth: config.depth ?? 0,
      role: config.role,
      task: config.task,
      mode: config.mode,
    });

    agentRunStore.updateRun(run.id, { status: 'running' });

    try {
      const skills = agentSkillLoader.loadSkills(config.skillNames ?? []);
      const tools = filterToolsForConfig(agentToolExecutor.list(), config);
      const systemPrompt = agentPromptBuilder.buildSystemPrompt({ config, skills, tools });
      logPromptBudget(run.id, config, {
        systemPrompt,
        contextPrompt: config.contextPrompt,
        skillCount: skills.length,
        toolCount: tools.length,
      });
      const result = await this.provider.invoke({
        runId: run.id,
        agentId: config.agentId,
        mode: config.mode,
        taskId: config.taskId,
        systemPrompt,
        task: config.task,
        contextPrompt: config.contextPrompt,
        maxToolTurns: config.maxToolTurns,
        tools: tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
        onToken: config.onToken,
      });

      agentRunStore.finishRun(run.id, 'completed', result.output.slice(0, 500));
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      agentRunStore.finishRun(run.id, 'failed', null, message);
      throw err;
    }
  }
}

function logPromptBudget(
  runId: string,
  config: AgentRuntimeConfig,
  input: {
    systemPrompt: string;
    contextPrompt?: string | null;
    skillCount: number;
    toolCount: number;
  },
): void {
  const systemChars = input.systemPrompt.length;
  const contextChars = input.contextPrompt?.length ?? 0;
  const taskChars = config.task.length;
  const totalChars = systemChars + contextChars + taskChars;
  appStateStore.dispatch({
    type: ActionType.ADD_LOG,
    log: {
      id: generateId('log'),
      timestamp: Date.now(),
      level: 'info',
      source: 'haiku',
      taskId: config.taskId,
      message: [
        `Prompt budget run=${runId}`,
        `agent=${config.agentId}`,
        `role=${config.role}`,
        `skills=${input.skillCount}`,
        `tools=${input.toolCount}`,
        `maxToolTurns=${config.maxToolTurns ?? 'default'}`,
        `chars=${totalChars}`,
        `estTokens=${Math.ceil(totalChars / 4)}`,
      ].join(' '),
    },
  });
}

function filterToolsForConfig(
  tools: ReturnType<typeof agentToolExecutor.list>,
  config: AgentRuntimeConfig,
): ReturnType<typeof agentToolExecutor.list> {
  const allowed = config.allowedTools === 'all' || !config.allowedTools
    ? null
    : new Set(config.allowedTools);

  return tools.filter((tool) => {
    if (config.canSpawnSubagents === false && tool.name.startsWith('subagent.')) return false;
    return !allowed || allowed.has(tool.name);
  });
}
