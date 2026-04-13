import { chatKnowledgeStore } from '../chatKnowledge/ChatKnowledgeStore';
import type { AnyProviderId, CodexItem } from '../../shared/types/model';
import { agentToolExecutor } from './AgentToolExecutor';
import { formatValidationForModel } from './ConstraintValidator';
import type { AgentProviderRequest, AgentToolName, AgentToolResult } from './AgentTypes';
import { resolveRequestedToolPack } from './toolPacks';

export const DEFAULT_PROVIDER_MAX_TOOL_TURNS = 20;
export const MAX_PROVIDER_TOOL_TURNS = 40;

const MAX_TOOL_RESULT_CHARS = 8_000;
const MAX_TOOL_MEMORY_CHARS = 50_000;
const DEFAULT_PROVIDER_EMPTY_RESPONSE = 'The run ended without a text response. Please retry the task; no final answer was produced.';

type ProviderToolCallItem = Extract<CodexItem, { type: 'mcp_tool_call' }>;

type ExecuteProviderToolCallInput = {
  providerId: AnyProviderId;
  request: Pick<AgentProviderRequest, 'runId' | 'agentId' | 'mode' | 'taskId'>;
  toolName: AgentToolName;
  toolInput: unknown;
};

type ProviderToolCallSuccess = {
  ok: true;
  result: AgentToolResult;
  resultDescription: string;
  toolContent: string;
};

type ProviderToolCallFailure = {
  ok: false;
  errorMessage: string;
};

export type ProviderToolCallExecution = ProviderToolCallSuccess | ProviderToolCallFailure;

type ExecuteProviderToolCallWithEventsInput = ExecuteProviderToolCallInput & {
  itemId: string;
  request: AgentProviderRequest;
};

type ProviderToolCallWithEventsBase = {
  callDescription: string;
  startedItem: ProviderToolCallItem;
  completedItem: ProviderToolCallItem;
};

export type ProviderToolCallWithEventsExecution =
  | (ProviderToolCallSuccess & ProviderToolCallWithEventsBase)
  | (ProviderToolCallFailure & ProviderToolCallWithEventsBase);

export function normalizeProviderMaxToolTurns(requestedTurns?: number): number {
  return Math.min(
    Math.max(Math.floor(requestedTurns ?? DEFAULT_PROVIDER_MAX_TOOL_TURNS), 1),
    MAX_PROVIDER_TOOL_TURNS,
  );
}

export function describeProviderToolCall(toolName: string, input: unknown): string {
  const args = (input && typeof input === 'object') ? input as Record<string, unknown> : {};
  switch (toolName) {
    case 'browser.navigate': return `Browser: navigate ${args.url || 'page'}`;
    case 'browser.search_web': return `Browser: search "${args.query || ''}"`;
    case 'browser.research_search': return `Browser: research "${args.query || ''}"`;
    case 'browser.click': return `Browser: click ${args.selector || args.text || 'element'}`;
    case 'browser.type': return `Browser: type ${args.selector || 'field'}`;
    case 'browser.back': return 'Browser: back';
    case 'browser.forward': return 'Browser: forward';
    case 'browser.reload': return 'Browser: reload';
    case 'browser.extract_page': return 'Browser: extract page';
    case 'browser.get_state': return 'Browser: get state';
    case 'browser.get_tabs': return 'Browser: list tabs';
    case 'browser.create_tab': return `Browser: create tab ${args.url ? `(${args.url})` : ''}`.trim();
    case 'browser.close_tab': return 'Browser: close tab';
    case 'browser.activate_tab': return 'Browser: activate tab';
    case 'browser.hover': return `Browser: hover ${args.selector || 'element'}`;
    case 'browser.drag': return 'Browser: drag';
    case 'browser.hit_test': return `Browser: hit test ${args.selector || 'target'}`;
    case 'browser.evaluate_js': return 'Browser: evaluate js';
    case 'browser.run_intent_program': return 'Browser: run intent program';
    case 'browser.find_element': return `Browser: find ${args.selector || args.text || 'element'}`;
    case 'browser.click_text': return `Browser: click text "${args.text || ''}"`;
    case 'browser.wait_for': return `Browser: wait for ${args.selector || 'condition'}`;
    case 'browser.summarize_page': return 'Browser: summarize page';
    case 'browser.inspect_page': return 'Browser: inspect page';
    case 'browser.upload_file': return `Browser: upload ${args.path || 'file'}`;
    case 'browser.download_link': return `Browser: download link ${args.url || ''}`.trim();
    case 'browser.download_url': return `Browser: download ${args.url || 'file'}`;
    case 'browser.get_downloads': return 'Browser: get downloads';
    case 'browser.wait_for_download': return 'Browser: wait for download';
    case 'browser.get_console_events': return 'Browser: read console';
    case 'browser.get_network_events': return 'Browser: read network';
    case 'browser.get_dialogs': return 'Browser: get dialogs';
    case 'browser.accept_dialog': return 'Browser: accept dialog';
    case 'browser.dismiss_dialog': return 'Browser: dismiss dialog';
    case 'browser.cache_current_page': return 'Browser: cache page';
    case 'browser.answer_from_cache': return `Browser cache: answer "${args.question || args.query || ''}"`;
    case 'browser.search_page_cache': return `Browser cache: search "${args.query || ''}"`;
    case 'browser.read_cached_chunk': return `Browser cache: read chunk ${args.chunkId || args.id || ''}`.trim();
    case 'browser.list_cached_pages': return 'Browser cache: list pages';
    case 'browser.list_cached_sections': return 'Browser cache: list sections';
    case 'browser.cache_stats': return 'Browser cache: stats';
    case 'browser.get_actionable_elements': return 'Browser: actionable elements';
    case 'browser.capture_snapshot': return 'Browser: snapshot';
    case 'filesystem.list': return `Files: list ${args.path || 'directory'}`;
    case 'filesystem.search': return `Files: search "${args.query || args.pattern || ''}"`;
    case 'filesystem.read': return `Files: read ${args.path || 'file'}`;
    case 'filesystem.write': return `Files: write ${args.path || 'file'}`;
    case 'filesystem.patch': return `Files: patch ${args.path || 'file'}`;
    case 'filesystem.delete': return `Files: delete ${args.path || 'file'}`;
    case 'filesystem.mkdir': return `Files: mkdir ${args.path || ''}`.trim();
    case 'filesystem.move': return `Files: move ${args.from || 'file'} -> ${args.to || 'destination'}`;
    case 'filesystem.index_workspace': return 'Files: index workspace';
    case 'filesystem.answer_from_cache': return `File cache: answer "${args.question || args.query || ''}"`;
    case 'filesystem.search_file_cache': return `File cache: search "${args.query || ''}"`;
    case 'filesystem.read_file_chunk': return `File cache: read chunk ${args.chunkId || args.id || ''}`.trim();
    case 'filesystem.list_cached_files': return 'File cache: list files';
    case 'filesystem.file_cache_stats': return 'File cache: stats';
    case 'terminal.exec': return `Terminal: run ${args.command || 'command'}`;
    case 'terminal.spawn': return `Terminal: spawn ${args.command || 'process'}`;
    case 'terminal.write': return 'Terminal: write';
    case 'terminal.kill': return 'Terminal: kill';
    case 'subagent.spawn': return `Subagent: spawn ${args.role || args.task || 'worker'}`;
    case 'subagent.message': return 'Subagent: message';
    case 'subagent.wait': return 'Subagent: wait';
    case 'subagent.cancel': return 'Subagent: cancel';
    case 'subagent.list': return 'Subagent: list';
    case 'runtime.request_tool_pack': return `Runtime: load tool pack ${args.pack || ''}`.trim();
    case 'runtime.list_tool_packs': return 'Runtime: list tool packs';
    default: {
      const short = toolName.replace(/^(browser|filesystem|terminal|subagent|chat)\./, '');
      return short.replace(/_/g, ' ');
    }
  }
}

export function resolveToolPackExpansion(
  request: Pick<AgentProviderRequest, 'toolCatalog'>,
  toolName: AgentToolName,
  result: AgentToolResult,
): { pack: string; description: string; tools: AgentToolName[]; scope: 'named' | 'all'; relatedPackIds: string[] } | null {
  if (toolName !== 'runtime.request_tool_pack') return null;
  const pack = typeof result.data.pack === 'string' ? result.data.pack : null;
  if (!pack || !request.toolCatalog?.length) return null;
  return resolveRequestedToolPack(pack, request.toolCatalog);
}

export function encodeToolInput(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function normalizeProviderFinalOutput(text: string): string {
  return text.trim()
    ? text
    : DEFAULT_PROVIDER_EMPTY_RESPONSE;
}

export function publishProviderFinalOutput(input: {
  request: Pick<AgentProviderRequest, 'onItem' | 'onToken'>;
  itemId: string;
  text: string;
  emitToken?: boolean;
}): Extract<CodexItem, { type: 'agent_message' }> {
  const item: Extract<CodexItem, { type: 'agent_message' }> = {
    id: input.itemId,
    type: 'agent_message',
    text: normalizeProviderFinalOutput(input.text),
  };

  input.request.onItem?.({ item, eventType: 'item.completed' });
  if (input.emitToken !== false) {
    input.request.onToken?.(item.text);
  }
  return item;
}

export async function executeProviderToolCall(
  input: ExecuteProviderToolCallInput,
): Promise<ProviderToolCallExecution> {
  try {
    const result = await agentToolExecutor.execute(input.toolName, input.toolInput, {
      runId: input.request.runId,
      agentId: input.request.agentId,
      mode: input.request.mode,
      taskId: input.request.taskId,
    });

    recordToolMemory(input, { result });

    return {
      ok: true,
      result,
      resultDescription: describeProviderToolResult(result, false),
      toolContent: formatToolResultForModel(result),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    recordToolMemory(input, { error: errorMessage });
    return {
      ok: false,
      errorMessage,
    };
  }
}

export async function executeProviderToolCallWithEvents(
  input: ExecuteProviderToolCallWithEventsInput,
): Promise<ProviderToolCallWithEventsExecution> {
  const callDescription = describeProviderToolCall(input.toolName, input.toolInput);
  input.request.onStatus?.(`tool-start:${callDescription}`);

  const startedItem = createProviderToolCallItem(input.itemId, input.toolName, input.toolInput);
  input.request.onItem?.({ item: startedItem, eventType: 'item.started' });

  const execution = await executeProviderToolCall(input);

  if (execution.ok) {
    input.request.onStatus?.(`tool-done:${callDescription} -> ${execution.resultDescription}`);
    const completedItem = {
      ...startedItem,
      result: execution.result,
      status: 'completed',
    } satisfies ProviderToolCallItem;
    input.request.onItem?.({ item: completedItem, eventType: 'item.completed' });
    return {
      ...execution,
      callDescription,
      startedItem,
      completedItem,
    };
  }

  input.request.onStatus?.(`tool-done:${callDescription} -> error: ${execution.errorMessage.slice(0, 80)}`);
  const completedItem = {
    ...startedItem,
    error: { message: execution.errorMessage },
    status: 'failed',
  } satisfies ProviderToolCallItem;
  input.request.onItem?.({ item: completedItem, eventType: 'item.completed' });
  return {
    ...execution,
    callDescription,
    startedItem,
    completedItem,
  };
}

function recordToolMemory(
  input: ExecuteProviderToolCallInput,
  outcome: { result?: unknown; error?: string },
): void {
  if (!input.request.taskId || input.toolName.startsWith('chat.')) return;
  chatKnowledgeStore.recordToolMessage(
    input.request.taskId,
    serializeToolMemory({
      toolName: input.toolName,
      toolInput: input.toolInput,
      result: outcome.result,
      error: outcome.error,
    }),
    input.providerId,
    input.request.runId,
  );
}

function createProviderToolCallItem(
  itemId: string,
  toolName: AgentToolName,
  toolInput: unknown,
): ProviderToolCallItem {
  return {
    id: itemId,
    type: 'mcp_tool_call',
    server: 'v2',
    tool: toolName,
    arguments: (toolInput && typeof toolInput === 'object') ? toolInput as Record<string, unknown> : {},
    result: null,
    error: null,
    status: 'in_progress',
  };
}

function formatToolResultForModel(result: AgentToolResult): string {
  let toolContent = compactToolResult(result);
  if (result.validation) {
    toolContent += formatValidationForModel(result.validation);
  }
  return toolContent;
}

function compactToolResult(result: unknown): string {
  const text = typeof result === 'string' ? result : JSON.stringify(result, null, 0);
  if (!text) return '';
  return text.length > MAX_TOOL_RESULT_CHARS
    ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n...[tool result truncated]`
    : text;
}

function serializeToolMemory(input: {
  toolName: AgentToolName;
  toolInput: unknown;
  result?: unknown;
  error?: string;
}): string {
  const payload = {
    tool: input.toolName,
    input: input.toolInput,
    result: input.result,
    error: input.error,
  };
  const text = JSON.stringify(payload, null, 2);
  return text.length > MAX_TOOL_MEMORY_CHARS
    ? `${text.slice(0, MAX_TOOL_MEMORY_CHARS)}\n...[tool memory truncated]`
    : text;
}

function describeProviderToolResult(result: unknown, isError: boolean): string {
  if (isError) {
    const msg = typeof result === 'string' ? result : '';
    return msg.length > 80 ? `error: ${msg.slice(0, 77)}...` : `error: ${msg || 'failed'}`;
  }
  const data = (result && typeof result === 'object') ? result as Record<string, unknown> : {};
  const summary = typeof data.summary === 'string' ? data.summary : null;
  if (summary) {
    return summary.length > 80 ? `${summary.slice(0, 77)}...` : summary;
  }
  return 'done';
}
