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
import { createToolScopeState, listActiveTools } from './toolScopeState';
import { isAgentCancellationError } from './cancellation';
import { describeInputSchemaCompact } from './providerToolRuntime';
import { taskMemoryStore } from '../models/taskMemoryStore';
import { buildBrowserContextBlock, type BrowserContextSources } from './browserContextInjection';
import { defaultBrowserContextSources } from './defaultBrowserContextSources';
import type { FinalAnswer } from '../../shared/types/finalAnswer';
import type { AgentToolResult } from './AgentTypes';

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
      assertInitialBrowserScope(config.task, scopedTools.map(tool => tool.name), config.taskProfileOverride);
      
      // Skill loading is split in two:
      //   - Eagerly load any skill names the task profile (or caller) has
      //     high confidence about. These get injected as full bodies.
      //   - Always load the full skill index (name + description) so the
      //     model can call `skill.load` to pull additional skills on demand.
      const skillNames = config.skillNames ?? [];
      const skills = skillNames.length > 0
        ? agentSkillLoader.loadSkills(skillNames)
        : [];
      const availableSkills = agentSkillLoader.listSkills();

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
        availableSkills,
        tools: scopedTools,
      };
      const systemPrompt = agentPromptBuilder.buildSystemPrompt(promptInput);
      const systemBreakdown = agentPromptBuilder.describeSystemPromptSections(promptInput);

      logPromptBudget(run.id, config, {
        systemPrompt,
        systemBreakdown,
        contextPrompt: config.contextPrompt,
        skillCount: skills.length,
        availableSkillCount: availableSkills.length,
        tools: scopedTools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });
      
      // Datetime + browser overview ride the user turn so the system prompt stays
      // byte-stable for prompt-cache reuse. Browser overview sits before the
      // caller-supplied context so cross-tab working memory survives truncation
      // when the shared cap is tight.
      const browserContextBlock = buildBrowserContextBlock(
        this.browserContextSources,
        config.taskId ? { taskId: config.taskId } : undefined,
      );
      const taskMemoryBlock = config.taskId ? taskMemoryStore.buildContext(config.taskId) : null;
      const contextPrompt = packContextSections(
        [
          buildCurrentDateTimeLine(config.agentId),
          browserContextBlock,
          config.contextPrompt,
          config.suppressTaskMemoryContext ? null : taskMemoryBlock,
        ],
        4_000,
        '\n...[context truncated]',
      );

      if (shouldAutoRunDeterministicBrowserSearch(config.taskProfileOverride)) {
        const startedAt = Date.now();
        const workflowId = 'browser-automation-research';
        config.onStatus?.(`tool-start:Browser: run workflow ${workflowId}`);
        const workflowResult = await agentToolExecutor.execute(
          'browser.run_workflow',
          {
            workflowId,
            inputs: {
              query: extractBrowserSearchQuery(config.task),
            },
          },
          {
            runId: run.id,
            agentId: config.agentId,
            mode: config.mode,
            taskId: config.taskId,
            onProgress: config.onStatus,
            toolScope,
            runtimeAllowedTools: config.allowedTools ?? 'all',
          },
        );
        config.onStatus?.(`tool-done:Browser: run workflow ${workflowId} -> ${workflowResult.summary}`);
        const directResult = {
          output: renderDeterministicBrowserSearchOutput(workflowResult),
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            durationMs: Date.now() - startedAt,
          },
        } satisfies AgentProviderResult;
        agentRunStore.finishRun(run.id, 'completed', directResult.output.slice(0, 500));
        return {
          ...directResult,
          runId: run.id,
        };
      }

      const result = await this.provider.invoke({
        runId: run.id,
        agentId: config.agentId,
        mode: config.mode,
        taskId: config.taskId,
        forceFreshThread: config.forceFreshThread,
        systemPrompt,
        task: config.task,
        contextPrompt,
        priorTurns: config.priorTurns,
        maxToolTurns: config.maxToolTurns,
        maxTokensOverride: config.maxTokensOverride,
        toolScope,
        tools: listActiveTools(toolScope),
        runtimeAllowedTools: config.allowedTools ?? 'all',
        attachments: config.attachments,
        onToken: config.onToken,
        onStatus: config.onStatus,
        onItem: config.onItem,
      });

      const groundedResult = attachGroundedFinalAnswer(run.id, result);

      agentRunStore.finishRun(run.id, 'completed', groundedResult.output.slice(0, 500));
      return {
        ...groundedResult,
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

function shouldAutoRunDeterministicBrowserSearch(
  taskProfileOverride?: import('../../shared/types/model').AgentTaskProfileOverride,
): boolean {
  return taskProfileOverride?.kind === 'browser-search';
}

function extractBrowserSearchQuery(task: string): string {
  const marker = '\nUser request:';
  const index = task.lastIndexOf(marker);
  if (index === -1) return task.trim();
  return task.slice(index + marker.length).trim();
}

function renderDeterministicBrowserSearchOutput(result: AgentToolResult): string {
  const stepResults = result.data.stepResults;
  if (!stepResults || typeof stepResults !== 'object') return result.summary;

  const searchStep = (stepResults as Record<string, unknown>).search_browser_automation;
  if (!searchStep || typeof searchStep !== 'object') return result.summary;

  const searchData = (searchStep as Record<string, unknown>).data;
  if (!searchData || typeof searchData !== 'object') return result.summary;

  const openedPages = (searchData as Record<string, unknown>).openedPages;
  if (!Array.isArray(openedPages) || openedPages.length === 0) return result.summary;

  const firstPage = openedPages[0];
  if (!firstPage || typeof firstPage !== 'object') return result.summary;

  const page = firstPage as Record<string, unknown>;
  const answerEvidence = Array.isArray(page.answerEvidence)
    ? page.answerEvidence.find((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : null;
  const summary = typeof page.summary === 'string' ? page.summary.trim() : '';
  const title = typeof page.title === 'string' ? page.title.trim() : '';
  const url = typeof page.url === 'string' ? page.url.trim() : '';
  const lines = [answerEvidence || summary || result.summary];

  if (title || url) {
    lines.push([title, url].filter(Boolean).join(' — '));
  }

  return lines.filter(Boolean).join('\n\n');
}

function attachGroundedFinalAnswer(runId: string, result: AgentProviderResult): AgentProviderResult {
  const latestSubmit = agentRunStore.findLatestToolCall(runId, 'answer.submit');
  if (!latestSubmit || latestSubmit.status !== 'completed') return result;
  const output = latestSubmit.output;
  if (!output || typeof output !== 'object') return result;
  const data = 'data' in output && output.data && typeof output.data === 'object'
    ? output.data as Record<string, unknown>
    : null;
  const finalAnswer = data?.finalAnswer as FinalAnswer | undefined;
  if (!finalAnswer) return result;

  return {
    ...result,
    output: renderFinalAnswer(finalAnswer),
    finalAnswer,
  };
}

function renderFinalAnswer(finalAnswer: FinalAnswer): string {
  const claims = finalAnswer.claims.map((claim) => {
    const refs = claim.evidence
      .map((ref) => `[ref:${ref.toolCallId.slice(0, 8)}]`)
      .join(' ');
    return refs ? `${claim.text} ${refs}` : claim.text;
  });
  const unresolved = finalAnswer.unresolved.map((item) => `- ${item.question}: ${item.reason}`);
  if (unresolved.length === 0) {
    return claims.join('\n\n').trim();
  }
  return `${claims.join('\n\n').trim()}\n\nUnresolved:\n${unresolved.join('\n')}`.trim();
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
  taskProfileOverride?: import('../../shared/types/model').AgentTaskProfileOverride,
): void {
  const profile = buildTaskProfile(task, taskProfileOverride);
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
    availableSkillCount?: number;
    tools: AgentProviderRequest['tools'];
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
        `availableSkills=${input.availableSkillCount ?? 0}`,
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
// Every registered tool is exposed to the model from the first turn. The
// legacy lazy-load / map-first bootstrap step is intentionally not present.
//
// Rule, applied uniformly to every invocation:
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
