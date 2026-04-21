import { AgentProvider, AgentRuntimeConfig, AgentProviderResult, PARTIAL_USAGE_ERROR_KEY } from './AgentTypes';
import {
  agentPromptBuilder,
  buildCurrentDateTimeLine,
  buildResponseStyleAddendum,
  type SystemPromptBreakdown,
} from './AgentPromptBuilder';
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
import { createToolScopeState, listActiveTools } from './toolScopeState';
import { isAgentCancellationError } from './cancellation';
import { describeInputSchemaCompact } from './CodexProvider';
import { taskMemoryStore } from '../models/taskMemoryStore';
import { buildBrowserContextBlock, type BrowserContextSources } from './browserContextInjection';
import { defaultBrowserContextSources } from './defaultBrowserContextSources';

export class AgentRuntime {
  private readonly browserContextSources: BrowserContextSources;

  constructor(
    private readonly provider: AgentProvider,
    options?: { browserContextSources?: BrowserContextSources },
  ) {
    this.browserContextSources = options?.browserContextSources ?? defaultBrowserContextSources;
  }

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
      const scopedTools = selectStartupToolsForConfig(runtimeToolRegistry, config);
      const toolScope = createToolScopeState(
        scopedTools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      );
      assertInitialBrowserScope(config.task, scopedTools.map(tool => tool.name));
      
      // OPTIMIZATION: Lazy-load skills.
      // If config.skillNames is provided, load them for the system prompt.
      // Otherwise, defer skill loading until the model requests them (via context addendum).
      const skillNames = config.skillNames ?? [];
      const skills = skillNames.length > 0 
        ? agentSkillLoader.loadSkills(skillNames)
        : [];
      
      const responseStyleAddendum = buildResponseStyleAddendum(config.task);
      const promptConfig: AgentRuntimeConfig = responseStyleAddendum
        ? {
          ...config,
          systemPromptAddendum: [config.systemPromptAddendum?.trim(), responseStyleAddendum].filter(Boolean).join('\n\n'),
        }
        : config;
      const promptInput = {
        config: promptConfig,
        skills,
        tools: scopedTools,
      };
      const systemPrompt = agentPromptBuilder.buildSystemPrompt(promptInput);
      const systemBreakdown = agentPromptBuilder.describeSystemPromptSections(promptInput);

      logPromptBudget(run.id, config, {
        systemPrompt,
        systemBreakdown,
        contextPrompt: config.contextPrompt,
        skillCount: skills.length,
        tools: scopedTools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
        lazyLoadEnabled: skillNames.length === 0,
      });
      
      const sessionMemory = getChatSessionMemory();
      const previousMessages = sessionMemory.getPreviousSessionContext();
      const sessionContextBlock = sessionMemory.buildContextInjectionString(previousMessages);
      // Datetime + browser overview ride the user turn so the system prompt stays
      // byte-stable for prompt-cache reuse. Browser overview sits before the
      // caller-supplied context so cross-tab working memory survives truncation
      // when the shared cap is tight.
      const browserContextBlock = buildBrowserContextBlock(this.browserContextSources);
      const taskMemoryBlock = config.taskId ? taskMemoryStore.buildContext(config.taskId) : null;
      const contextPrompt = packContextSections(
        [
          buildCurrentDateTimeLine(config.agentId),
          browserContextBlock,
          config.contextPrompt,
          sessionContextBlock,
          taskMemoryBlock,
        ],
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
        priorTurns: config.priorTurns,
        maxToolTurns: config.maxToolTurns,
        maxTokensOverride: config.maxTokensOverride,
        toolScope,
        tools: listActiveTools(toolScope),
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
      agentRunStore.finishRun(
        run.id,
        isAgentCancellationError(err) ? 'cancelled' : 'failed',
        null,
        message,
      );
      // Attach whatever usage the provider accumulated before the failure so
      // higher layers can record it instead of losing the spend to zeros.
      const partialUsage = this.provider.getPartialUsage?.() ?? null;
      if (partialUsage && err && typeof err === 'object') {
        try {
          (err as Record<string, unknown>)[PARTIAL_USAGE_ERROR_KEY] = partialUsage;
        } catch {
          // Best-effort; non-extensible errors are rare and the data is
          // advisory.
        }
      }
      throw err;
    }
  }
}

type AgentProviderUsage = NonNullable<AgentProviderResult['usage']>;

export function readPartialUsageFromError(err: unknown): AgentProviderUsage | null {
  if (!err || typeof err !== 'object') return null;
  const value = (err as Record<string, unknown>)[PARTIAL_USAGE_ERROR_KEY];
  if (!value || typeof value !== 'object') return null;
  const usage = value as Partial<AgentProviderUsage>;
  if (typeof usage.inputTokens !== 'number' || typeof usage.outputTokens !== 'number') return null;
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
    durationMs: typeof usage.durationMs === 'number' ? usage.durationMs : 0,
  };
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
    systemBreakdown?: SystemPromptBreakdown;
    contextPrompt?: string | null;
    skillCount: number;
    tools: AgentProviderRequest['tools'];
    lazyLoadEnabled?: boolean;
  },
): void {
  const systemChars = input.systemPrompt.length;
  const contextChars = input.contextPrompt?.length ?? 0;
  const taskChars = config.task.length;
  const sharedChars = systemChars + contextChars + taskChars;
  const toolPayloadChars = estimateProviderToolPayloadChars(config.agentId, input.tools);
  const totalChars = sharedChars + toolPayloadChars;

  const source = resolveLogSource(config.agentId);
  const timestamp = Date.now();

  appStateStore.dispatch({
    type: ActionType.ADD_LOG,
    log: {
      id: generateId('log'),
      timestamp,
      level: 'info',
      source,
      taskId: config.taskId,
      message: [
        `Prompt budget run=${runId}`,
        `agent=${config.agentId}`,
        `role=${config.role}`,
        `skills=${input.skillCount}`,
        `tools=${input.tools.length}`,
        `maxToolTurns=${config.maxToolTurns ?? 'default'}`,
        `systemChars=${systemChars}`,
        `contextChars=${contextChars}`,
        `taskChars=${taskChars}`,
        `sharedChars=${sharedChars}`,
        `sharedTokens=${Math.ceil(sharedChars / 4)}`,
        `toolPayloadChars=${toolPayloadChars}`,
        `toolPayloadTokens=${Math.ceil(toolPayloadChars / 4)}`,
        `totalChars=${totalChars}`,
        `totalEstTokens=${Math.ceil(totalChars / 4)}`,
        input.tools.length > 0 ? `scopedToolNames=${input.tools.map((tool) => tool.name).join(',')}` : 'scopedToolNames=none',
        input.lazyLoadEnabled ? 'lazyLoad=enabled' : '',
      ].filter(Boolean).join(' '),
    },
  });

  if (input.systemBreakdown) {
    const nonZeroSections = input.systemBreakdown.sections.filter((section) => section.chars > 0);
    const breakdownSummary = nonZeroSections
      .map((section) => `${section.name}=${section.chars}`)
      .join(' ');
    appStateStore.dispatch({
      type: ActionType.ADD_LOG,
      log: {
        id: generateId('log'),
        timestamp,
        level: 'info',
        source,
        taskId: config.taskId,
        message: `Prompt breakdown run=${runId} systemChars=${input.systemBreakdown.total} ${breakdownSummary}`,
      },
    });
  }
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
    const sig = describeInputSchemaCompact(tool.inputSchema);
    const head = sig ? `- ${tool.name}(${sig})` : `- ${tool.name}()`;
    return `${head}\n  ${tool.description}`;
  }).join('\n').length;
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

// Initial tool surface for a run.
//
// The long-standing "map-first" / lazy-load behavior used to hide most tools on
// startup and force the model to bootstrap its own scope via `context.load`.
// That caused every provider to lose access to tools mid-task whenever the
// startup regex failed to match intent. It is intentionally removed here.
//
// Rule, applied uniformly to every provider and every invocation:
//   - `allowedTools === 'all'` (or unset): expose every registered tool
//     (minus `subagent.*` if the caller explicitly disabled spawning).
//   - `allowedTools: AgentToolName[]`: the caller is opting in to a narrow
//     surface (e.g. a sub-agent spawn with a deliberate, explicit tool list).
//     Respect it exactly.
//
// There is no heuristic narrowing, no "startup scope", no preload regex.
function selectStartupToolsForConfig(
  tools: ReturnType<typeof agentToolExecutor.list>,
  config: AgentRuntimeConfig,
): ReturnType<typeof agentToolExecutor.list> {
  return filterToolsForConfig(tools, config);
}
