import { AgentProvider, AgentRuntimeConfig, AgentProviderResult } from './AgentTypes';
import { agentPromptBuilder, buildResponseStyleAddendum } from './AgentPromptBuilder';
import { agentRunStore } from './AgentRunStore';
import { agentSkillLoader } from './AgentSkillLoader';
import { agentToolExecutor } from './AgentToolExecutor';
import { resolvePreflightToolPackExpansions } from './toolPacks';
import { createToolBindingStore } from './toolBindingScope';
import { appStateStore } from '../state/appStateStore';
import { ActionType } from '../state/actions';
import { generateId } from '../../shared/utils/ids';
import { LogSource } from '../../shared/types/appState';
import { isProviderId } from '../../shared/types/model';
import type { AgentProviderRequest } from './AgentTypes';
import { buildTaskProfile } from './taskProfile';

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
      const fullToolCatalog = filterToolCatalogForConfig(agentToolExecutor.list(), config);
      const hydratableToolCatalogDefs = filterHydratableToolCatalogForConfig(fullToolCatalog, config);
      const initialToolDefs = filterCallableToolsForConfig(hydratableToolCatalogDefs, config);
      const toolCatalogDefs = hydratableToolCatalogDefs;
      const initialTools = initialToolDefs.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
      const toolBindingStore = createToolBindingStore(
        initialTools,
        toolCatalogDefs.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      );
      const preflightExpansions = resolvePreflightToolPackExpansions(
        config.task,
        toolBindingStore.getCallableTools().map(tool => ({ name: tool.name })),
        toolCatalogDefs.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      );
      for (const expansion of preflightExpansions) {
        toolBindingStore.queueTools(expansion.tools);
        toolBindingStore.beginTurn();
      }
      const tools = toolBindingStore.getCallableTools();
      const callableToolNames = new Set(tools.map((tool) => tool.name));
      const callableToolDefs = toolCatalogDefs.filter((tool) => callableToolNames.has(tool.name));
      assertInitialBrowserScope(config.task, tools.map(tool => tool.name), config.requiresGroundedResearchHydration === true);
      
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
        tools: callableToolDefs,
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
        promptTools: tools,
        toolCatalog: toolCatalogDefs.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
        toolBindings: toolBindingStore.getBindings(),
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

export function assertInitialBrowserScope(
  task: string,
  toolNames: AgentProviderRequest['promptTools'][number]['name'][],
  requireBrowserScope = false,
): void {
  const profile = buildTaskProfile(task);
  if (!requireBrowserScope && profile.kind !== 'research' && profile.kind !== 'browser-automation') return;

  const hasBrowserTool = toolNames.some((name) => name.startsWith('browser.'));
  if (hasBrowserTool) return;

  throw new Error(
    requireBrowserScope
      ? 'Grounded research run blocked: initial MCP tool scope did not expose any browser.* tools.'
      : `Browser task blocked: initial MCP tool scope for ${profile.kind} did not expose any browser.* tools.`,
  );
}

function logPromptBudget(
  runId: string,
  config: AgentRuntimeConfig,
  input: {
    systemPrompt: string;
    contextPrompt?: string | null;
    skillCount: number;
    tools: AgentProviderRequest['promptTools'];
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
  tools: AgentProviderRequest['promptTools'],
): number {
  if (tools.length === 0) return 0;
  if (agentId === 'haiku') {
    return JSON.stringify(tools.map((tool) => ({
      name: tool.name.replace(/\./g, '__'),
      description: tool.description,
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

function filterCallableToolsForConfig(
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

function filterHydratableToolCatalogForConfig(
  tools: ReturnType<typeof agentToolExecutor.list>,
  config: AgentRuntimeConfig,
): ReturnType<typeof agentToolExecutor.list> {
  const hydratable = config.hydratableTools
    ?? (config.restrictToolCatalogToAllowedTools ? config.allowedTools : undefined);
  const allowed = hydratable === 'all' || !hydratable
    ? null
    : new Set(hydratable);

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
