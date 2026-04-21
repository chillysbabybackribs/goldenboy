import { AgentProvider, AgentRuntimeConfig, AgentProviderResult } from './AgentTypes';
import { agentPromptBuilder, buildResponseStyleAddendum } from './AgentPromptBuilder';
import { agentRunStore } from './AgentRunStore';
import { agentSkillLoader } from './AgentSkillLoader';
import { agentToolExecutor } from './AgentToolExecutor';
import { appStateStore } from '../state/appStateStore';
import { ActionType } from '../state/actions';
import { generateId } from '../../shared/utils/ids';
import { LogSource } from '../../shared/types/appState';
import { isProviderId } from '../../shared/types/model';
import type { AgentProviderRequest } from './AgentTypes';
import { buildTaskProfile } from './taskProfile';
import { getChatSessionMemory } from '../chatKnowledge/ChatSessionMemory';

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
      const runtimeToolRegistry = filterToolRegistryForConfig(agentToolExecutor.list(), config);
      const scopedTools = filterToolsForConfig(runtimeToolRegistry, config);
      const loadableTools = config.restrictLoadableToolsToAllowedTools ? scopedTools : runtimeToolRegistry;
      assertInitialBrowserScope(config.task, scopedTools.map(tool => tool.name));
      
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
        tools: scopedTools,
      });
      
      logPromptBudget(run.id, config, {
        systemPrompt,
        contextPrompt: config.contextPrompt,
        skillCount: skills.length,
        tools: scopedTools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
        loadableTools: loadableTools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
        lazyLoadEnabled: skillNames.length === 0,
      });
      
      const sessionMemory = getChatSessionMemory();
      const previousMessages = sessionMemory.getPreviousSessionContext();
      const sessionContextBlock = sessionMemory.buildContextInjectionString(previousMessages);
      const contextPrompt = packContextSections(
        [config.contextPrompt, sessionContextBlock],
        4_000,
        '\n...[context truncated]',
      );

      const result = await this.provider.invoke({
        runId: run.id,
        agentId: config.agentId,
        mode: config.mode,
        taskId: config.taskId,
        systemPrompt,
        task: config.task,
        contextPrompt,
        maxToolTurns: config.maxToolTurns,
        tools: scopedTools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
        loadableTools: loadableTools.map(tool => ({
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

export function assertInitialBrowserScope(
  task: string,
  toolNames: AgentProviderRequest['tools'][number]['name'][],
): void {
  const profile = buildTaskProfile(task);
  if (profile.kind !== 'research' && profile.kind !== 'browser-automation') return;

  const hasBrowserTool = toolNames.some((name) => name.startsWith('browser.'));
  if (hasBrowserTool) return;

  throw new Error(
    `Browser task blocked: initial MCP tool scope for ${profile.kind} did not expose any browser.* tools.`,
  );
}

function packContextSections(
  parts: Array<string | null | undefined>,
  maxChars: number,
  truncationSuffix: string,
): string | null {
  const normalized = parts
    .map(part => part?.trim())
    .filter((part): part is string => Boolean(part));
  if (normalized.length === 0) return null;

  const packed: string[] = [];
  let used = 0;

  for (const part of normalized) {
    const separator = packed.length > 0 ? '\n\n' : '';
    const available = maxChars - used - separator.length;
    if (available <= 0) break;

    if (part.length <= available) {
      packed.push(separator ? `${separator}${part}` : part);
      used += separator.length + part.length;
      continue;
    }

    const reserveForSuffix = truncationSuffix.length;
    if (available <= reserveForSuffix) break;
    const truncated = `${part.slice(0, available - reserveForSuffix)}${truncationSuffix}`;
    packed.push(separator ? `${separator}${truncated}` : truncated);
    break;
  }

  const context = packed.join('');
  return context || null;
}

function logPromptBudget(
  runId: string,
  config: AgentRuntimeConfig,
  input: {
    systemPrompt: string;
    contextPrompt?: string | null;
    skillCount: number;
    tools: AgentProviderRequest['tools'];
    loadableTools: AgentProviderRequest['loadableTools'];
    lazyLoadEnabled?: boolean;
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
        `loadableTools=${input.loadableTools.length}`,
        `maxToolTurns=${config.maxToolTurns ?? 'default'}`,
        `sharedChars=${sharedChars}`,
        `sharedTokens=${Math.ceil(sharedChars / 4)}`,
        `toolPayloadChars=${toolPayloadChars}`,
        `toolPayloadTokens=${Math.ceil(toolPayloadChars / 4)}`,
        `totalChars=${totalChars}`,
        `totalEstTokens=${Math.ceil(totalChars / 4)}`,
        input.tools.length > 0 ? `scopedToolNames=${input.tools.map((tool) => tool.name).join(',')}` : 'scopedToolNames=none',
        input.loadableTools.length > 0 ? `loadableToolNames=${input.loadableTools.map((tool) => tool.name).join(',')}` : 'loadableToolNames=none',
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
    // OPTIMIZATION: Compact tool schema for Haiku
    // - Keep dots in tool names (Haiku handles dot notation well)
    // - Use compact JSON (no pretty-print spaces)
    // - Store only essential fields: name, description, input_schema
    return JSON.stringify(tools.map((tool) => ({
      name: tool.name,
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

function filterToolRegistryForConfig(
  tools: ReturnType<typeof agentToolExecutor.list>,
  config: AgentRuntimeConfig,
): ReturnType<typeof agentToolExecutor.list> {
  return tools.filter((tool) => {
    if (config.canSpawnSubagents === false && tool.name.startsWith('subagent.')) return false;
    return true;
  });
}
