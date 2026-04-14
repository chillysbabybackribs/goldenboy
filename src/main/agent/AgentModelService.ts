import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/types/ipc';
import { LogSource } from '../../shared/types/appState';
import {
  HAIKU_PROVIDER_ID,
  PRIMARY_PROVIDER_ID,
  AgentInvocationOptions,
  InvocationResult,
  ProviderId,
  ProviderRuntime,
} from '../../shared/types/model';
import { ActionType } from '../state/actions';
import { appStateStore } from '../state/appStateStore';
import { eventBus } from '../events/eventBus';
import { AppEventType } from '../../shared/types/events';
import { generateId } from '../../shared/utils/ids';
import { AgentProvider, AgentToolName } from './AgentTypes';
import { AgentRuntime } from './AgentRuntime';
import { CodexProvider } from './CodexProvider';
import { HaikuProvider } from './HaikuProvider';
import { AppServerBackedProvider } from './AppServerBackedProvider';
import { agentToolExecutor } from './AgentToolExecutor';
import { createBrowserToolDefinitions } from './tools/browserTools';
import { createChatToolDefinitions } from './tools/chatTools';
import { createAttachmentToolDefinitions, DOCUMENT_ATTACHMENT_TOOL_NAMES } from './tools/attachmentTools';
import { createFilesystemToolDefinitions } from './tools/filesystemTools';
import { createRuntimeToolDefinitions } from './tools/runtimeTools';
import { createTerminalToolDefinitions } from './tools/terminalTools';
import { createSubAgentToolDefinitions } from './tools/subagentTools';
import { taskMemoryStore } from '../models/taskMemoryStore';
import { chatKnowledgeStore } from '../chatKnowledge/ChatKnowledgeStore';
import { scopeForPrompt, withBrowserSearchDirective } from './runtimeScope';
import { pickProviderForPrompt, taskKindRequiresV2ToolRuntime } from './providerRouting';
import { SubAgentSpawnInput } from './subagents/SubAgentTypes';
import { buildTaskProfile } from './taskProfile';
import { browserService } from '../browser/BrowserService';
import type { AgentTaskKind } from '../../shared/types/model';
import { buildStartupStatusMessages, shouldPrimeResearchBrowserSurface } from './startupProgress';
import {
  backgroundResearchSynthesisProviderId,
  buildBackgroundResearchSynthesisContext,
  buildBackgroundResearchSynthesisTask,
  formatBackgroundResearchSynthesis,
  NO_MATERIAL_RESEARCH_UPDATE,
  shouldRunBackgroundResearchSynthesis,
} from './researchSynthesis';
import type { InvocationAttachment } from '../../shared/types/model';
import type { DocumentInvocationAttachment } from '../../shared/types/attachments';

type ProviderEntry = {
  id: ProviderId;
  label: string;
  modelId?: string;
  supportsAppToolExecutor: boolean;
};

type ActiveTaskInvocation = {
  providerId: ProviderId;
  runtime: AgentRuntime;
  dispose?: () => Promise<void>;
};

const PROVIDER_CONFIGS: Array<{ id: ProviderId; label: string; modelId: string }> = [
  { id: PRIMARY_PROVIDER_ID, label: 'Codex', modelId: PRIMARY_PROVIDER_ID },
  { id: HAIKU_PROVIDER_ID, label: 'Haiku 4.5', modelId: HAIKU_PROVIDER_ID },
];

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

  init(): void {
    agentToolExecutor.registerMany([
      ...createAttachmentToolDefinitions(),
      ...createRuntimeToolDefinitions(),
      ...createBrowserToolDefinitions(),
      ...createChatToolDefinitions(),
      ...createFilesystemToolDefinitions(),
      ...createTerminalToolDefinitions(),
      ...createSubAgentToolDefinitions((input) => this.createPreferredSubAgentProvider(input)),
    ]);

    if (process.env.CODEX_PROVIDER === 'exec') {
      this.initializeCodexProvider(PROVIDER_CONFIGS[0]);
    } else {
      void this.initializeAppServerProvider(PROVIDER_CONFIGS[0]);
    }
    this.initializeHaikuProvider(PROVIDER_CONFIGS[1]);

    if (this.providers.size === 0) {
      this.log('system', 'warn', 'No model providers are available.');
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
    const providerId = this.pickProvider(prompt, explicitOwner, options);
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(this.buildUnavailableProviderMessage(providerId));
    }
    const activeTask = this.createTaskInvocation(providerId);

    const attachmentSummary = buildAttachmentSummary(options?.attachments);
    const displayPrompt = typeof options?.displayPrompt === 'string' ? options.displayPrompt : prompt;
    const chatUserMessage = chatKnowledgeStore.recordUserMessage(
      taskId,
      buildChatUserMessageText(displayPrompt, options?.attachments),
    );
    taskMemoryStore.recordUserPrompt(taskId, displayPrompt, {
      attachments: options?.attachments,
      attachmentSummary,
    });
    const taskMemoryContext = taskMemoryStore.buildContext(taskId);
    this.activeTaskProviders.set(taskId, activeTask);

    appStateStore.dispatch({
      type: ActionType.UPDATE_TASK,
      taskId,
      updates: { status: 'running', owner: providerId, updatedAt: Date.now() },
    });
    this.setRuntime(providerId, {
      status: 'busy',
      activeTaskId: taskId,
      errorDetail: null,
    });
    this.log(providerId, 'info', `${provider.label} invocation started`, taskId);

    try {
      const taskProfile = buildTaskProfile(prompt, options?.taskProfile);
      this.emitStartupStatuses(taskId, providerId, taskProfile.kind);
      if (shouldPrimeResearchBrowserSurface(taskProfile.kind, browserService.isCreated())) {
        void this.primeResearchBrowserSurface(prompt, providerId, taskId);
      }

      const runtimePrompt = withBrowserSearchDirective(prompt, options?.taskProfile);
      const runtimeScope = scopeForPrompt(prompt, options?.taskProfile);
      const contextPrompt = buildContextPrompt([
        buildAutomaticTaskContinuationContext(taskId, prompt),
        chatKnowledgeStore.buildInvocationContext(taskId, chatUserMessage.id),
        taskMemoryContext,
        buildDocumentAttachmentContext(options?.attachments),
      ]);
      const response = await activeTask.runtime.run({
        ...runtimeScope,
        mode: 'unrestricted-dev',
        agentId: providerId,
        role: 'primary',
        task: runtimePrompt,
        taskId,
        cwd: options?.cwd,
        contextPrompt,
        systemPromptAddendum: options?.systemPrompt,
        allowedTools: withDocumentAttachmentTools(runtimeScope.allowedTools, options?.attachments),
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

      const result: InvocationResult = {
        taskId,
        providerId,
        success: true,
        output: response.output,
        artifacts: [],
        codexItems: response.codexItems,
        usage: response.usage || { inputTokens: 0, outputTokens: 0, durationMs: 0 },
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
      this.setRuntime(providerId, {
        status: 'available',
        activeTaskId: null,
        errorDetail: null,
      });
      this.log(providerId, 'info', `${provider.label} invocation completed`, taskId);
      this.queueBackgroundResearchSynthesis({
        taskId,
        prompt,
        taskKind: taskProfile.kind,
        primaryProviderId: providerId,
        fastAnswer: response.output,
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
        usage: { inputTokens: 0, outputTokens: 0, durationMs: 0 },
      };
      chatKnowledgeStore.recordAssistantMessage(taskId, `Invocation failed: ${message}`, providerId);
      taskMemoryStore.recordInvocationResult(result);
      appStateStore.dispatch({
        type: ActionType.UPDATE_TASK,
        taskId,
        updates: { status: 'failed', owner: providerId, updatedAt: Date.now() },
      });
      this.setRuntime(providerId, {
        status: 'error',
        activeTaskId: null,
        errorDetail: message,
      });
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
    this.setRuntime(config.id, { status: 'available', activeTaskId: null, errorDetail: null }, config.modelId);
    this.log(config.id, 'info', `${config.label} ready (isolated app-server mode)`);
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
    if (input?.providerId && input.providerId !== 'auto') {
      if (!this.providers.has(input.providerId)) {
        throw new Error(this.buildUnavailableProviderMessage(input.providerId));
      }
      this.assertProviderSupportsPrompt(input.providerId, taskPrompt);
      return this.createProviderInstance(input.providerId);
    }

    const preferred = this.pickAutoProvider(taskPrompt);
    if (preferred) return this.createProviderInstance(preferred);
    throw new Error('No compatible provider is available for the requested sub-agent task.');
  }

  private createProviderInstance(providerId: ProviderId): AgentProvider {
    const config = PROVIDER_CONFIGS.find((entry) => entry.id === providerId);
    if (!config) {
      throw new Error(`Unknown provider configuration: ${providerId}`);
    }
    if (providerId === HAIKU_PROVIDER_ID) {
      return new HaikuProvider();
    }
    if (providerId === PRIMARY_PROVIDER_ID && process.env.CODEX_PROVIDER !== 'exec') {
      return new AppServerBackedProvider({
        providerId: config.id,
        modelId: config.modelId,
      });
    }
    return new CodexProvider({ providerId: config.id, modelId: config.modelId });
  }

  private createTaskInvocation(providerId: ProviderId): ActiveTaskInvocation {
    const provider = this.createProviderInstance(providerId);
    return {
      providerId,
      runtime: new AgentRuntime(provider),
      dispose: hasDisposableProvider(provider)
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

  private async primeResearchBrowserSurface(prompt: string, providerId: ProviderId, taskId: string): Promise<void> {
    try {
      browserService.createTab(prompt);
      this.log(providerId, 'info', 'Pre-opened browser search tab for research task', taskId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log(providerId, 'warn', `Browser search prewarm skipped: ${message}`, taskId);
    }
  }

  private queueBackgroundResearchSynthesis(input: {
    taskId: string;
    prompt: string;
    taskKind: AgentTaskKind;
    primaryProviderId: ProviderId;
    fastAnswer: string;
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

    this.emitProgress({
      taskId: input.taskId,
      providerId: input.primaryProviderId,
      type: 'status',
      data: 'Launching background synthesis from cached browser evidence.',
      timestamp: Date.now(),
    });

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
      });
      const response = await synthesisTask.runtime.run({
        mode: 'unrestricted-dev',
        agentId: input.synthesisProviderId,
        role: 'secondary',
        taskId: input.taskId,
        task: buildBackgroundResearchSynthesisTask(),
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

function isSupportedProvider(value: string): value is ProviderId {
  return value === PRIMARY_PROVIDER_ID || value === HAIKU_PROVIDER_ID;
}

function hasDisposableProvider(provider: AgentProvider): provider is AgentProvider & { dispose(): Promise<void> | void } {
  return typeof (provider as { dispose?: unknown }).dispose === 'function';
}

function buildContextPrompt(parts: Array<string | null | undefined>): string | null {
  return packContextSections(parts, 4_000, '\n...[context truncated]');
}

function buildAutomaticTaskContinuationContext(taskId: string, prompt: string): string | null {
  if (!looksLikeContinuationPrompt(prompt) && !lastInvocationFailed(taskId)) {
    return null;
  }

  const recall = chatKnowledgeStore.recall(taskId, {
    query: prompt,
    intent: 'follow_up',
    maxChars: 2500,
  });
  const lastFailure = getLastFailureText(taskId);
  const sections = [
    '## Continuation Context',
    'This task is being resumed. Continue from prior evidence and prior tool work instead of restarting broad exploration unless the prior state is clearly insufficient.',
  ];

  if (lastFailure) {
    sections.push('', '### Last Failure', lastFailure);
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
