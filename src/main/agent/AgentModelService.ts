import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/types/ipc';
import { InvocationResult, ProviderRuntime } from '../../shared/types/model';
import { ActionType } from '../state/actions';
import { appStateStore } from '../state/appStateStore';
import { eventBus } from '../events/eventBus';
import { AppEventType } from '../../shared/types/events';
import { generateId } from '../../shared/utils/ids';
import { AgentRuntime } from './AgentRuntime';
import { HaikuProvider } from './HaikuProvider';
import { agentToolExecutor } from './AgentToolExecutor';
import { createBrowserToolDefinitions } from './tools/browserTools';
import { createFilesystemToolDefinitions } from './tools/filesystemTools';
import { createTerminalToolDefinitions } from './tools/terminalTools';
import { createSubAgentToolDefinitions } from './tools/subagentTools';
import { createChatToolDefinitions } from './tools/chatTools';
import { taskMemoryStore } from '../models/taskMemoryStore';
import { chatKnowledgeStore } from '../chatKnowledge/ChatKnowledgeStore';
import { scopeForPrompt, withBrowserSearchDirective } from './runtimeScope';

class AgentModelService {
  private runtime: AgentRuntime | null = null;
  private modelId: string | null = null;

  init(): void {
    agentToolExecutor.registerMany(createBrowserToolDefinitions());
    agentToolExecutor.registerMany(createChatToolDefinitions());
    agentToolExecutor.registerMany(createFilesystemToolDefinitions());
    agentToolExecutor.registerMany(createTerminalToolDefinitions());
    agentToolExecutor.registerMany(createSubAgentToolDefinitions(() => new HaikuProvider()));

    try {
      const provider = new HaikuProvider();
      this.runtime = new AgentRuntime(provider);
      this.modelId = provider.modelId;
      this.setRuntime({
        status: 'available',
        activeTaskId: null,
        errorDetail: null,
      });
      this.log('info', `Haiku provider ready: ${provider.modelId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.runtime = null;
      this.modelId = null;
      this.setRuntime({
        status: 'unavailable',
        activeTaskId: null,
        errorDetail: message,
      });
      this.log('warn', `Haiku provider unavailable: ${message}`);
    }
  }

  getProviderStatuses(): Record<string, ProviderRuntime> {
    return appStateStore.getState().providers;
  }

  resolve(_prompt: string, explicitOwner?: string): string {
    return explicitOwner || 'haiku';
  }

  cancel(_taskId: string): boolean {
    return false;
  }

  getTaskMemory(taskId: string) {
    return taskMemoryStore.get(taskId);
  }

  async invoke(taskId: string, prompt: string): Promise<InvocationResult> {
    if (!this.runtime) {
      throw new Error('Haiku provider is not available. Check ANTHROPIC_API_KEY and ANTHROPIC_MODEL.');
    }

    const chatUserMessage = chatKnowledgeStore.recordUserMessage(taskId, prompt);
    const taskMemoryContext = taskMemoryStore.buildContext(taskId);
    taskMemoryStore.recordUserPrompt(taskId, prompt);
    appStateStore.dispatch({
      type: ActionType.UPDATE_TASK,
      taskId,
      updates: { status: 'running', updatedAt: Date.now() },
    });
    this.setRuntime({
      status: 'busy',
      activeTaskId: taskId,
      errorDetail: null,
    });
    this.log('info', 'Haiku invocation started', taskId);

    try {
      const runtimePrompt = withBrowserSearchDirective(prompt);
      const contextPrompt = buildContextPrompt([
        chatKnowledgeStore.buildInvocationContext(taskId, chatUserMessage.id),
        taskMemoryContext,
      ]);
      const response = await this.runtime.run({
        ...scopeForPrompt(prompt),
        mode: 'unrestricted-dev',
        agentId: 'haiku',
        role: 'primary',
        task: runtimePrompt,
        taskId,
        contextPrompt,
        onToken: (text) => {
          this.emitProgress({
            taskId,
            providerId: 'haiku',
            type: 'token',
            data: text,
            timestamp: Date.now(),
          });
        },
      });

      const result: InvocationResult = {
        taskId,
        providerId: 'haiku',
        success: true,
        output: response.output,
        artifacts: [],
        usage: response.usage || { inputTokens: 0, outputTokens: 0, durationMs: 0 },
      };

      chatKnowledgeStore.recordAssistantMessage(taskId, response.output, 'haiku');
      taskMemoryStore.recordInvocationResult(result);
      appStateStore.dispatch({
        type: ActionType.UPDATE_TASK,
        taskId,
        updates: { status: 'completed', updatedAt: Date.now() },
      });
      this.setRuntime({
        status: 'available',
        activeTaskId: null,
        errorDetail: null,
      });
      this.log('info', 'Haiku invocation completed', taskId);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const result: InvocationResult = {
        taskId,
        providerId: 'haiku',
        success: false,
        output: '',
        artifacts: [],
        error: message,
        usage: { inputTokens: 0, outputTokens: 0, durationMs: 0 },
      };
      chatKnowledgeStore.recordAssistantMessage(taskId, `Invocation failed: ${message}`, 'haiku');
      taskMemoryStore.recordInvocationResult(result);
      appStateStore.dispatch({
        type: ActionType.UPDATE_TASK,
        taskId,
        updates: { status: 'failed', updatedAt: Date.now() },
      });
      this.setRuntime({
        status: 'error',
        activeTaskId: null,
        errorDetail: message,
      });
      this.log('error', `Haiku invocation failed: ${message}`, taskId);
      return result;
    }
  }

  private setRuntime(patch: Pick<ProviderRuntime, 'status' | 'activeTaskId' | 'errorDetail'>): void {
    appStateStore.dispatch({
      type: ActionType.SET_PROVIDER_RUNTIME,
      providerId: 'haiku',
      runtime: {
        id: 'haiku',
        status: patch.status,
        activeTaskId: patch.activeTaskId,
        lastActivityAt: Date.now(),
        errorDetail: patch.errorDetail,
        model: this.modelId || undefined,
      },
    });
  }

  private log(level: 'info' | 'warn' | 'error', message: string, taskId?: string): void {
    const log = {
      id: generateId('log'),
      timestamp: Date.now(),
      level,
      source: 'haiku' as const,
      message,
      taskId,
    };
    eventBus.emit(AppEventType.LOG_ADDED, { log });
  }

  emitProgress(progress: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC_CHANNELS.MODEL_PROGRESS, progress);
    }
  }
}

function buildContextPrompt(parts: Array<string | null | undefined>): string | null {
  const context = parts
    .map(part => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join('\n\n');
  if (!context) return null;
  return context.length > 4_000 ? `${context.slice(0, 4_000)}\n...[context truncated]` : context;
}

export const agentModelService = new AgentModelService();
