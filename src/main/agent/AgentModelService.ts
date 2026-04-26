import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/types/ipc';
import { LogSource } from '../../shared/types/appState';
import {
  PRIMARY_PROVIDER_ID,
  AgentInvocationOptions,
  InvocationProgress,
  InvocationResult,
  ProviderId,
  ProviderRuntime,
} from '../../shared/types/model';
import { ActionType } from '../state/actions';
import { appStateStore } from '../state/appStateStore';
import { eventBus } from '../events/eventBus';
import { AppEventType } from '../../shared/types/events';
import { generateId } from '../../shared/utils/ids';
import { AgentProvider, AgentProviderResult, AgentToolName } from './AgentTypes';
import { AgentRuntime, readPartialUsageFromError } from './AgentRuntime';
import { probeCodexAvailability } from './codexBinary';
import { AppServerBackedProvider } from './AppServerBackedProvider';
import { agentToolExecutor } from './AgentToolExecutor';
import { createBrowserToolDefinitions } from './tools/browser';
import { createAnswerSubmitToolDefinitions } from './tools/answerSubmit';
import { createSessionMemoryToolDefinitions } from './tools/session';
import { createSkillToolDefinitions } from './tools/skills';
import { createAttachmentToolDefinitions, DOCUMENT_ATTACHMENT_TOOL_NAMES } from './tools/attachments';
import { createFilesystemToolDefinitions } from './tools/filesystem';
import { createMemoryToolDefinitions } from './tools/memory';
import { createTerminalToolDefinitions } from './tools/terminal';
import { createSubAgentToolDefinitions } from './tools/subagent';
import { createRepoMapToolDefinitions } from './tools/repomap';
import { createWorkspaceToolDefinitions } from './tools/workspace';
import { workspaceManifestService } from './workspaceManifest';
import { APP_WORKSPACE_ROOT } from '../workspaceRoot';
import { taskMemoryStore } from '../models/taskMemoryStore';
import { chatKnowledgeStore } from '../chatKnowledge/ChatKnowledgeStore';
import {
  applyAdaptiveTaskProfileOverride,
  scopeForPrompt,
  withBrowserSearchDirective,
  withExecutionModeDirective,
} from './runtimeScope';
import { SubAgentSpawnInput } from './subagents/SubAgentTypes';
import { buildTaskProfile } from './taskProfile';
import { looksLikeExecutionEscapePrompt } from './taskProfile';
import { browserService } from '../browser/BrowserService';
import type { AgentTaskKind } from '../../shared/types/model';
import { buildStartupStatusMessages } from './startupProgress';
import type { InvocationAttachment } from '../../shared/types/model';
import type { TaskPlanMetadata } from '../../shared/types/model';
import type { DocumentInvocationAttachment } from '../../shared/types/attachments';
import { getAgentCancellationMessage, isAgentCancellationError } from './cancellation';

type ProviderEntry = {
  id: ProviderId;
  label: string;
  modelId?: string;
  supportsAppToolExecutor: boolean;
};

type ActiveTaskInvocation = {
  providerId: ProviderId;
  runtime: AgentRuntime;
  taskKey: string;
};

type WarmTaskProvider = {
  provider: AgentProvider;
  dispose?: () => Promise<void>;
};

const PRIMARY_PROVIDER_CONFIG = {
  id: PRIMARY_PROVIDER_ID,
  label: 'Codex',
  modelId: PRIMARY_PROVIDER_ID,
} satisfies { id: ProviderId; label: string; modelId: string };

function buildAttachmentSummary(attachments?: InvocationAttachment[]): string | null {
  if (!attachments?.length) return null;
  const images = attachments.filter((attachment) => attachment.type === 'image');
  const documents = attachments.filter((attachment): attachment is DocumentInvocationAttachment => attachment.type === 'document');
  const parts: string[] = [];

  if (images.length === 1) {
    parts.push(images[0].name?.trim() ? `[Attached image: ${images[0].name.trim()}]` : '[Attached image]');
  } else if (images.length > 1) {
    const names = images
      .map((attachment) => attachment.name?.trim())
      .filter((name): name is string => Boolean(name));
    if (names.length > 0) {
      const listed = names.slice(0, 3).join(', ');
      const suffix = names.length > 3 ? `, +${names.length - 3} more` : '';
      parts.push(`[Attached images: ${listed}${suffix}]`);
    } else {
      parts.push(`[Attached ${images.length} images]`);
    }
  }

  if (documents.length === 1) {
    parts.push(`[Attached document: ${documents[0].name}]`);
  } else if (documents.length > 1) {
    const listed = documents.slice(0, 3).map((document) => document.name).join(', ');
    const suffix = documents.length > 3 ? `, +${documents.length - 3} more` : '';
    parts.push(`[Attached documents: ${listed}${suffix}]`);
  }

  return parts.join('\n') || null;
}

function buildChatUserMessageText(prompt: string, attachments?: InvocationAttachment[]): string {
  const text = prompt.trim();
  const attachmentSummary = buildAttachmentSummary(attachments);
  if (text && attachmentSummary) return `${text}\n${attachmentSummary}`;
  if (text) return text;
  return attachmentSummary || prompt;
}

function summarizeOrchestrationMilestone(output: string): string {
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const important = lines
    .filter((line) => /^[-*]/.test(line) || /^\d+\./.test(line) || /objective:|tracks:|delegation:|validation:|next action:/i.test(line))
    .slice(0, 4)
    .map((line) => line.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, ''));

  const selected = important.length > 0 ? important : lines.slice(0, 3);
  const compact = selected.join(' | ').replace(/\s+/g, ' ').trim();
  return compact.length > 400 ? `${compact.slice(0, 400)}...` : compact;
}

function mergeContinuationText(previous: string, next: string): string {
  if (!previous) return next;
  if (!next) return previous;
  if (previous.endsWith(next)) return previous;
  if (next.startsWith(previous)) return next;

  const maxOverlap = Math.min(400, previous.length, next.length);
  for (let size = maxOverlap; size >= 24; size--) {
    if (previous.slice(-size) === next.slice(0, size)) {
      return `${previous}${next.slice(size)}`;
    }
  }
  return `${previous}${next}`;
}

function mergeUsage(
  left?: AgentProviderResult['usage'] | null,
  right?: AgentProviderResult['usage'] | null,
): AgentProviderResult['usage'] {
  return {
    inputTokens: (left?.inputTokens ?? 0) + (right?.inputTokens ?? 0),
    outputTokens: (left?.outputTokens ?? 0) + (right?.outputTokens ?? 0),
    cachedInputTokens: (left?.cachedInputTokens ?? 0) + (right?.cachedInputTokens ?? 0),
    cacheCreationInputTokens: (left?.cacheCreationInputTokens ?? 0) + (right?.cacheCreationInputTokens ?? 0),
    durationMs: (left?.durationMs ?? 0) + (right?.durationMs ?? 0),
  };
}

function buildInitialPlanMetadata(prompt: string): TaskPlanMetadata {
  return {
    category: 'plan',
    stage: 'scaffold',
    objective: prompt.trim(),
    delegation: [
      'Keep the parent on the critical path.',
      'Spawn only bounded independent sub-agents with explicit ownership and validation.',
    ],
    validation: [
      'Confirm each milestone with observed runtime events.',
      'Prefer compact executable plans over broad strategy text.',
    ],
    nextAction: 'Break the work into the smallest independent tracks before executing.',
  };
}

function buildParentTurnPlanMetadata(
  output: string,
  providerId: ProviderId,
  stage: 'parent-turn-complete' | 'parent-turn-failed' | 'parent-turn-cancelled',
): TaskPlanMetadata {
  const compact = summarizeOrchestrationMilestone(output);
  return {
    category: 'plan',
    stage,
    providerId,
    tracks: /tracks:/i.test(compact) ? [compact] : [],
    nextAction: /next action:/i.test(compact) ? compact : undefined,
    validation: /validation:/i.test(compact) ? [compact] : [],
  };
}

function shouldAutoProgressChecklist(prompt: string): boolean {
  return /\b(continue|keep going|carry on|start|implement|implementation|work on|do the next|next step|next one|patch|fix|build|apply)\b/i.test(prompt);
}

function buildSubagentContinuationContext(taskId: string, taskKind: AgentTaskKind): string | null {
  const planContext = taskMemoryStore.buildPlanContext(taskId);
  const snapshot = taskMemoryStore.getPlanSnapshot(taskId);
  if (!planContext && !snapshot) return null;

  const sections: string[] = [];
  if (snapshot) {
    sections.push(taskKind === 'orchestration' ? '## Orchestration Guidance' : '## Sub-Agent Status');
    if (snapshot.latestStage) sections.push(`Latest stage: ${snapshot.latestStage}`);
    if (snapshot.runningSubagents.length > 0) {
      sections.push(`Running sub-agents: ${snapshot.runningSubagents.map(item => `${item.role} (${item.subagentId})`).join(', ')}`);
      sections.push(taskKind === 'orchestration'
        ? 'Do not spawn duplicate sub-agents for work that is already running unless the task has materially changed.'
        : 'Do not lose track of already-running child work. Prefer checking the existing child before spawning a duplicate.');
      sections.push(taskKind === 'orchestration'
        ? 'Prefer continuing local critical-path work or waiting if the next step depends on a running child.'
        : 'If the user asks for progress or completion, use the current child status as the first continuity checkpoint.');
    }
    if (snapshot.blockedSubagents.length > 0) {
      sections.push(`Blocked sub-agents: ${snapshot.blockedSubagents.map(item => `${item.role}`).join(', ')}`);
      sections.push(taskKind === 'orchestration'
        ? 'Resolve the known blocker or explicitly change the plan before spawning replacement sub-agents.'
        : 'Resolve the known blocker or state it clearly before starting replacement child work.');
    }
    if (snapshot.nextAction) {
      sections.push(`Priority next action: ${snapshot.nextAction}`);
    }
    if (snapshot.completedSubagents.length > 0) {
      sections.push(`Completed sub-agents: ${snapshot.completedSubagents.map(item => item.role).join(', ')}`);
    }
  }

  if (planContext) sections.push(planContext);
  return sections.join('\n\n').trim() || null;
}

function buildDocumentAttachmentContext(attachments?: InvocationAttachment[]): string | null {
  const documents = attachments?.filter((attachment): attachment is DocumentInvocationAttachment => attachment.type === 'document') || [];
  if (documents.length === 0) return null;

  const sections = [
    '## Attached Documents',
    'One or more task documents were staged by the host. Use attachments.list to inspect them, attachments.search to find relevant passages, and attachments.read_chunk or attachments.read_document for details. Do not assume document contents from filenames alone.',
  ];

  for (const [index, document] of documents.slice(0, 5).entries()) {
    const detail = [
      document.mediaType,
      `${document.sizeBytes} bytes`,
      `status=${document.status}`,
      document.chunkCount > 0 ? `${document.chunkCount} chunks` : '',
    ].filter(Boolean).join(' • ');
    sections.push('', `${index + 1}. ${document.name} (${detail})`);
    if (document.excerpt) sections.push(document.excerpt);
  }

  if (documents.length > 5) {
    sections.push('', `...and ${documents.length - 5} more attached documents.`);
  }

  return sections.join('\n');
}

function withDocumentAttachmentTools(
  allowedTools: 'all' | AgentToolName[],
  attachments?: InvocationAttachment[],
): 'all' | AgentToolName[] {
  if (allowedTools === 'all') return 'all';
  const hasDocuments = attachments?.some((attachment) => attachment.type === 'document');
  if (!hasDocuments) return allowedTools;
  return Array.from(new Set([...allowedTools, ...DOCUMENT_ATTACHMENT_TOOL_NAMES]));
}

class AgentModelService {
  private providers = new Map<ProviderId, ProviderEntry>();
  private activeTaskProviders = new Map<string, ActiveTaskInvocation>();
  private warmTaskProviders = new Map<string, WarmTaskProvider>();
  private idleWarmProvider: WarmTaskProvider | null = null;

  init(): void {
    agentToolExecutor.registerMany([
      ...createAnswerSubmitToolDefinitions(),
      ...createAttachmentToolDefinitions(),
      ...createBrowserToolDefinitions(),
      ...createSessionMemoryToolDefinitions(),
      ...createSkillToolDefinitions(),
      ...createFilesystemToolDefinitions(),
      ...createMemoryToolDefinitions(),
      ...createTerminalToolDefinitions(),
      ...createRepoMapToolDefinitions(),
      ...createWorkspaceToolDefinitions(),
      ...createSubAgentToolDefinitions(
        (input) => this.createPreferredSubAgentProvider(input),
        ({ taskId, providerId, usage }) => this.recordInvocationUsage(taskId, providerId, usage),
      ),
    ]);

    // Pre-warm the workspace manifest so the compact directory overview is
    // available at the first prompt build without paying the initial walk
    // cost inline. Runs in the background; if it hasn't finished by the time
    // the first prompt is built, the overview section is simply omitted.
    void workspaceManifestService
      .getManifest(APP_WORKSPACE_ROOT)
      .catch((err) => {
        appStateStore.dispatch({
          type: ActionType.ADD_LOG,
          log: {
            id: generateId('log'),
            timestamp: Date.now(),
            level: 'warn',
            source: 'system' as LogSource,
            message: `Workspace manifest pre-warm failed: ${String((err as Error)?.message ?? err)}`,
          },
        });
      });

    void this.initializeAppServerProvider(PRIMARY_PROVIDER_CONFIG);
    void this.prewarmNextProvider();

    if (this.providers.size === 0) {
      this.log('system', 'warn', 'The Codex runtime is unavailable.');
    }
  }

  resolve(_prompt: string, _explicitOwner?: string, _options?: AgentInvocationOptions): string {
    return PRIMARY_PROVIDER_ID;
  }

  cancel(taskId: string): boolean {
    const activeTask = this.activeTaskProviders.get(taskId);
    if (!activeTask) return false;
    try {
      activeTask.runtime.abort();
      this.log(activeTask.providerId, 'info', 'Task cancelled by user', taskId);
      return true;
    } catch {
      return false;
    }
  }

  dispose(): void {
    if (this.idleWarmProvider) {
      void Promise.resolve(this.idleWarmProvider.dispose?.()).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.log('system', 'warn', `Idle warm runtime cleanup failed: ${message}`);
      });
      this.idleWarmProvider = null;
    }
    for (const [taskKey, warmProvider] of this.warmTaskProviders.entries()) {
      void Promise.resolve(warmProvider.dispose?.()).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.log('system', 'warn', `Warm task runtime cleanup failed for ${taskKey}: ${message}`);
      });
    }
    this.warmTaskProviders.clear();
  }

  getTaskMemory(taskId: string) {
    return taskMemoryStore.get(taskId);
  }

  async invoke(taskId: string, prompt: string, explicitOwner?: string, options?: AgentInvocationOptions): Promise<InvocationResult> {
    const providerId = this.pickProvider(prompt, explicitOwner, options);
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(this.buildUnavailableProviderMessage(providerId));
    }
    const activeTask = this.createTaskInvocation(taskId, providerId);

    const adaptiveTaskProfile = applyAdaptiveTaskProfileOverride(
      prompt,
      options?.taskProfile,
      taskMemoryStore.getPlanSnapshot(taskId),
      taskMemoryStore.getLatestUserPrompt(taskId),
    );
    const explicitExecutionEscape = looksLikeExecutionEscapePrompt(prompt);

    const attachmentSummary = buildAttachmentSummary(options?.attachments);
    const displayPrompt = typeof options?.displayPrompt === 'string' ? options.displayPrompt : prompt;
    chatKnowledgeStore.recordUserMessage(
      taskId,
      buildChatUserMessageText(displayPrompt, options?.attachments),
    );
    taskMemoryStore.recordUserPrompt(taskId, displayPrompt, {
      attachments: options?.attachments,
      attachmentSummary,
    });
    const taskProfile = buildTaskProfile(prompt, adaptiveTaskProfile);
    if (taskProfile.kind === 'orchestration' && !taskMemoryStore.hasPlan(taskId)) {
      taskMemoryStore.recordPlan(
        taskId,
        [
          `Objective: ${displayPrompt.trim()}`,
          'Execution mode: keep the parent on the critical path.',
          'Delegation policy: spawn only bounded independent sub-agents with explicit ownership and validation.',
        ].join(' '),
        buildInitialPlanMetadata(displayPrompt),
      );
    }
    const autoChecklistProgress = shouldAutoProgressChecklist(displayPrompt)
      && !explicitExecutionEscape
      ? taskMemoryStore.beginChecklistItemForPrompt(taskId, displayPrompt, `prompt="${displayPrompt.trim()}"`)
      : null;
    this.activeTaskProviders.set(taskId, activeTask);

    appStateStore.dispatch({
      type: ActionType.UPDATE_TASK,
      taskId,
      updates: { status: 'running', owner: providerId, updatedAt: Date.now() },
    });
    appStateStore.dispatch({
      type: ActionType.ENSURE_TASK_TOKEN_USAGE,
      taskId,
    });
    this.setRuntime(providerId, {
      status: 'busy',
      activeTaskId: taskId,
      errorDetail: null,
    });
    this.log(providerId, 'info', `${provider.label} invocation started`, taskId);

    try {
      this.emitStartupStatuses(taskId, providerId, taskProfile.kind);
      const runtimePrompt = withExecutionModeDirective(
        withBrowserSearchDirective(prompt, adaptiveTaskProfile),
        adaptiveTaskProfile,
      );
      const runtimeScope = scopeForPrompt(prompt, adaptiveTaskProfile);
      const contextPrompt = buildContextPrompt([
        explicitExecutionEscape ? null : buildSubagentContinuationContext(taskId, taskProfile.kind),
        explicitExecutionEscape ? null : buildAutomaticTaskContinuationContext(taskId, prompt),
        buildDocumentAttachmentContext(options?.attachments),
      ]);
      const response = await activeTask.runtime.run({
        ...runtimeScope,
        mode: 'unrestricted-dev',
        agentId: providerId,
        role: 'primary',
        task: runtimePrompt,
        taskProfileOverride: adaptiveTaskProfile,
        forceFreshThread: explicitExecutionEscape,
        suppressTaskMemoryContext: explicitExecutionEscape,
        taskId,
        cwd: options?.cwd,
        contextPrompt,
        systemPromptAddendum: options?.systemPrompt,
        allowedTools: withDocumentAttachmentTools(runtimeScope.allowedTools, options?.attachments),
        maxTokensOverride: options?.maxTokensOverride,
        attachments: options?.attachments,
        onToken: (text) => {
          this.emitProgress({
            taskId,
            providerId,
            type: 'token',
            data: text,
            timestamp: Date.now(),
          });
        },
        onStatus: (status) => {
          this.emitProgress({
            taskId,
            providerId,
            type: 'status',
            data: status,
            timestamp: Date.now(),
          });
        },
        onItem: ({ item, eventType }) => {
          if (item.type === 'agent_message') return;
          this.emitProgress({
            taskId,
            providerId,
            type: 'item',
            data: eventType,
            codexItem: item,
            timestamp: Date.now(),
          });
        },
      });
      this.recordInvocationUsage(taskId, providerId, response.usage);
      const finalizedResponse = await this.finishIncompleteResponse({
        taskId,
        prompt,
        primaryProviderId: providerId,
        response,
        maxTokensOverride: options?.maxTokensOverride,
      });

      const result: InvocationResult = {
        taskId,
        providerId,
        success: true,
        status: 'completed',
        output: finalizedResponse.output,
        codexItems: finalizedResponse.codexItems,
        usage: finalizedResponse.usage || { inputTokens: 0, outputTokens: 0, durationMs: 0 },
      };

      chatKnowledgeStore.recordAssistantMessage(taskId, finalizedResponse.output, providerId);
      if (autoChecklistProgress) {
        taskMemoryStore.completeActiveChecklistItem(
          taskId,
          `completed via successful ${taskProfile.kind} turn`,
        );
      }
      taskMemoryStore.recordInvocationResult(result);
      if (taskProfile.kind === 'orchestration') {
        taskMemoryStore.recordPlan(
          taskId,
          `Parent completed orchestration turn | ${summarizeOrchestrationMilestone(finalizedResponse.output)}`,
          buildParentTurnPlanMetadata(finalizedResponse.output, providerId, 'parent-turn-complete'),
        );
      }
      appStateStore.dispatch({
        type: ActionType.UPDATE_TASK,
        taskId,
        updates: { status: 'completed', owner: providerId, updatedAt: Date.now() },
      });
      this.setRuntime(providerId, {
        status: 'available',
        activeTaskId: null,
        errorDetail: null,
      });
      this.log(providerId, 'info', `${provider.label} invocation completed`, taskId);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const cancelled = isAgentCancellationError(err);
      const partialUsage = readPartialUsageFromError(err);
      const failureUsage = partialUsage ?? { inputTokens: 0, outputTokens: 0, durationMs: 0 };
      const result: InvocationResult = {
        taskId,
        providerId,
        success: false,
        output: '',
        error: cancelled ? getAgentCancellationMessage() : message,
        status: cancelled ? 'cancelled' : 'failed',
        usage: failureUsage,
      };
      chatKnowledgeStore.recordAssistantMessage(
        taskId,
        cancelled ? getAgentCancellationMessage() : `Invocation failed: ${message}`,
        providerId,
      );
      taskMemoryStore.recordInvocationResult(result);
      if (taskProfile.kind === 'orchestration') {
        taskMemoryStore.recordPlan(
          taskId,
          cancelled
            ? 'Parent orchestration turn cancelled by user'
            : `Parent orchestration turn failed | ${message}`,
          buildParentTurnPlanMetadata(
            cancelled ? getAgentCancellationMessage() : message,
            providerId,
            cancelled ? 'parent-turn-cancelled' : 'parent-turn-failed',
          ),
        );
      }
      // Only record if we actually have non-zero usage to avoid a noisy log
      // entry and an extra ACCUMULATE_TASK_TOKEN_USAGE dispatch when nothing
      // was spent (typical for early-cancelled runs).
      if (partialUsage) {
        this.recordInvocationUsage(taskId, providerId, partialUsage);
      }
      appStateStore.dispatch({
        type: ActionType.UPDATE_TASK,
        taskId,
        updates: { status: cancelled ? 'cancelled' : 'failed', owner: providerId, updatedAt: Date.now() },
      });
      this.setRuntime(providerId, {
        status: cancelled ? 'available' : 'error',
        activeTaskId: null,
        errorDetail: cancelled ? null : message,
      });
      this.log(
        providerId,
        cancelled ? 'info' : 'error',
        cancelled
          ? `${provider.label} invocation cancelled by user`
          : `${provider.label} invocation failed: ${message}`,
        taskId,
      );
      return result;
    } finally {
      this.activeTaskProviders.delete(taskId);
    }
  }

  private async initializeAppServerProvider(config: { id: ProviderId; label: string; modelId: string }): Promise<void> {
    const probe = probeCodexAvailability();
    if (!probe.available) {
      this.setRuntime(config.id, {
        status: 'unavailable',
        activeTaskId: null,
        errorDetail: probe.error || 'Codex CLI is not installed.',
      }, config.modelId);
      this.log(config.id, 'warn', `${config.label} unavailable: ${probe.error || 'Codex CLI is not installed.'}`);
      return;
    }

    try {
      this.providers.set(config.id, {
        id: config.id,
        label: config.label,
        modelId: config.modelId,
        supportsAppToolExecutor: true,
      });
      this.setRuntime(config.id, { status: 'available', activeTaskId: null, errorDetail: null }, config.modelId);
      this.log(config.id, 'info', `${config.label} ready`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setRuntime(config.id, {
        status: 'unavailable',
        activeTaskId: null,
        errorDetail: message,
      }, config.modelId);
      this.log(config.id, 'warn', `${config.label} unavailable: ${message}`);
    }
  }

  private pickProvider(
    _prompt: string,
    explicitOwner?: string,
    _options?: AgentInvocationOptions,
  ): ProviderId {
    if (explicitOwner && explicitOwner !== 'auto' && explicitOwner !== PRIMARY_PROVIDER_ID) {
      throw new Error(`Unsupported provider: ${explicitOwner}`);
    }
    if (!this.providers.has(PRIMARY_PROVIDER_ID)) {
      throw new Error(this.buildUnavailableProviderMessage(PRIMARY_PROVIDER_ID));
    }
    return PRIMARY_PROVIDER_ID;
  }

  private createPreferredSubAgentProvider(_input?: Pick<SubAgentSpawnInput, 'task' | 'role' | 'providerId' | 'modelId'>): AgentProvider {
    if (!this.providers.has(PRIMARY_PROVIDER_ID)) {
      throw new Error(this.buildUnavailableProviderMessage(PRIMARY_PROVIDER_ID));
    }
    return this.createProviderInstance();
  }

  private createProviderInstance(): AgentProvider {
    return new AppServerBackedProvider({
      providerId: PRIMARY_PROVIDER_CONFIG.id,
      modelId: PRIMARY_PROVIDER_CONFIG.modelId,
    });
  }

  private buildWarmTaskProvider(provider: AgentProvider): WarmTaskProvider {
    return {
      provider,
      dispose: hasDisposableProvider(provider)
        ? async () => {
            await provider.dispose();
          }
        : undefined,
    };
  }

  private warmProvider(provider: AgentProvider): void {
    if (hasPreconnect(provider)) {
      void provider.preconnect().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.log('system', 'warn', `Codex provider prewarm failed: ${message}`);
      });
    }
  }

  private async prewarmNextProvider(): Promise<void> {
    if (this.idleWarmProvider || !this.providers.has(PRIMARY_PROVIDER_ID)) return;
    const provider = this.createProviderInstance();
    const warmProvider = this.buildWarmTaskProvider(provider);
    this.idleWarmProvider = warmProvider;

    if (!hasPreconnect(provider)) return;
    try {
      await provider.preconnect();
    } catch (err) {
      if (this.idleWarmProvider !== warmProvider) return;
      this.idleWarmProvider = null;
      const message = err instanceof Error ? err.message : String(err);
      this.log('system', 'warn', `Codex idle prewarm failed: ${message}`);
      await Promise.resolve(warmProvider.dispose?.()).catch(() => undefined);
    }
  }

  private buildTaskProviderKey(taskId: string, providerId: ProviderId): string {
    return `${providerId}:${taskId}`;
  }

  private getOrCreateWarmTaskProvider(taskId: string, providerId: ProviderId): WarmTaskProvider {
    const taskKey = this.buildTaskProviderKey(taskId, providerId);
    const existing = this.warmTaskProviders.get(taskKey);
    if (existing) return existing;

    const warmProvider = this.idleWarmProvider ?? this.buildWarmTaskProvider(this.createProviderInstance());
    if (this.idleWarmProvider === warmProvider) {
      this.idleWarmProvider = null;
      void this.prewarmNextProvider();
    } else {
      this.warmProvider(warmProvider.provider);
    }
    this.warmTaskProviders.set(taskKey, warmProvider);
    return warmProvider;
  }

  private createTaskInvocation(taskId: string, providerId: ProviderId): ActiveTaskInvocation {
    const taskKey = this.buildTaskProviderKey(taskId, providerId);
    const warmProvider = this.getOrCreateWarmTaskProvider(taskId, providerId);
    return {
      providerId,
      runtime: new AgentRuntime(warmProvider.provider),
      taskKey,
    };
  }

  private buildUnavailableProviderMessage(providerId: ProviderId): string {
    const runtime = appStateStore.getState().providers[providerId];
    const suffix = runtime?.errorDetail ? ` ${runtime.errorDetail}` : '';
    const label = this.providers.get(providerId)?.label
      ?? (providerId === PRIMARY_PROVIDER_ID ? PRIMARY_PROVIDER_CONFIG.label : undefined)
      ?? providerId;
    return `${label} is not available.${suffix}`.trim();
  }

  private setRuntime(
    providerId: ProviderId,
    patch: Pick<ProviderRuntime, 'status' | 'activeTaskId' | 'errorDetail'>,
    modelOverride?: string,
  ): void {
    const provider = this.providers.get(providerId);
    appStateStore.dispatch({
      type: ActionType.SET_PROVIDER_RUNTIME,
      providerId,
      runtime: {
        id: providerId,
        status: patch.status,
        activeTaskId: patch.activeTaskId,
        lastActivityAt: Date.now(),
        errorDetail: patch.errorDetail,
        model: modelOverride || provider?.modelId,
      },
    });
  }

  private log(source: LogSource, level: 'info' | 'warn' | 'error', message: string, taskId?: string): void {
    const log = {
      id: generateId('log'),
      timestamp: Date.now(),
      level,
      source,
      message,
      taskId,
    };
    eventBus.emit(AppEventType.LOG_ADDED, { log });
  }

  private emitProgress(progress: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC_CHANNELS.MODEL_PROGRESS, progress);
    }
  }

  private recordInvocationUsage(
    taskId: string,
    providerId: ProviderId,
    usage?: {
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens?: number;
      cacheCreationInputTokens?: number;
    } | null,
  ): void {
    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    const cachedInputTokens = usage?.cachedInputTokens ?? 0;
    const cacheCreationInputTokens = usage?.cacheCreationInputTokens ?? 0;

    appStateStore.dispatch({
      type: ActionType.ACCUMULATE_TASK_TOKEN_USAGE,
      taskId,
      inputTokens,
      outputTokens,
      apiCalls: 1,
      cachedInputTokens,
      cacheCreationInputTokens,
    });

    if (usage) {
      appStateStore.dispatch({
        type: ActionType.ACCUMULATE_TOKEN_USAGE,
        inputTokens,
        outputTokens,
        cachedInputTokens,
        cacheCreationInputTokens,
      });
    }

    if (usage) {
      const fullPriced = Math.max(0, inputTokens - cachedInputTokens);
      const cacheHitRatio = inputTokens > 0 ? cachedInputTokens / inputTokens : 0;
      appStateStore.dispatch({
        type: ActionType.ADD_LOG,
        log: {
          id: `invocation-usage-${taskId}-${Date.now()}`,
          timestamp: Date.now(),
          level: 'info',
          source: 'system',
          taskId,
          message: `Usage ${providerId} [task=${taskId.slice(0, 8)}] input=${inputTokens} cached_read=${cachedInputTokens} cached_write=${cacheCreationInputTokens} full_priced=${fullPriced} output=${outputTokens} cache_hit=${(cacheHitRatio * 100).toFixed(1)}%`,
        },
      });
    }

    const progress: InvocationProgress = {
      taskId,
      providerId,
      type: 'usage',
      data: {
        inputTokens,
        outputTokens,
        apiCalls: 1,
        cachedInputTokens,
        cacheCreationInputTokens,
      },
      timestamp: Date.now(),
    };
    this.emitProgress(progress);
  }

  private emitStartupStatuses(
    taskId: string,
    providerId: ProviderId,
    taskKind: AgentTaskKind,
  ): void {
    const statuses = buildStartupStatusMessages({
      taskKind,
      browserSurfaceReady: browserService.isCreated(),
    });

    for (const status of statuses) {
      this.emitProgress({
        taskId,
        providerId,
        type: 'status',
        data: status,
        timestamp: Date.now(),
      });
    }
  }

  private async finishIncompleteResponse(input: {
    taskId: string;
    prompt: string;
    primaryProviderId: ProviderId;
    response: AgentProviderResult;
    maxTokensOverride?: number;
  }): Promise<AgentProviderResult> {
    let combined = input.response;
    if (combined.completion?.completed !== false || !combined.completion.canContinue) {
      return combined;
    }

    const providerId = input.primaryProviderId;
    if (!this.providers.has(providerId)) return combined;

    const continuationTask = this.createTaskInvocation(input.taskId, providerId);
    try {
      this.emitProgress({
        taskId: input.taskId,
        providerId,
        type: 'status',
        data: 'Finishing the response after the model hit its output limit.',
        timestamp: Date.now(),
      });

      const continuation = await continuationTask.runtime.run({
        mode: 'unrestricted-dev',
        agentId: providerId,
        role: 'secondary',
        taskId: input.taskId,
        task: 'Continue the assistant response exactly where it stopped. Do not restart, summarize, or repeat prior text. Finish the response directly.',
        contextPrompt: buildContextPrompt([
          '## Original User Request',
          input.prompt.trim(),
          '',
          '## Partial Assistant Response',
          combined.output.trim(),
        ]),
        priorTurns: [
          { role: 'user', content: input.prompt.trim() },
          { role: 'assistant', content: combined.output },
        ],
        allowedTools: [],
        canSpawnSubagents: false,
        maxToolTurns: 1,
        maxTokensOverride: input.maxTokensOverride,
        onToken: (text) => {
          this.emitProgress({
            taskId: input.taskId,
            providerId,
            type: 'token',
            data: text,
            timestamp: Date.now(),
          });
        },
        onStatus: (status) => {
          this.emitProgress({
            taskId: input.taskId,
            providerId,
            type: 'status',
            data: status,
            timestamp: Date.now(),
          });
        },
        onItem: ({ item, eventType }) => {
          if (item.type === 'agent_message') return;
          this.emitProgress({
            taskId: input.taskId,
            providerId,
            type: 'item',
            data: eventType,
            codexItem: item,
            timestamp: Date.now(),
          });
        },
      });

      this.recordInvocationUsage(input.taskId, providerId, continuation.usage);
      combined = {
        output: mergeContinuationText(combined.output, continuation.output),
        codexItems: [...(combined.codexItems || []), ...(continuation.codexItems || [])],
        usage: mergeUsage(combined.usage, continuation.usage),
        completion: continuation.completion,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log(providerId, 'warn', `Continuation attempt failed: ${message}`, input.taskId);
    }

    return combined;
  }

}

function hasDisposableProvider(provider: AgentProvider): provider is AgentProvider & { dispose(): Promise<void> | void } {
  return typeof (provider as { dispose?: unknown }).dispose === 'function';
}

function hasPreconnect(provider: AgentProvider): provider is AgentProvider & { preconnect(): Promise<void> } {
  return typeof (provider as { preconnect?: unknown }).preconnect === 'function';
}

function buildContextPrompt(parts: Array<string | null | undefined>): string | null {
  return packContextSections(parts, 4_000, '\n...[context truncated]');
}

function shouldUseAutomaticContinuationContext(taskId: string, prompt: string): boolean {
  return looksLikeContinuationPrompt(prompt) || lastInvocationFailed(taskId);
}

function buildAutomaticTaskContinuationContext(taskId: string, prompt: string): string | null {
  const isContinuation = shouldUseAutomaticContinuationContext(taskId, prompt);
  const recall = chatKnowledgeStore.recall(taskId, {
    query: prompt,
    intent: isContinuation ? 'follow_up' : undefined,
    maxChars: isContinuation ? 2500 : 1800,
  });
  const lastFailure = getLastFailureText(taskId);
  if (!lastFailure && !recall.summary && !recall.text.trim()) {
    const snapshot = taskMemoryStore.getPlanSnapshot(taskId);
    if (!snapshot?.activeChecklist?.items.length) return null;
  }

  const snapshot = taskMemoryStore.getPlanSnapshot(taskId);

  const sections = [
    '## Conversation Continuity',
    isContinuation
      ? 'This task is being resumed. Continue from prior evidence and prior tool work instead of restarting broad exploration unless the prior state is clearly insufficient.'
      : 'This task has prior conversation state. Use the existing thread summary and relevant recent context as the default continuity baseline unless the user clearly changes direction.',
  ];

  if (lastFailure) {
    sections.push('', '### Last Failure', lastFailure);
  }
  if (snapshot?.activeChecklist?.items.length) {
    sections.push('', '### Active Checklist');
    if (snapshot.activeChecklist.planName) sections.push(`Plan: ${snapshot.activeChecklist.planName}`);
    sections.push(...snapshot.activeChecklist.items.map((item) => (
      `${item.status === 'completed' ? '[done]' : item.status === 'in_progress' ? '[in-progress]' : item.status === 'blocked' ? '[blocked]' : item.status === 'dropped' ? '[dropped]' : '[pending]'} ${item.id}. ${item.text}`
    )));
  }
  if (recall.summary) {
    sections.push('', '### Thread Summary', recall.summary);
  }
  if (recall.text) {
    sections.push('', '### Relevant Prior Context', recall.text);
  }

  return sections.join('\n');
}

function looksLikeContinuationPrompt(prompt: string): boolean {
  return /\b(continue|resume|retry|pick up|keep going|go on|same task|that failed|fix that|where were we|carry on)\b/i.test(prompt)
    || prompt.trim().length <= 40 && /\b(this|that|it|same)\b/i.test(prompt);
}

function lastInvocationFailed(taskId: string): boolean {
  const record = taskMemoryStore.get(taskId);
  const latestResult = [...record.entries].reverse().find(entry => entry.kind === 'model_result');
  return latestResult?.metadata?.success === false;
}

function getLastFailureText(taskId: string): string | null {
  const record = taskMemoryStore.get(taskId);
  const latestFailed = [...record.entries].reverse().find(
    entry => entry.kind === 'model_result' && entry.metadata?.success === false,
  );
  return latestFailed?.text || null;
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
    used += separator.length + truncated.length;
    break;
  }

  const context = packed.join('');
  return context || null;
}

export const agentModelService = new AgentModelService();
