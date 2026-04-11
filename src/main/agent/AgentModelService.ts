import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/types/ipc';
import { InvocationResult, ProviderRuntime } from '../../shared/types/model';
import { AgentToolName } from './AgentTypes';
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
import { shouldUseStrictSourceValidation } from './sourceValidationPolicy';

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

type RuntimeScope = {
  skillNames: string[];
  allowedTools: 'all' | AgentToolName[];
  canSpawnSubagents: boolean;
  maxToolTurns: number;
};

const DEFAULT_MAX_TOOL_TURNS = 20;
const STRICT_VALIDATION_MAX_TOOL_TURNS = 32;
const DELEGATION_MAX_TOOL_TURNS = 40;

const CHAT_TOOLS: AgentToolName[] = [
  'chat.thread_summary',
  'chat.read_last',
  'chat.search',
  'chat.read_message',
  'chat.read_window',
  'chat.recall',
  'chat.cache_stats',
];

const BROWSER_RESEARCH_TOOLS: AgentToolName[] = [
  'browser.get_state',
  'browser.get_tabs',
  'browser.search_web',
  'browser.research_search',
  'browser.close_tab',
  'browser.activate_tab',
  'browser.answer_from_cache',
  'browser.search_page_cache',
  'browser.read_cached_chunk',
  'browser.list_cached_pages',
  'browser.list_cached_sections',
  'browser.cache_stats',
];

const FILESYSTEM_TOOLS: AgentToolName[] = [
  'filesystem.list',
  'filesystem.search',
  'filesystem.index_workspace',
  'filesystem.answer_from_cache',
  'filesystem.search_file_cache',
  'filesystem.read_file_chunk',
  'filesystem.list_cached_files',
  'filesystem.file_cache_stats',
  'filesystem.read',
  'filesystem.write',
  'filesystem.patch',
  'filesystem.delete',
  'filesystem.mkdir',
  'filesystem.move',
];

const TERMINAL_TOOLS: AgentToolName[] = [
  'terminal.exec',
  'terminal.spawn',
  'terminal.write',
  'terminal.kill',
];

function scopeForPrompt(prompt: string): RuntimeScope {
  if (looksLikeDelegationTask(prompt)) {
    return {
      skillNames: ['browser-operation', 'filesystem-operation', 'local-debug', 'subagent-coordination'],
      allowedTools: 'all',
      canSpawnSubagents: true,
      maxToolTurns: DELEGATION_MAX_TOOL_TURNS,
    };
  }

  if (looksLikeBrowserSearchTask(prompt)) {
    return {
      skillNames: ['browser-operation'],
      allowedTools: [...BROWSER_RESEARCH_TOOLS, ...CHAT_TOOLS],
      canSpawnSubagents: false,
      maxToolTurns: shouldUseStrictSourceValidation(prompt) ? STRICT_VALIDATION_MAX_TOOL_TURNS : DEFAULT_MAX_TOOL_TURNS,
    };
  }

  if (looksLikeLocalCodeTask(prompt)) {
    return {
      skillNames: ['filesystem-operation', 'local-debug'],
      allowedTools: [...FILESYSTEM_TOOLS, ...TERMINAL_TOOLS, ...CHAT_TOOLS],
      canSpawnSubagents: false,
      maxToolTurns: DEFAULT_MAX_TOOL_TURNS,
    };
  }

  return {
    skillNames: ['browser-operation', 'filesystem-operation', 'local-debug'],
    allowedTools: [...BROWSER_RESEARCH_TOOLS, ...FILESYSTEM_TOOLS, ...TERMINAL_TOOLS, ...CHAT_TOOLS],
    canSpawnSubagents: false,
    maxToolTurns: shouldUseStrictSourceValidation(prompt) ? STRICT_VALIDATION_MAX_TOOL_TURNS : DEFAULT_MAX_TOOL_TURNS,
  };
}

function withBrowserSearchDirective(prompt: string): string {
  if (!looksLikeBrowserSearchTask(prompt)) return prompt;
  return [
    'Runtime directive: This is a browser-search task. You must call browser.research_search first with the user query. Let it open/cache one result at a time and stop when enough evidence is found. Use only browser-observed search results, cached page chunks, or pages opened in the owned browser as evidence. Do not answer from model memory or provider-native search.',
    '',
    `User request: ${prompt}`,
  ].join('\n');
}

function buildContextPrompt(parts: Array<string | null | undefined>): string | null {
  const context = parts
    .map(part => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join('\n\n');
  if (!context) return null;
  return context.length > 4_000 ? `${context.slice(0, 4_000)}\n...[context truncated]` : context;
}

function looksLikeDelegationTask(prompt: string): boolean {
  return /\b(sub-?agents?|delegate|parallel|concurrently|multiple agents?|workers?|split (?:the )?work)\b/i.test(prompt);
}

function looksLikeLocalCodeTask(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const local = /\b(file|files|codebase|repo|repository|workspace|folder|directory|project|typescript|javascript|electron|compile|build|test|fix|implement|patch|edit|refactor)\b/.test(normalized);
  const web = /\b(search|look up|lookup|find online|research|google|web search|latest|current|today|news)\b/.test(normalized);
  return local && !web;
}

function looksLikeBrowserSearchTask(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const asksForWeb = /\b(search|look up|lookup|find online|research|google|web search|latest|current|today|news)\b/.test(normalized);
  if (!asksForWeb) return false;
  const localSearch = /\b(file|files|codebase|repo|repository|workspace|folder|directory|project|terminal|grep)\b/.test(normalized);
  return !localSearch;
}

export const agentModelService = new AgentModelService();
