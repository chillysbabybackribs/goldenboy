import { AgentProvider, AgentRuntimeConfig, AgentProviderResult } from './AgentTypes';
import { agentPromptBuilder, buildResponseStyleAddendum } from './AgentPromptBuilder';
import { agentRunStore } from './AgentRunStore';
import { agentSkillLoader } from './AgentSkillLoader';
import { agentToolExecutor } from './AgentToolExecutor';
import { resolvePreflightToolPackExpansions } from './toolPacks';
import { appStateStore } from '../state/appStateStore';
import { ActionType } from '../state/actions';
import { generateId } from '../../shared/utils/ids';
import { LogSource } from '../../shared/types/appState';
import { isProviderId } from '../../shared/types/model';
import type { AgentProviderRequest } from './AgentTypes';

export class AgentRuntime {
  constructor(private readonly provider: AgentProvider) {}

  abort(): void {
    if (this.provider.abort) {
      this.provider.abort();
    }
  }

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
      const toolCatalog = filterToolCatalogForConfig(agentToolExecutor.list(), config);
      let tools = filterToolsForConfig(toolCatalog, config);
      const preflightExpansions = resolvePreflightToolPackExpansions(
        config.task,
        tools.map(tool => ({ name: tool.name })),
        toolCatalog.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      );
      for (const expansion of preflightExpansions) {
        const toolCatalogByName = new Map(toolCatalog.map(tool => [tool.name, tool]));
        const currentToolNames = new Set(tools.map(tool => tool.name));
        const added = expansion.tools
          .map((name) => toolCatalogByName.get(name))
          .filter((tool): tool is (typeof toolCatalog)[number] => Boolean(tool))
          .filter((tool) => !currentToolNames.has(tool.name));
        tools = [...tools, ...added];
      }
      
      // OPTIMIZATION: Lazy-load skills.
      // If config.skillNames is provided, load them for the system prompt.
      // Otherwise, defer skill loading until the model requests them (via context addendum).
      const skillNames = config.skillNames ?? [];
      const skills = skillNames.length > 0 
        ? agentSkillLoader.loadSkills(skillNames)
        : [];
      
      const responseStyleAddendum = buildResponseStyleAddendum(config.task);
      const systemPrompt = agentPromptBuilder.buildSystemPrompt({
        config: responseStyleAddendum
          ? {
            ...config,
            systemPromptAddendum: [config.systemPromptAddendum?.trim(), responseStyleAddendum].filter(Boolean).join('\n\n'),
          }
          : config,
        skills,
        tools,
      });
      
      logPromptBudget(run.id, config, {
        systemPrompt,
        contextPrompt: config.contextPrompt,
        skillCount: skills.length,
        tools: tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
        lazyLoadEnabled: skillNames.length === 0,
        preflightExpansions,
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
        toolCatalog: toolCatalog.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
        attachments: config.attachments,
        onToken: config.onToken,
        onStatus: config.onStatus,
        onItem: config.onItem,
      });

      agentRunStore.finishRun(run.id, 'completed', result.output.slice(0, 500));
      return {
        ...result,
        runId: run.id,
      };
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
    tools: AgentProviderRequest['tools'];
    lazyLoadEnabled?: boolean;
    preflightExpansions?: Array<{ pack: string; reason: string }>;
  },
): void {
  const systemChars = input.systemPrompt.length;
  const contextChars = input.contextPrompt?.length ?? 0;
  const taskChars = config.task.length;
  const sharedChars = systemChars + contextChars + taskChars;
  const toolPayloadChars = estimateProviderToolPayloadChars(config.agentId, input.tools);
  const totalChars = sharedChars + toolPayloadChars;
  appStateStore.dispatch({
    type: ActionType.ADD_LOG,
    log: {
      id: generateId('log'),
      timestamp: Date.now(),
      level: 'info',
      source: resolveLogSource(config.agentId),
      taskId: config.taskId,
      message: [
        `Prompt budget run=${runId}`,
        `agent=${config.agentId}`,
        `role=${config.role}`,
        `skills=${input.skillCount}`,
        `tools=${input.tools.length}`,
        `maxToolTurns=${config.maxToolTurns ?? 'default'}`,
        `sharedChars=${sharedChars}`,
        `sharedTokens=${Math.ceil(sharedChars / 4)}`,
        `toolPayloadChars=${toolPayloadChars}`,
        `toolPayloadTokens=${Math.ceil(toolPayloadChars / 4)}`,
        `totalChars=${totalChars}`,
        `totalEstTokens=${Math.ceil(totalChars / 4)}`,
        input.preflightExpansions?.length
          ? `preflightPacks=${input.preflightExpansions.map((expansion) => `${expansion.pack}:${expansion.reason}`).join('|')}`
          : '',
        input.lazyLoadEnabled ? 'lazyLoad=enabled' : '',
      ].filter(Boolean).join(' '),
    },
  });
}

function estimateProviderToolPayloadChars(
  agentId: string,
  tools: AgentProviderRequest['tools'],
): number {
  if (tools.length === 0) return 0;
  if (agentId === 'haiku') {
    return JSON.stringify(tools.map((tool) => ({
      name: tool.name.replace(/\./g, '__'),
      description: `${tool.description}\n\nV2 tool name: ${tool.name}`,
      input_schema: tool.inputSchema,
    }))).length;
  }

  return tools.map((tool) => {
    const schema = JSON.stringify(tool.inputSchema, null, 2);
    return [
      `- ${tool.name}`,
      `  Description: ${tool.description}`,
      `  Input schema: ${schema}`,
    ].join('\n');
  }).join('\n\n').length;
}

function resolveLogSource(agentId: string): LogSource {
  return isProviderId(agentId) ? agentId : 'system';
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

function filterToolCatalogForConfig(
  tools: ReturnType<typeof agentToolExecutor.list>,
  config: AgentRuntimeConfig,
): ReturnType<typeof agentToolExecutor.list> {
  return tools.filter((tool) => {
    if (config.canSpawnSubagents === false && tool.name.startsWith('subagent.')) return false;
    return true;
  });
}
