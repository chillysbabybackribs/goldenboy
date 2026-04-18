import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/types/ipc';
import { LogSource } from '../../shared/types/appState';
import {
  HAIKU_PROVIDER_ID,
  PRIMARY_PROVIDER_ID,
  type AgentTaskKind,
  AgentInvocationOptions,
  type CodexItem,
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
import { AgentProvider, AgentToolName } from './AgentTypes';
import { AgentRuntime } from './AgentRuntime';
import { CodexProvider } from './CodexProvider';
import { HaikuProvider } from './HaikuProvider';
import { AppServerBackedProvider } from './AppServerBackedProvider';
import { agentToolExecutor } from './AgentToolExecutor';
import { createBrowserToolDefinitions } from './tools/browserTools';
import { createChatToolDefinitions } from './tools/chatTools';
import { createAttachmentToolDefinitions, DOCUMENT_ATTACHMENT_TOOL_NAMES } from './tools/attachmentTools';
import { createArtifactToolDefinitions } from './tools/artifactTools';
import { artifactService } from '../artifacts/ArtifactService';
import { createFilesystemToolDefinitions } from './tools/filesystemTools';
import { createRuntimeToolDefinitions } from './tools/runtimeTools';
import { createTerminalToolDefinitions } from './tools/terminalTools';
import { createSubAgentToolDefinitions } from './tools/subagentTools';
import { taskMemoryStore } from '../models/taskMemoryStore';
import { runtimeLedgerStore } from '../models/runtimeLedgerStore';
import { chatKnowledgeStore } from '../chatKnowledge/ChatKnowledgeStore';
import { fileKnowledgeStore } from '../fileKnowledge/FileKnowledgeStore';
import { scopeForPrompt, withBrowserSearchDirective } from './runtimeScope';
import { pickProviderForPrompt, taskKindRequiresV2ToolRuntime } from './providerRouting';
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
  contextPromptBudgetForTaskKind,
  shouldIncludeArtifactContext,
  shouldIncludeConversationContext,
  shouldIncludeTaskMemoryContext,
} from './invocationContextPolicy';
import { chatHydrationDetector, type HydrationNeed } from './ChatHydrationDetector';
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
  runtimeStartedAt: number;
  dispose?: () => Promise<void>;
};

function normalizeStatusProcessEntry(status: string): PersistedTurnProcessEntry | null {
  if (status === 'thought-migrate') return null;
  if (status.startsWith('thought:')) {
    const text = status.slice('thought:'.length).trim();
    return text ? { kind: 'thought', text } : null;
  }
  if (status.startsWith('tool-start:')) {
    const text = status.slice('tool-start:'.length).trim();
    return text ? { kind: 'tool', text } : null;
  }
  if (status.startsWith('tool-done:')) {
    const text = status.slice('tool-done:'.length).trim();
    return text ? { kind: 'tool', text } : null;
  }
  return null;
}

function codexItemToProcessEntry(item: CodexItem): PersistedTurnProcessEntry | null {
  if (item.type === 'agent_message' || item.type === 'mcp_tool_call') return null;
  if (item.type === 'command_execution') {
    if (item.status === 'in_progress') return { kind: 'tool', text: `Run ${item.command}` };
    if (item.status === 'completed') {
      const detail = item.exit_code == null ? 'done' : (item.exit_code === 0 ? 'done' : `exit ${item.exit_code}`);
      return { kind: 'tool', text: `Run ${item.command} ... ${detail}` };
    }
    return { kind: 'tool', text: `Run ${item.command} ... failed` };
  }
  if (item.type === 'file_change') {
    if (item.status === 'completed') {
      const detail = item.changes.map((change) => `${change.kind} ${change.path}`).join(', ') || 'updated files';
      return { kind: 'tool', text: `File change ... ${detail}` };
    }
    if (item.status === 'failed') {
      return { kind: 'tool', text: 'File change ... error' };
    }
  }
  return null;
}

function mergeProcessEntries(
  statusEntries: PersistedTurnProcessEntry[],
  codexItems?: CodexItem[],
): PersistedTurnProcessEntry[] {
  const merged: PersistedTurnProcessEntry[] = [];
  const seen = new Set<string>();
  for (const entry of statusEntries) {
    const key = `${entry.kind}:${entry.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  for (const item of codexItems || []) {
    const entry = codexItemToProcessEntry(item);
    if (!entry) continue;
    const key = `${entry.kind}:${entry.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  return merged;
}

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

function formatArtifactTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function buildArtifactContext(): string | null {
  const state = appStateStore.getState();
  if (!state.artifacts.length) return null;

  const activeArtifact = state.activeArtifactId
    ? state.artifacts.find((artifact) => artifact.id === state.activeArtifactId) || null
    : null;
  const recentArtifacts = [...state.artifacts]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5);

  const sections = [
    '## Workspace Artifacts',
    'Managed workspace artifacts exist independently of tasks. For supported workspace documents (`md`, `txt`, `html`, `csv`), use artifact.* tools instead of filesystem.* tools.',
    'Use artifact.get_active to resolve requests like "update this document" or "append to this sheet". Use artifact.read before replacing existing content when you need the current artifact text.',
  ];

  if (activeArtifact) {
    let preview = '';
    try {
      const content = artifactService.readContent(activeArtifact.id).content.trim();
      if (content) {
        const trimmed = content.length > 600 ? `${content.slice(0, 600)}\n...[artifact preview truncated]` : content;
        preview = trimmed;
      }
    } catch {
      preview = '';
    }
    sections.push(
      '',
      `Active artifact: ${activeArtifact.title} [id=${activeArtifact.id}] (${activeArtifact.format}, status=${activeArtifact.status}, updated=${formatArtifactTimestamp(activeArtifact.updatedAt)})`,
    );
    if (preview) {
      sections.push('', 'Active artifact preview:', preview);
    }
  } else {
    sections.push('', 'Active artifact: none selected');
  }

  sections.push('', 'Recent artifacts:');
  for (const artifact of recentArtifacts) {
    sections.push(
      `- ${artifact.title} [id=${artifact.id}] (${artifact.format}, status=${artifact.status}, updated=${formatArtifactTimestamp(artifact.updatedAt)})`,
    );
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

function supportsFileCacheContext(taskKind: AgentTaskKind): boolean {
  return taskKind === 'implementation' || taskKind === 'debug' || taskKind === 'review';
}

function buildFileCacheContext(taskKind: AgentTaskKind): string | null {
  if (!supportsFileCacheContext(taskKind)) return null;
  const stats = fileKnowledgeStore.getStats();
  const indexedAt = stats.indexedAt ? new Date(stats.indexedAt).toISOString() : null;

  if (stats.fileCount === 0 || stats.chunkCount === 0) {
    return [
      '## Indexed File Cache',
      'The indexed file cache is currently empty.',
      'If you need indexed repo search or chunk reads, call `filesystem.index_workspace` once before relying on `filesystem.search_file_cache` or `filesystem.read_file_chunk`.',
    ].join('\n');
  }

  return [
    '## Indexed File Cache',
    `The indexed file cache is already available with ${stats.fileCount} files and ${stats.chunkCount} chunks${indexedAt ? ` (indexed at ${indexedAt})` : ''}.`,
    'Prefer `filesystem.search_file_cache` and `filesystem.read_file_chunk` first.',
    'Avoid calling `filesystem.index_workspace` unless the cache is empty, clearly stale after file-changing commands, or you need a deliberate refresh.',
  ].join('\n');
}

export class AgentModelService {
  private providers = new Map<ProviderId, ProviderEntry>();
  private activeTaskProviders = new Map<string, ActiveTaskInvocation>();
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

    void this.initializeAppServerProvider(PROVIDER_CONFIGS[0]);
    this.initializeHaikuProvider(PROVIDER_CONFIGS[1]);

    if (this.providers.size === 0) {
      this.log('system', 'warn', 'No model providers are available.');
    }
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
    const providerId = this.pickProvider(prompt, explicitOwner, options);
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(this.buildUnavailableProviderMessage(providerId));
    }
    const taskProfile = buildTaskProfile(prompt, options?.taskProfile);
    const activeTask = this.createTaskInvocation(providerId, taskProfile.kind);
    const hadTaskHistory = taskMemoryStore.hasEntries(taskId);
    const hadConversationHistory = Boolean(chatKnowledgeStore.threadSummary(taskId));
    const hasArtifacts = appStateStore.getState().artifacts.length > 0;
    const lastProviderId = getLastInvocationProviderId(taskId);
    const providerSwitched = Boolean(lastProviderId && lastProviderId !== providerId);
    if (lastProviderId && lastProviderId !== providerId) {
      runtimeLedgerStore.recordProviderSwitch(taskId, lastProviderId, providerId);
    }

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
    const currentTaskMemoryEntryId = taskMemoryStore.get(taskId).entries.at(-1)?.id;
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
    });
    this.log(providerId, 'info', `${provider.label} invocation started`, taskId);
    const persistedProcessEntries: PersistedTurnProcessEntry[] = [];

    try {
      const continuationPrompt = looksLikeContinuationPrompt(prompt);
      const richerConversationContextRequested = shouldIncludeConversationContext({
        prompt,
        hasPriorConversation: hadConversationHistory,
        isContinuation: continuationPrompt,
      });
      const includeTaskMemory = shouldIncludeTaskMemoryContext({
        prompt,
        taskKind: taskProfile.kind,
        hasPriorTaskMemory: hadTaskHistory,
        isContinuation: continuationPrompt,
        lastInvocationFailed: lastInvocationFailed(taskId),
      });
      const includeArtifactContext = shouldIncludeArtifactContext({
        prompt,
        taskKind: taskProfile.kind,
        hasArtifacts,
      });
      this.emitStartupStatuses(taskId, providerId, taskProfile.kind);

      const runtimePrompt = withBrowserSearchDirective(prompt, options?.taskProfile);
      const runtimeScope = scopeForPrompt(prompt, options?.taskProfile);
      const activeArtifact = appStateStore.getState().activeArtifactId
        ? appStateStore.getState().artifacts.find((artifact) => artifact.id === appStateStore.getState().activeArtifactId) ?? null
        : null;
      const artifactRoutingDecision = buildArtifactRoutingDecision(prompt, activeArtifact);
      const artifactRoutingInstructions = buildArtifactRoutingInstructions(artifactRoutingDecision);
      const shouldGroundResearch = false;
      const researchContext = null;
      const researchContextPrompt = null;
      const researchGroundingInstructions = null;
      const fullCatalogToolNames = agentToolExecutor.list().map((tool) => tool.name);
      const routedAllowedTools = withGroundedResearchAllowedTools(withArtifactRoutingAllowedTools(
        withDocumentAttachmentTools(runtimeScope.allowedTools, options?.attachments),
        artifactRoutingDecision,
        fullCatalogToolNames,
      ), researchContext, fullCatalogToolNames);
      const hydratableAllowedTools = withGroundedResearchAllowedTools(withArtifactRoutingAllowedTools(
        withDocumentAttachmentTools(fullCatalogToolNames, options?.attachments),
        artifactRoutingDecision,
        fullCatalogToolNames,
      ), researchContext, fullCatalogToolNames);
      const conversationContext = buildConversationHydrationContext({
        taskId,
        prompt,
        taskKind: taskProfile.kind,
        currentMessageId: chatUserMessage.id,
        hasPriorConversation: hadConversationHistory,
        richerContextRequested: richerConversationContextRequested,
        providerSwitched,
      });
      const contextPrompt = buildContextPrompt([
        buildAutomaticTaskContinuationContext(taskId, prompt, chatUserMessage.id),
        buildFollowUpResolutionContext(taskId, prompt, chatUserMessage.id),
        runtimeLedgerStore.buildTaskSwitchContext({
          taskId,
          prompt,
        }),
        runtimeLedgerStore.buildHydrationContext({
          taskId,
          currentProviderId: providerId,
          providerSwitched,
        }),
        conversationContext,
        includeTaskMemory ? taskMemoryStore.buildContext(taskId, {
          excludeEntryIds: currentTaskMemoryEntryId ? [currentTaskMemoryEntryId] : [],
        }) : null,
        includeArtifactContext ? buildArtifactContext() : null,
        artifactRoutingInstructions ? `## Artifact Route Decision\n${artifactRoutingInstructions}` : null,
        researchContextPrompt,
        buildFileCacheContext(taskProfile.kind),
        buildDocumentAttachmentContext(options?.attachments),
      ], taskProfile.kind);
      const response = await activeTask.runtime.run({
        ...runtimeScope,
        mode: 'unrestricted-dev',
        agentId: providerId,
        role: 'primary',
        task: runtimePrompt,
        taskId,
        cwd: options?.cwd,
        contextPrompt,
        systemPromptAddendum: [
          options?.systemPrompt,
          artifactRoutingInstructions,
          researchGroundingInstructions,
        ].filter(Boolean).join('\n\n') || undefined,
        allowedTools: routedAllowedTools,
        hydratableTools: hydratableAllowedTools,
        restrictToolCatalogToAllowedTools: Boolean(artifactRoutingDecision?.applies || shouldGroundResearch),
        requiresGroundedResearchHydration: shouldGroundResearch,
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
      });
      this.log(providerId, 'info', `${provider.label} invocation completed`, taskId);
      this.queueBackgroundResearchSynthesis({
        taskId,
        prompt,
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

  private createProviderInstance(providerId: ProviderId, taskKind: AgentTaskKind = 'general'): AgentProvider {
    const config = PROVIDER_CONFIGS.find((entry) => entry.id === providerId);
    if (!config) {
      throw new Error(`Unknown provider configuration: ${providerId}`);
    }
    if (providerId === HAIKU_PROVIDER_ID) {
      return new HaikuProvider();
    }
    if (providerId === PRIMARY_PROVIDER_ID) {
      if (this.sharedPrimaryAppServerProvider) {
        return this.sharedPrimaryAppServerProvider;
      }
      return new AppServerBackedProvider({
        providerId: config.id,
        modelId: config.modelId,
      });
    }
    return new CodexProvider({ providerId: config.id, modelId: config.modelId });
  }

  private createTaskInvocation(providerId: ProviderId, taskKind: AgentTaskKind = 'general'): ActiveTaskInvocation {
    const provider = this.createProviderInstance(providerId, taskKind);
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

function isSupportedProvider(value: string): value is ProviderId {
  return value === PRIMARY_PROVIDER_ID || value === HAIKU_PROVIDER_ID;
}

function hasDisposableProvider(provider: AgentProvider): provider is AgentProvider & { dispose(): Promise<void> | void } {
  return typeof (provider as { dispose?: unknown }).dispose === 'function';
}

function buildContextPrompt(parts: Array<string | null | undefined>, taskKind: AgentTaskKind): string | null {
  return packContextSections(parts, contextPromptBudgetForTaskKind(taskKind), '\n...[context truncated]');
}

function buildAutomaticTaskContinuationContext(taskId: string, prompt: string, currentMessageId?: string): string | null {
  if (!looksLikeContinuationPrompt(prompt) && !lastInvocationFailed(taskId)) {
    return null;
  }

  const recall = chatKnowledgeStore.recall(taskId, {
    query: prompt,
    intent: 'follow_up',
    maxChars: 1800,
    excludeMessageIds: currentMessageId ? [currentMessageId] : [],
  });
  const lastFailure = getLastFailureText(taskId);
  const sections = [
    '## Continuation Context',
    'This task is being resumed. Continue from prior evidence and prior tool work instead of restarting broad exploration unless the prior state is clearly insufficient.',
  ];

  if (lastFailure) {
    sections.push('', '### Last Failure', lastFailure);
  }
  if (recall.text) {
    sections.push('', '### Relevant Prior Work', recall.text);
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

function getLastInvocationProviderId(taskId: string): ProviderId | null {
  const record = taskMemoryStore.get(taskId);
  const latestResult = [...record.entries].reverse().find(
    (entry): entry is typeof entry & { providerId: ProviderId } => entry.kind === 'model_result' && Boolean(entry.providerId),
  );
  return latestResult?.providerId ?? null;
}

function getLastFailureText(taskId: string): string | null {
  const record = taskMemoryStore.get(taskId);
  const latestFailed = [...record.entries].reverse().find(
    entry => entry.kind === 'model_result' && entry.metadata?.success === false,
  );
  return latestFailed?.text || null;
}

function buildConversationHydrationContext(input: {
  taskId: string;
  prompt: string;
  taskKind: AgentTaskKind;
  currentMessageId: string;
  hasPriorConversation: boolean;
  richerContextRequested: boolean;
  providerSwitched: boolean;
}): string | null {
  const explicitPreviousChatRecall = isExplicitPreviousChatRecallPrompt(input.prompt);
  const hydrationTaskId = explicitPreviousChatRecall
    ? findMostRecentPriorConversationTaskId(input.taskId)
    : input.taskId;
  if (!hydrationTaskId) return null;
  if (!explicitPreviousChatRecall && !input.hasPriorConversation) return null;

  if (explicitPreviousChatRecall && hydrationTaskId !== input.taskId) {
    const searchTerms = chatHydrationDetector
      .extractContextKeywords(input.prompt)
      .filter((term) => !isGenericPreviousChatKeyword(term));
    const need: Exclude<HydrationNeed, 'none'> = searchTerms.length > 0 ? 'searched' : 'full';
    const maxChars = conversationHydrationBudget(input.taskKind, need, false);
    const recalled = chatKnowledgeStore.buildSilentHydrationContext(hydrationTaskId, {
      need,
      searchQuery: need === 'searched' ? searchTerms.join(' ') : undefined,
      maxChars,
      excludeToolResults: true,
    });
    if (!recalled) return null;
    return [
      '## Previous Chat Recall',
      'The user explicitly asked to reference the most recent prior chat thread. Use the recalled thread below as prior-chat context.',
      recalled,
    ].join('\n\n');
  }

  const detectedNeed = chatHydrationDetector.detectNeed({
    userMessage: input.prompt,
    taskId: hydrationTaskId,
    priorTaskExists: true,
    conversationMode: true,
    isFollowUp: input.richerContextRequested,
  });
  const shouldHydrate = input.richerContextRequested || detectedNeed !== 'none';
  if (!shouldHydrate) {
    return null;
  }

  const baseNeed: Exclude<HydrationNeed, 'none'> = detectedNeed === 'none' ? 'recent' : detectedNeed;
  const need: Exclude<HydrationNeed, 'none'> = input.providerSwitched && baseNeed !== 'searched'
    ? 'full'
    : baseNeed;
  const searchQuery = need === 'searched'
    ? chatHydrationDetector.extractContextKeywords(input.prompt).join(' ')
    : undefined;
  const maxChars = conversationHydrationBudget(input.taskKind, need, input.providerSwitched);

  return chatKnowledgeStore.buildSilentHydrationContext(hydrationTaskId, {
    need,
    searchQuery,
    maxChars,
    currentMessageId: hydrationTaskId === input.taskId ? input.currentMessageId : undefined,
    excludeToolResults: true,
  });
}

function isExplicitPreviousChatRecallPrompt(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return /\b(previous|prior|earlier|last)\s+(chat|thread|conversation)\b/.test(lower)
    || /\b(chat|thread|conversation)\s+from\s+(before|earlier|last time)\b/.test(lower)
    || /\breference\s+(the\s+)?previous\s+(chat|thread|conversation)\b/.test(lower)
    || /\buse\s+(the\s+)?previous\s+(chat|thread|conversation)\b/.test(lower);
}

function isGenericPreviousChatKeyword(term: string): boolean {
  return term === 'previous'
    || term === 'prior'
    || term === 'earlier'
    || term === 'last'
    || term === 'chat'
    || term === 'thread'
    || term === 'conversation'
    || term === 'reference'
    || term === 'use';
}

function findMostRecentPriorConversationTaskId(currentTaskId: string): string | null {
  const tasks = appStateStore.getState().tasks ?? [];
  const priorTasks = [...tasks]
    .filter((task) => task.id !== currentTaskId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  for (const task of priorTasks) {
    if (chatKnowledgeStore.threadSummary(task.id)) {
      return task.id;
    }
  }
  return null;
}

function buildFollowUpResolutionContext(
  taskId: string,
  prompt: string,
  currentMessageId: string,
): string | null {
  if (!looksLikeEllipticalFollowUp(prompt)) {
    return null;
  }

  const recent = chatKnowledgeStore.readLast(taskId, {
    count: 6,
    maxChars: 2_400,
    excludeMessageIds: [currentMessageId],
  });
  if (recent.messages.length === 0) {
    return null;
  }

  const lastAssistant = [...recent.messages].reverse().find((message) => message.role === 'assistant');
  const lastUser = [...recent.messages].reverse().find((message) => message.role === 'user');
  if (!lastAssistant) {
    return null;
  }

  const assistantText = chatKnowledgeStore.readMessage(taskId, lastAssistant.id, 700)?.text?.trim() || lastAssistant.preview;
  const userText = lastUser
    ? (chatKnowledgeStore.readMessage(taskId, lastUser.id, 500)?.text?.trim() || lastUser.preview)
    : '';

  const sections = [
    '## Follow-Up Resolution',
    'The current user message is an elliptical follow-up. Resolve it against the immediately preceding conversation before acting.',
  ];

  if (userText) {
    sections.push('', 'Latest prior user request:', userText);
  }

  sections.push(
    '',
    'Latest prior assistant message:',
    assistantText,
    '',
    `Resolution rule: ${followUpResolutionRule(prompt)}`,
  );

  return sections.join('\n');
}

function looksLikeEllipticalFollowUp(prompt: string): boolean {
  const lower = prompt.toLowerCase().trim();
  if (!lower) return false;
  if (lower.length > 120) return false;

  return /^(yes|yeah|yep|sure|ok|okay|no|nope|go ahead|do it|proceed|sounds good|that works)\b/.test(lower)
    || /\b(?:it|this|that|same)\b/.test(lower)
    || /\b(?:install|fix|debug|review|apply|do|ship|help)\b/.test(lower);
}

function followUpResolutionRule(prompt: string): string {
  const lower = prompt.toLowerCase().trim();
  if (/^(no|nope)\b/.test(lower)) {
    return 'Treat this as declining or reversing the most recent concrete assistant proposal; do not perform that action unless the user then specifies another one.';
  }

  if (/^(yes|yeah|yep|sure|ok|okay|go ahead|do it|proceed|sounds good|that works)\b/.test(lower)) {
    return 'Treat this as approval to carry out the most recent concrete assistant proposal, installation step, fix, or next action.';
  }

  return 'Treat references like "it", "this", or "that" as pointing to the most recent concrete assistant proposal, identified issue, or requested fix unless a newer explicit referent appears.';
}

function conversationHydrationBudget(
  taskKind: AgentTaskKind,
  need: Exclude<HydrationNeed, 'none'>,
  providerSwitched: boolean,
): number {
  const baseBudget = contextPromptBudgetForTaskKind(taskKind);
  if (providerSwitched && need === 'full') {
    return Math.min(1600, Math.max(900, Math.floor(baseBudget * 0.45)));
  }

  switch (need) {
    case 'full':
      return Math.min(1400, Math.max(850, Math.floor(baseBudget * 0.4)));
    case 'searched':
      return Math.min(1200, Math.max(800, Math.floor(baseBudget * 0.35)));
    case 'recent':
    default:
      return Math.min(850, Math.max(500, Math.floor(baseBudget * 0.25)));
  }
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
