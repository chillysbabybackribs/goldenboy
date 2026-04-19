import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/types/ipc';
import { LogSource } from '../../shared/types/appState';
import {
  HAIKU_PROVIDER_ID,
  PRIMARY_PROVIDER_ID,
  type AgentTaskKind,
  AgentInvocationOptions,
  InvocationResult,
  type PersistedTurnProcessEntry,
  ProviderId,
  ProviderRuntime,
} from '../../shared/types/model';
import { ActionType } from '../state/actions';
import { appStateStore } from '../state/appStateStore';
import { eventBus } from '../events/eventBus';
import { AppEventType } from '../../shared/types/events';
import { generateId } from '../../shared/utils/ids';
import { AgentProvider } from './AgentTypes';
import { AgentRuntime } from './AgentRuntime';
import { CodexProvider } from './CodexProvider';
import { HaikuProvider } from './HaikuProvider';
import { AppServerBackedProvider } from './AppServerBackedProvider';
import { agentToolExecutor } from './AgentToolExecutor';
import { createBrowserToolDefinitions } from './tools/browserTools';
import { createChatToolDefinitions } from './tools/chatTools';
import { createAttachmentToolDefinitions } from './tools/attachmentTools';
import { createArtifactToolDefinitions } from './tools/artifactTools';
import { createFilesystemToolDefinitions } from './tools/filesystemTools';
import { createRuntimeToolDefinitions } from './tools/runtimeTools';
import { createTerminalToolDefinitions } from './tools/terminalTools';
import { createSubAgentToolDefinitions } from './tools/subagentTools';
import { taskMemoryStore } from '../models/taskMemoryStore';
import { runtimeLedgerStore } from '../models/runtimeLedgerStore';
import { chatKnowledgeStore } from '../chatKnowledge/ChatKnowledgeStore';
import { scopeForPrompt, withBrowserSearchDirective } from './runtimeScope';
import { pickProviderForPrompt, resolvePrimaryProviderBackend, taskKindRequiresV2ToolRuntime } from './providerRouting';
import { SubAgentSpawnInput } from './subagents/SubAgentTypes';
import { buildTaskProfile } from './taskProfile';
import {
  buildArtifactRoutingDecision,
  buildArtifactRoutingInstructions,
  withArtifactRoutingAllowedTools,
} from './artifactRouting';
import {
  withGroundedResearchAllowedTools,
} from './researchGrounding';
import { browserService } from '../browser/BrowserService';
import {
  shouldIncludeSharedRuntimeContext,
  shouldIncludeArtifactContext,
  shouldIncludeConversationContext,
  shouldIncludeTaskMemoryContext,
} from './invocationContextPolicy';
import {
  buildStartupStatusMessages,
} from './startupProgress';
import {
  backgroundResearchSynthesisProviderId,
  buildBackgroundResearchSynthesisContext,
  buildBackgroundResearchSynthesisTask,
  formatBackgroundResearchSynthesis,
  NO_MATERIAL_RESEARCH_UPDATE,
  shouldRunBackgroundResearchSynthesis,
} from './researchSynthesis';
import {
  buildAttachmentSummary,
  buildAutomaticTaskContinuationContext,
  buildContextPrompt,
  buildArtifactContext,
  buildChatUserMessageText,
  buildConversationHydrationContext,
  buildFollowUpResolutionContext,
  buildDocumentAttachmentContext,
  buildFileCacheContext,
  buildSubagentClarificationMessage,
  buildSubagentConfirmationMessage,
  hasDisposableProvider,
  getLastFailureText,
  getLastInvocationProviderId,
  interpretSubagentApproval,
  isExplicitPreviousChatRecallPrompt,
  isSupportedProvider,
  lastInvocationFailed,
  looksLikeContinuationPrompt,
  mergeInvocationOptions,
  mergeProcessEntries,
  normalizeStatusProcessEntry,
  resolveCodexInvocationOverride,
  shouldOfferSubagentConfirmation,
  suggestedSubagentPlan,
  withDocumentAttachmentTools,
} from './AgentModelService.utils';

type ProviderEntry = {
  id: ProviderId;
  label: string;
  modelId?: string;
  supportsAppToolExecutor: boolean;
};

type ActiveTaskInvocation = {
  providerId: ProviderId;
  runtime: AgentRuntime;
  runtimeStartedAt: number;
  dispose?: () => Promise<void>;
};

type PendingSubagentApproval = {
  taskId: string;
  prompt: string;
  explicitOwner?: string;
  options?: AgentInvocationOptions;
  providerId: ProviderId;
  reason: string;
  suggestedRoles: string[];
  requestedAt: number;
};

const PROVIDER_CONFIGS: Array<{ id: ProviderId; label: string; modelId: string }> = [
  { id: PRIMARY_PROVIDER_ID, label: 'Codex', modelId: PRIMARY_PROVIDER_ID },
  { id: HAIKU_PROVIDER_ID, label: 'Haiku 4.5', modelId: HAIKU_PROVIDER_ID },
];

 
export class AgentModelService {
  private providers = new Map<ProviderId, ProviderEntry>();
  private activeTaskProviders = new Map<string, ActiveTaskInvocation>();
  private pendingSubagentApprovals = new Map<string, PendingSubagentApproval>();
  private sharedPrimaryAppServerProvider: AppServerBackedProvider | null = null;

  init(): void {
    agentToolExecutor.registerMany([
      ...createArtifactToolDefinitions(),
      ...createAttachmentToolDefinitions(),
      ...createRuntimeToolDefinitions(),
      ...createBrowserToolDefinitions(),
      ...createChatToolDefinitions(),
      ...createFilesystemToolDefinitions(),
      ...createTerminalToolDefinitions(),
      ...createSubAgentToolDefinitions((input) => this.createPreferredSubAgentProvider(input)),
    ]);

    this.initializePrimaryProvider(PROVIDER_CONFIGS[0]);
    this.initializeHaikuProvider(PROVIDER_CONFIGS[1]);

    if (this.providers.size === 0) {
      this.log('system', 'warn', 'No model providers are available.');
    }
  }

  private initializePrimaryProvider(config: { id: ProviderId; label: string; modelId: string }): void {
    const probe = CodexProvider.isAvailable();
    if (!probe.available) {
      this.setRuntime(config.id, {
        status: 'unavailable',
        activeTaskId: null,
        errorDetail: probe.error || 'Codex CLI is not installed.',
      }, config.modelId);
      this.log(config.id, 'warn', `${config.label} unavailable: ${probe.error || 'Codex CLI is not installed.'}`);
      return;
    }

    this.providers.set(config.id, {
      id: config.id,
      label: config.label,
      modelId: config.modelId,
      supportsAppToolExecutor: true,
    });
    this.setRuntime(config.id, {
      status: 'available',
      activeTaskId: null,
      errorDetail: null,
    }, config.modelId);
    this.log(config.id, 'info', `${config.label} ready (lazy backend selection)`);
  }

  async dispose(): Promise<void> {
    for (const [taskId, activeTask] of Array.from(this.activeTaskProviders.entries())) {
      this.activeTaskProviders.delete(taskId);
      await this.disposeTaskInvocation(activeTask, activeTask.providerId, taskId);
    }

    if (this.sharedPrimaryAppServerProvider) {
      await this.sharedPrimaryAppServerProvider.dispose();
      this.sharedPrimaryAppServerProvider = null;
    }
  }

  getProviderStatuses(): Record<string, ProviderRuntime> {
    return appStateStore.getState().providers;
  }

  resolve(prompt: string, explicitOwner?: string, options?: AgentInvocationOptions): string {
    if (explicitOwner && explicitOwner !== 'auto' && isSupportedProvider(explicitOwner) && this.providers.has(explicitOwner)) {
      return explicitOwner;
    }
    return this.pickAutoProvider(prompt, options)
      ?? Array.from(this.providers.keys())[0]
      ?? PRIMARY_PROVIDER_ID;
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

  getTaskMemory(taskId: string) {
    return taskMemoryStore.get(taskId);
  }

  async invoke(taskId: string, prompt: string, explicitOwner?: string, options?: AgentInvocationOptions): Promise<InvocationResult> {
    const pendingApproval = this.pendingSubagentApprovals.get(taskId);
    const approvalDecision = pendingApproval ? interpretSubagentApproval(prompt) : null;
    const displayPrompt = typeof options?.displayPrompt === 'string' ? options.displayPrompt : prompt;
    const attachmentSummary = buildAttachmentSummary(options?.attachments);

    let executionPrompt = prompt;
    let executionOwner = explicitOwner;
    let executionOptions = options;

    if (pendingApproval && (approvalDecision === 'approve' || approvalDecision === 'deny')) {
      this.pendingSubagentApprovals.delete(taskId);
      executionPrompt = pendingApproval.prompt;
      executionOwner = pendingApproval.explicitOwner ?? pendingApproval.providerId;
      executionOptions = mergeInvocationOptions(
        pendingApproval.options,
        {
          taskProfile: {
            canSpawnSubagents: approvalDecision === 'approve',
          },
          systemPrompt: approvalDecision === 'deny'
            ? [
              pendingApproval.options?.systemPrompt,
              'The user declined subagents for this task. Complete it without spawning subagents.',
            ].filter(Boolean).join('\n\n')
            : pendingApproval.options?.systemPrompt,
        },
      );
    }
    if (pendingApproval && approvalDecision === 'unclear') {
      executionOwner = pendingApproval.explicitOwner ?? pendingApproval.providerId;
    }

    const providerId = this.pickProvider(executionPrompt, executionOwner, executionOptions);
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(this.buildUnavailableProviderMessage(providerId));
    }
    const taskProfile = buildTaskProfile(executionPrompt, executionOptions?.taskProfile);
    const hadTaskHistory = taskMemoryStore.hasEntries(taskId);
    const hadConversationHistory = Boolean(chatKnowledgeStore.threadSummary(taskId));
    const hasArtifacts = appStateStore.getState().artifacts.length > 0;
    const lastProviderId = getLastInvocationProviderId(taskId);
    const providerSwitched = Boolean(lastProviderId && lastProviderId !== providerId);
    if (lastProviderId && lastProviderId !== providerId) {
      runtimeLedgerStore.recordProviderSwitch(taskId, lastProviderId, providerId);
    }

    const chatUserMessage = chatKnowledgeStore.recordUserMessage(
      taskId,
      buildChatUserMessageText(displayPrompt, options?.attachments),
    );
    taskMemoryStore.recordUserPrompt(taskId, displayPrompt, {
      attachments: options?.attachments,
      attachmentSummary,
    });
    const currentTaskMemoryEntryId = taskMemoryStore.get(taskId).entries.at(-1)?.id;
    

    if (pendingApproval && approvalDecision === 'unclear') {
      return this.completeImmediateResponse(
        taskId,
        providerId,
        buildSubagentClarificationMessage(),
        `${provider.label} requested a subagent confirmation answer`,
        {
          pendingSubagentConfirmation: true,
        },
      );
    }

    if (shouldOfferSubagentConfirmation(executionPrompt, taskProfile.kind, taskProfile.canSpawnSubagents, executionOptions)) {
      const suggestion = suggestedSubagentPlan(taskProfile.kind);
      this.pendingSubagentApprovals.set(taskId, {
        taskId,
        prompt: executionPrompt,
        explicitOwner: executionOwner,
        options: executionOptions,
        providerId,
        reason: suggestion.reason,
        suggestedRoles: suggestion.suggestedRoles,
        requestedAt: Date.now(),
      });
      return this.completeImmediateResponse(
        taskId,
        providerId,
        buildSubagentConfirmationMessage(suggestion.reason, suggestion.suggestedRoles),
        `${provider.label} paused for subagent confirmation`,
        {
          pendingSubagentConfirmation: true,
          reason: suggestion.reason,
          suggestedRoles: suggestion.suggestedRoles,
        },
      );
    }

    const codexOverride = resolveCodexInvocationOverride(providerId, executionOptions);
    const activeTask = this.createTaskInvocation(providerId, taskProfile.kind, executionOptions);
    this.activeTaskProviders.set(taskId, activeTask);

    appStateStore.dispatch({
      type: ActionType.UPDATE_TASK,
      taskId,
      updates: { status: 'running', owner: providerId, updatedAt: Date.now() },
    });
    runtimeLedgerStore.recordTaskStatus({
      taskId,
      providerId,
      status: 'running',
      summary: `${provider.label} started ${taskProfile.kind} work`,
    });
    this.setRuntime(providerId, {
      status: 'busy',
      activeTaskId: taskId,
      errorDetail: null,
    }, codexOverride?.modelId);
    this.log(providerId, 'info', `${provider.label} invocation started`, taskId);
    const persistedProcessEntries: PersistedTurnProcessEntry[] = [];

    try {
      const continuationPrompt = looksLikeContinuationPrompt(executionPrompt);
      const explicitPreviousChatRecall = isExplicitPreviousChatRecallPrompt(executionPrompt);
      const richerConversationContextRequested = shouldIncludeConversationContext({
        prompt: executionPrompt,
        hasPriorConversation: hadConversationHistory,
        isContinuation: continuationPrompt,
      });
      const includeTaskMemory = shouldIncludeTaskMemoryContext({
        prompt: executionPrompt,
        taskKind: taskProfile.kind,
        hasPriorTaskMemory: hadTaskHistory,
        isContinuation: continuationPrompt,
        lastInvocationFailed: lastInvocationFailed(taskId),
      });
      const includeArtifactContext = shouldIncludeArtifactContext({
        prompt: executionPrompt,
        taskKind: taskProfile.kind,
        hasArtifacts,
        providerId,
      });
      const includeSharedRuntimeContext = shouldIncludeSharedRuntimeContext({
        taskKind: taskProfile.kind,
        hasPriorTaskMemory: hadTaskHistory,
        providerSwitched,
        isContinuation: continuationPrompt,
        richerConversationContextRequested,
        lastInvocationFailed: lastInvocationFailed(taskId),
        explicitPreviousChatRecall,
      });
      this.emitStartupStatuses(taskId, providerId, taskProfile.kind);

      const runtimePrompt = withBrowserSearchDirective(executionPrompt, executionOptions?.taskProfile);
      const runtimeScope = scopeForPrompt(executionPrompt, executionOptions?.taskProfile);
      const activeArtifact = appStateStore.getState().activeArtifactId
        ? appStateStore.getState().artifacts.find((artifact) => artifact.id === appStateStore.getState().activeArtifactId) ?? null
        : null;
      const artifactRoutingDecision = buildArtifactRoutingDecision(executionPrompt, activeArtifact);
      const artifactRoutingInstructions = buildArtifactRoutingInstructions(artifactRoutingDecision);
      const shouldGroundResearch = false;
      const researchContext = null;
      const researchContextPrompt = null;
      const researchGroundingInstructions = null;
      const fullCatalogToolNames = agentToolExecutor.list().map((tool) => tool.name);
      const routedAllowedTools = withGroundedResearchAllowedTools(withArtifactRoutingAllowedTools(
        withDocumentAttachmentTools(runtimeScope.allowedTools, executionOptions?.attachments),
        artifactRoutingDecision,
        fullCatalogToolNames,
      ), researchContext, fullCatalogToolNames);
      const hydratableAllowedTools = withGroundedResearchAllowedTools(withArtifactRoutingAllowedTools(
        withDocumentAttachmentTools(fullCatalogToolNames, executionOptions?.attachments),
        artifactRoutingDecision,
        fullCatalogToolNames,
      ), researchContext, fullCatalogToolNames);
      const conversationContext = includeSharedRuntimeContext
        ? buildConversationHydrationContext({
          taskId,
          prompt: executionPrompt,
          taskKind: taskProfile.kind,
          currentMessageId: chatUserMessage.id,
          hasPriorConversation: hadConversationHistory,
          richerContextRequested: richerConversationContextRequested,
          providerSwitched,
        })
        : null;
      const taskSwitchContext = includeSharedRuntimeContext
        ? runtimeLedgerStore.buildTaskSwitchContext({
          taskId,
          prompt: executionPrompt,
        })
        : null;
      const sharedLedgerContext = includeSharedRuntimeContext
        ? runtimeLedgerStore.buildHydrationContext({
          taskId,
          currentProviderId: providerId,
          providerSwitched,
        })
        : null;
      const contextPrompt = buildContextPrompt([
        buildAutomaticTaskContinuationContext(taskId, executionPrompt, chatUserMessage.id),
        buildFollowUpResolutionContext(taskId, executionPrompt, chatUserMessage.id),
        taskSwitchContext,
        sharedLedgerContext,
        conversationContext,
        includeTaskMemory ? taskMemoryStore.buildContext(taskId, {
          excludeEntryIds: currentTaskMemoryEntryId ? [currentTaskMemoryEntryId] : [],
        }) : null,
        includeArtifactContext ? buildArtifactContext() : null,
        artifactRoutingInstructions ? `## Artifact Route Decision\n${artifactRoutingInstructions}` : null,
        researchContextPrompt,
        buildFileCacheContext(taskProfile.kind),
        buildDocumentAttachmentContext(executionOptions?.attachments),
      ], taskProfile.kind);
      const response = await activeTask.runtime.run({
        ...runtimeScope,
        mode: 'unrestricted-dev',
        agentId: providerId,
        role: 'primary',
        task: runtimePrompt,
        taskId,
        cwd: executionOptions?.cwd,
        contextPrompt,
        systemPromptAddendum: [
          executionOptions?.systemPrompt,
          artifactRoutingInstructions,
          researchGroundingInstructions,
        ].filter(Boolean).join('\n\n') || undefined,
        allowedTools: routedAllowedTools,
        hydratableTools: hydratableAllowedTools,
        restrictToolCatalogToAllowedTools: Boolean(artifactRoutingDecision?.applies || shouldGroundResearch),
        requiresGroundedResearchHydration: shouldGroundResearch,
        attachments: executionOptions?.attachments,
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
          const processEntry = normalizeStatusProcessEntry(status);
          if (processEntry) persistedProcessEntries.push(processEntry);
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

      const result: InvocationResult = {
        taskId,
        providerId,
        success: true,
        output: response.output,
        artifacts: [],
        codexItems: response.codexItems,
        processEntries: mergeProcessEntries(persistedProcessEntries, response.codexItems),
        usage: response.usage || { inputTokens: 0, outputTokens: 0, durationMs: 0 },
        runId: response.runId,
      };

      chatKnowledgeStore.recordAssistantMessage(taskId, response.output, providerId);
      taskMemoryStore.recordInvocationResult(result);
      const usage = response.usage;
      if (usage) {
        appStateStore.dispatch({
          type: ActionType.ACCUMULATE_TOKEN_USAGE,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        });
      }
      appStateStore.dispatch({
        type: ActionType.UPDATE_TASK,
        taskId,
        updates: { status: 'completed', owner: providerId, updatedAt: Date.now() },
      });
      runtimeLedgerStore.recordTaskStatus({
        taskId,
        providerId,
        runId: response.runId,
        status: 'completed',
        summary: `${provider.label} completed ${taskProfile.kind} work`,
        metadata: {
          success: true,
          durationMs: response.usage?.durationMs ?? 0,
        },
      });
      this.setRuntime(providerId, {
        status: 'available',
        activeTaskId: null,
        errorDetail: null,
      }, codexOverride?.modelId);
      this.log(providerId, 'info', `${provider.label} invocation completed`, taskId);
      this.queueBackgroundResearchSynthesis({
        taskId,
        prompt: executionPrompt,
        taskKind: taskProfile.kind,
        primaryProviderId: providerId,
        fastAnswer: response.output,
        groundedResearchContext: null,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const result: InvocationResult = {
        taskId,
        providerId,
        success: false,
        output: '',
        artifacts: [],
        error: message,
        processEntries: persistedProcessEntries,
        usage: { inputTokens: 0, outputTokens: 0, durationMs: 0 },
      };
      chatKnowledgeStore.recordAssistantMessage(taskId, `Invocation failed: ${message}`, providerId);
      taskMemoryStore.recordInvocationResult(result);
      appStateStore.dispatch({
        type: ActionType.UPDATE_TASK,
        taskId,
        updates: { status: 'failed', owner: providerId, updatedAt: Date.now() },
      });
      runtimeLedgerStore.recordTaskStatus({
        taskId,
        providerId,
        status: 'failed',
        summary: `${provider.label} failed ${taskProfile.kind} work: ${message}`,
        metadata: {
          success: false,
        },
      });
      this.setRuntime(providerId, {
        status: 'error',
        activeTaskId: null,
        errorDetail: message,
      }, codexOverride?.modelId);
      this.log(providerId, 'error', `${provider.label} invocation failed: ${message}`, taskId);
      return result;
    } finally {
      this.activeTaskProviders.delete(taskId);
      await this.disposeTaskInvocation(activeTask, providerId, taskId);
    }
  }

  private initializeCodexProvider(config: { id: ProviderId; label: string; modelId: string }): void {
    const probe = CodexProvider.isAvailable();
    if (!probe.available) {
      this.setRuntime(config.id, {
        status: 'unavailable',
        activeTaskId: null,
        errorDetail: probe.error || 'Codex CLI is not installed.',
      }, config.modelId);
      this.log(config.id, 'warn', `${config.label} unavailable: ${probe.error || 'Codex CLI is not installed.'}`);
      return;
    }

    const provider = new CodexProvider({
      providerId: config.id,
      modelId: config.modelId,
    });
    this.providers.set(config.id, {
      id: config.id,
      label: config.label,
      modelId: provider.modelId,
      supportsAppToolExecutor: Boolean(provider.supportsAppToolExecutor),
    });
    this.setRuntime(config.id, {
      status: 'available',
      activeTaskId: null,
      errorDetail: null,
    }, provider.modelId);
    this.log(config.id, 'info', `${config.label} ready`);
  }

  private async initializeAppServerProvider(config: { id: ProviderId; label: string; modelId: string }): Promise<void> {
    const probe = CodexProvider.isAvailable();
    if (!probe.available) {
      this.setRuntime(config.id, {
        status: 'unavailable',
        activeTaskId: null,
        errorDetail: probe.error || 'Codex CLI is not installed.',
      }, config.modelId);
      this.log(config.id, 'warn', `${config.label} unavailable: ${probe.error || 'Codex CLI is not installed.'}`);
      return;
    }

    this.providers.set(config.id, {
      id: config.id,
      label: config.label,
      modelId: config.modelId,
      supportsAppToolExecutor: true,
    });
    const sharedProvider = new AppServerBackedProvider({
      providerId: config.id,
      modelId: config.modelId,
    });
    this.sharedPrimaryAppServerProvider = sharedProvider;
    this.setRuntime(config.id, { status: 'busy', activeTaskId: null, errorDetail: null }, config.modelId);
    this.log(config.id, 'info', `${config.label} prewarming app-server session`);

    try {
      await sharedProvider.prewarm();
      this.setRuntime(config.id, { status: 'available', activeTaskId: null, errorDetail: null }, config.modelId);
      this.log(config.id, 'info', `${config.label} ready (prewarmed app-server mode)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sharedPrimaryAppServerProvider = null;
      this.setRuntime(config.id, {
        status: 'error',
        activeTaskId: null,
        errorDetail: message,
      }, config.modelId);
      this.log(config.id, 'warn', `${config.label} app-server prewarm failed: ${message}`);
    }
  }

  private initializeHaikuProvider(config: { id: ProviderId; label: string; modelId: string }): void {
    try {
      const provider = new HaikuProvider();
      this.providers.set(config.id, {
        id: config.id,
        label: config.label,
        modelId: provider.modelId,
        supportsAppToolExecutor: Boolean(provider.supportsAppToolExecutor),
      });
      this.setRuntime(config.id, {
        status: 'available',
        activeTaskId: null,
        errorDetail: null,
      }, provider.modelId);
      this.log(config.id, 'info', `${config.label} ready: ${provider.modelId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setRuntime(config.id, {
        status: 'unavailable',
        activeTaskId: null,
        errorDetail: message,
      });
      this.log(config.id, 'warn', `${config.label} unavailable: ${message}`);
    }
  }

  private pickProvider(prompt: string, explicitOwner?: string, options?: AgentInvocationOptions): ProviderId {
    if (explicitOwner && explicitOwner !== 'auto') {
      if (!isSupportedProvider(explicitOwner)) {
        throw new Error(`Unsupported provider: ${explicitOwner}`);
      }
      if (!this.providers.has(explicitOwner)) {
        throw new Error(this.buildUnavailableProviderMessage(explicitOwner));
      }
      this.assertProviderSupportsPrompt(explicitOwner, prompt, options);
      return explicitOwner;
    }

    const autoProvider = this.pickAutoProvider(prompt, options);
    if (autoProvider) return autoProvider;
    const profile = buildTaskProfile(prompt, options?.taskProfile);
    const requiresAppTools = taskKindRequiresV2ToolRuntime(profile.kind);
    if (requiresAppTools) {
      throw new Error(
        `No model provider that executes through the V2 tool runtime is available for ${profile.kind} tasks.`,
      );
    }
    throw new Error('No model provider is available. Check Codex CLI availability and authentication.');
  }

  private pickAutoProvider(prompt = '', options?: AgentInvocationOptions): ProviderId | null {
    return pickProviderForPrompt(
      prompt,
      this.providers.keys(),
      options?.taskProfile,
      this.getProviderRoutingCapabilities(),
    );
  }

  private createPreferredSubAgentProvider(input?: Pick<SubAgentSpawnInput, 'task' | 'role' | 'providerId'>): AgentProvider {
    const taskPrompt = [input?.role, input?.task].filter(Boolean).join('\n');
    const taskKind = buildTaskProfile(taskPrompt).kind;
    if (input?.providerId && input.providerId !== 'auto') {
      if (!this.providers.has(input.providerId)) {
        throw new Error(this.buildUnavailableProviderMessage(input.providerId));
      }
      this.assertProviderSupportsPrompt(input.providerId, taskPrompt);
      return this.createProviderInstance(input.providerId, taskKind);
    }

    const preferred = this.pickAutoProvider(taskPrompt);
    if (preferred) return this.createProviderInstance(preferred, taskKind);
    throw new Error('No compatible provider is available for the requested sub-agent task.');
  }

  private createProviderInstance(
    providerId: ProviderId,
    taskKind: AgentTaskKind = 'general',
    options?: AgentInvocationOptions,
  ): AgentProvider {
    const config = PROVIDER_CONFIGS.find((entry) => entry.id === providerId);
    if (!config) {
      throw new Error(`Unknown provider configuration: ${providerId}`);
    }
    const codexOverride = resolveCodexInvocationOverride(providerId, options);
    if (providerId === HAIKU_PROVIDER_ID) {
      return new HaikuProvider();
    }
    if (providerId === PRIMARY_PROVIDER_ID) {
      const backend = resolvePrimaryProviderBackend(taskKind, process.env.CODEX_PROVIDER, CodexProvider.isAvailable().available);
      if (backend === 'exec') {
        return new CodexProvider({
          providerId: config.id,
          modelId: codexOverride?.modelId ?? config.modelId,
          reasoningEffort: codexOverride?.reasoningEffort,
        });
      }
      const hasActivePrimaryInvocation = Array
        .from(this.activeTaskProviders.values())
        .some((activeTask) => activeTask.providerId === config.id);
      const canReuseSharedPrimary = !codexOverride?.modelId && !codexOverride?.reasoningEffort && !hasActivePrimaryInvocation;
      if (!canReuseSharedPrimary) {
        return new AppServerBackedProvider({
          providerId: config.id,
          modelId: codexOverride?.modelId ?? config.modelId,
          reasoningEffort: codexOverride?.reasoningEffort,
        });
      }
      if (!this.sharedPrimaryAppServerProvider) {
        this.sharedPrimaryAppServerProvider = new AppServerBackedProvider({
          providerId: config.id,
          modelId: config.modelId,
        });
      }
      return this.sharedPrimaryAppServerProvider;
    }
    return new CodexProvider({ providerId: config.id, modelId: config.modelId });
  }

  private createTaskInvocation(
    providerId: ProviderId,
    taskKind: AgentTaskKind = 'general',
    options?: AgentInvocationOptions,
  ): ActiveTaskInvocation {
    const provider = this.createProviderInstance(providerId, taskKind, options);
    const shouldDispose = hasDisposableProvider(provider) && provider !== this.sharedPrimaryAppServerProvider;
    return {
      providerId,
      runtime: new AgentRuntime(provider),
      runtimeStartedAt: Date.now(),
      dispose: shouldDispose
        ? async () => {
            await provider.dispose();
          }
        : undefined,
    };
  }

  private async disposeTaskInvocation(
    activeTask: ActiveTaskInvocation,
    providerId: ProviderId,
    taskId: string,
  ): Promise<void> {
    if (!activeTask.dispose) return;
    try {
      await activeTask.dispose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log(providerId, 'warn', `Task runtime cleanup failed: ${message}`, taskId);
    }
  }

  private buildUnavailableProviderMessage(providerId: ProviderId): string {
    const runtime = appStateStore.getState().providers[providerId];
    const suffix = runtime?.errorDetail ? ` ${runtime.errorDetail}` : '';
    const label = this.providers.get(providerId)?.label
      ?? PROVIDER_CONFIGS.find((entry) => entry.id === providerId)?.label
      ?? providerId;
    return `${label} is not available.${suffix}`.trim();
  }

  private completeImmediateResponse(
    taskId: string,
    providerId: ProviderId,
    output: string,
    summary: string,
    metadata?: Record<string, unknown>,
  ): InvocationResult {
    const result: InvocationResult = {
      taskId,
      providerId,
      success: true,
      output,
      artifacts: [],
      usage: { inputTokens: 0, outputTokens: 0, durationMs: 0 },
    };

    chatKnowledgeStore.recordAssistantMessage(taskId, output, providerId);
    taskMemoryStore.recordInvocationResult(result);
    appStateStore.dispatch({
      type: ActionType.UPDATE_TASK,
      taskId,
      updates: { status: 'completed', owner: providerId, updatedAt: Date.now() },
    });
    runtimeLedgerStore.recordTaskStatus({
      taskId,
      providerId,
      status: 'completed',
      summary,
      metadata,
    });
    this.log(providerId, 'info', summary, taskId);
    return result;
  }

  private assertProviderSupportsPrompt(
    providerId: ProviderId,
    prompt: string,
    options?: AgentInvocationOptions,
  ): void {
    const provider = this.providers.get(providerId);
    if (!provider) return;

    const profile = buildTaskProfile(prompt, options?.taskProfile);
    const requiresAppTools = taskKindRequiresV2ToolRuntime(profile.kind);

    if (!requiresAppTools || provider.supportsAppToolExecutor) return;

    throw new Error(
      `${provider.label} does not execute through the V2 tool runtime yet and cannot be used for ${profile.kind} tasks.`,
    );
  }

  private getProviderRoutingCapabilities(): Record<ProviderId, { supportsV2ToolRuntime: boolean }> {
    return Array.from(this.providers.values()).reduce<Record<ProviderId, { supportsV2ToolRuntime: boolean }>>(
      (capabilities, provider) => {
        capabilities[provider.id] = {
          supportsV2ToolRuntime: provider.supportsAppToolExecutor,
        };
        return capabilities;
      },
      {} as Record<ProviderId, { supportsV2ToolRuntime: boolean }>,
    );
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

  private queueBackgroundResearchSynthesis(input: {
    taskId: string;
    prompt: string;
    taskKind: AgentTaskKind;
    primaryProviderId: ProviderId;
    fastAnswer: string;
    groundedResearchContext?: string | null;
  }): void {
    const synthesisProviderId = backgroundResearchSynthesisProviderId();
    const synthesisProviderAvailable = this.providers.has(synthesisProviderId)
      && !Array.from(this.activeTaskProviders.values()).some((activeTask) => activeTask.providerId === synthesisProviderId);

    if (!shouldRunBackgroundResearchSynthesis({
      prompt: input.prompt,
      taskKind: input.taskKind,
      primaryProviderId: input.primaryProviderId,
      synthesisProviderAvailable,
    })) {
      return;
    }

    void this.runBackgroundResearchSynthesis({
      ...input,
      synthesisProviderId,
    });
  }

  private async runBackgroundResearchSynthesis(input: {
    taskId: string;
    prompt: string;
    taskKind: AgentTaskKind;
    primaryProviderId: ProviderId;
    synthesisProviderId: ProviderId;
    fastAnswer: string;
    groundedResearchContext?: string | null;
  }): Promise<void> {
    const toolTranscript = chatKnowledgeStore.readLast(input.taskId, {
      role: 'tool',
      count: 8,
      maxChars: 10_000,
    });
    if (!toolTranscript.text.trim()) {
      this.log(input.synthesisProviderId, 'info', 'Background research synthesis skipped: no cached tool evidence', input.taskId);
      return;
    }

    const synthesisTask = this.createTaskInvocation(input.synthesisProviderId);
    try {
      const synthesisContext = buildBackgroundResearchSynthesisContext({
        prompt: input.prompt,
        fastAnswer: input.fastAnswer,
        threadSummary: chatKnowledgeStore.threadSummary(input.taskId),
        evidenceTranscript: toolTranscript.text,
        groundedResearchContext: input.groundedResearchContext,
      });
      const response = await synthesisTask.runtime.run({
        mode: 'unrestricted-dev',
        agentId: input.synthesisProviderId,
        role: 'secondary',
        taskId: input.taskId,
        task: buildBackgroundResearchSynthesisTask({
          groundedEvidenceReasoning: Boolean(input.groundedResearchContext?.trim()),
        }),
        contextPrompt: synthesisContext,
        allowedTools: [],
        canSpawnSubagents: false,
        maxToolTurns: 1,
        onStatus: (status) => {
          if (!status.trim()) return;
          this.log(input.synthesisProviderId, 'info', `Background synthesis status: ${status}`, input.taskId);
        },
      });

      const formatted = formatBackgroundResearchSynthesis(response.output);
      if (!formatted || formatted === NO_MATERIAL_RESEARCH_UPDATE) {
        this.log(input.synthesisProviderId, 'info', 'Background research synthesis found no material update', input.taskId);
        return;
      }

      chatKnowledgeStore.recordAssistantMessage(input.taskId, formatted, input.synthesisProviderId);
      taskMemoryStore.recordInvocationResult({
        taskId: input.taskId,
        providerId: input.synthesisProviderId,
        success: true,
        output: formatted,
        artifacts: [],
        usage: response.usage || { inputTokens: 0, outputTokens: 0, durationMs: 0 },
        codexItems: response.codexItems,
      });
      appStateStore.dispatch({
        type: ActionType.UPDATE_TASK,
        taskId: input.taskId,
        updates: { updatedAt: Date.now() },
      });
      this.emitProgress({
        taskId: input.taskId,
        providerId: input.synthesisProviderId,
        type: 'status',
        data: 'Background synthesis appended a refined answer.',
        timestamp: Date.now(),
      });
      this.log(input.synthesisProviderId, 'info', 'Background research synthesis appended to task memory', input.taskId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log(input.synthesisProviderId, 'warn', `Background research synthesis failed: ${message}`, input.taskId);
    } finally {
      await this.disposeTaskInvocation(synthesisTask, input.synthesisProviderId, input.taskId);
    }
  }
}
export const agentModelService = new AgentModelService();
