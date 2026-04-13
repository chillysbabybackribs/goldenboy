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
import { AgentProvider } from './AgentTypes';
import { AgentRuntime } from './AgentRuntime';
import { CodexProvider } from './CodexProvider';
import { HaikuProvider } from './HaikuProvider';
import { agentToolExecutor } from './AgentToolExecutor';
import { createBrowserToolDefinitions } from './tools/browserTools';
import { createChatToolDefinitions } from './tools/chatTools';
import { createFilesystemToolDefinitions } from './tools/filesystemTools';
import { createRuntimeToolDefinitions } from './tools/runtimeTools';
import { createTerminalToolDefinitions } from './tools/terminalTools';
import { createSubAgentToolDefinitions } from './tools/subagentTools';
import { taskMemoryStore } from '../models/taskMemoryStore';
import { chatKnowledgeStore } from '../chatKnowledge/ChatKnowledgeStore';
import { scopeForPrompt, withBrowserSearchDirective } from './runtimeScope';
import { pickProviderForPrompt } from './providerRouting';
import { SubAgentSpawnInput } from './subagents/SubAgentTypes';
import { buildTaskProfile } from './taskProfile';

type ProviderEntry = {
  id: ProviderId;
  label: string;
  modelId?: string;
  supportsAppToolExecutor: boolean;
  runtime: AgentRuntime;
};

const PROVIDER_CONFIGS: Array<{ id: ProviderId; label: string; modelId: string }> = [
  { id: PRIMARY_PROVIDER_ID, label: 'GPT-5.4', modelId: PRIMARY_PROVIDER_ID },
  { id: HAIKU_PROVIDER_ID, label: 'Haiku 4.5', modelId: HAIKU_PROVIDER_ID },
];

class AgentModelService {
  private providers = new Map<ProviderId, ProviderEntry>();
  private activeTaskProviders = new Map<string, ProviderId>();

  init(): void {
    agentToolExecutor.registerMany([
      ...createRuntimeToolDefinitions(),
      ...createBrowserToolDefinitions(),
      ...createChatToolDefinitions(),
      ...createFilesystemToolDefinitions(),
      ...createTerminalToolDefinitions(),
      ...createSubAgentToolDefinitions((input) => this.createPreferredSubAgentProvider(input)),
    ]);

    this.initializeCodexProvider(PROVIDER_CONFIGS[0]);
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
    const providerId = this.activeTaskProviders.get(taskId);
    if (!providerId) return false;
    const provider = this.providers.get(providerId);
    if (!provider) return false;
    try {
      provider.runtime.abort();
      this.log(providerId, 'info', 'Task cancelled by user', taskId);
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

    const chatUserMessage = chatKnowledgeStore.recordUserMessage(taskId, prompt);
    const taskMemoryContext = taskMemoryStore.buildContext(taskId);
    taskMemoryStore.recordUserPrompt(taskId, prompt);
    this.activeTaskProviders.set(taskId, providerId);

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
      const runtimePrompt = withBrowserSearchDirective(prompt, options?.taskProfile);
      const contextPrompt = buildContextPrompt([
        buildAutomaticTaskContinuationContext(taskId, prompt),
        chatKnowledgeStore.buildInvocationContext(taskId, chatUserMessage.id),
        taskMemoryContext,
      ]);
      const response = await provider.runtime.run({
        ...scopeForPrompt(prompt, options?.taskProfile),
        mode: 'unrestricted-dev',
        agentId: providerId,
        role: 'primary',
        task: runtimePrompt,
        taskId,
        cwd: options?.cwd,
        contextPrompt,
        systemPromptAddendum: options?.systemPrompt,
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
      runtime: new AgentRuntime(provider),
    });
    this.setRuntime(config.id, {
      status: 'available',
      activeTaskId: null,
      errorDetail: null,
    }, provider.modelId);
    this.log(config.id, 'info', `${config.label} ready`);
  }

  private initializeHaikuProvider(config: { id: ProviderId; label: string; modelId: string }): void {
    try {
      const provider = new HaikuProvider();
      this.providers.set(config.id, {
        id: config.id,
        label: config.label,
        modelId: provider.modelId,
        supportsAppToolExecutor: Boolean(provider.supportsAppToolExecutor),
        runtime: new AgentRuntime(provider),
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
    const requiresAppTools = profile.kind === 'orchestration'
      || profile.kind === 'research'
      || profile.kind === 'implementation'
      || profile.kind === 'debug'
      || profile.kind === 'review';
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
    return new CodexProvider({
      providerId: config.id,
      modelId: config.modelId,
    });
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
    const requiresAppTools = profile.kind === 'orchestration'
      || profile.kind === 'research'
      || profile.kind === 'implementation'
      || profile.kind === 'debug'
      || profile.kind === 'review';

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
}

function isSupportedProvider(value: string): value is ProviderId {
  return value === PRIMARY_PROVIDER_ID || value === HAIKU_PROVIDER_ID;
}

function buildContextPrompt(parts: Array<string | null | undefined>): string | null {
  const context = parts
    .map(part => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join('\n\n');
  if (!context) return null;
  return context.length > 4_000 ? `${context.slice(0, 4_000)}\n...[context truncated]` : context;
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

export const agentModelService = new AgentModelService();
