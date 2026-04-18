import { chatKnowledgeStore } from '../chatKnowledge/ChatKnowledgeStore';
import type { AnyProviderId, CodexItem } from '../../shared/types/model';
import { agentToolExecutor } from './AgentToolExecutor';
import { formatValidationForModel } from './ConstraintValidator';
import type { AgentProviderRequest, AgentToolName, AgentToolResult } from './AgentTypes';
import { resolveAutoExpandedToolPack, resolveRequestedToolPack } from './toolPacks';
import type { AgentToolBindingStore } from './toolBindingScope';
import { listCallableRequestTools } from './toolBindingScope';
import path from 'path';

export const DEFAULT_PROVIDER_MAX_TOOL_TURNS = 20;
export const MAX_PROVIDER_TOOL_TURNS = 40;

const MAX_TOOL_RESULT_CHARS = 8_000;
const MAX_TOOL_MEMORY_CHARS = 50_000;
const DEFAULT_PROVIDER_EMPTY_RESPONSE = 'The run ended without a text response. Please retry the task; no final answer was produced.';

type ProviderToolCallItem = Extract<CodexItem, { type: 'mcp_tool_call' }>;

type ExecuteProviderToolCallInput = {
  providerId: AnyProviderId;
  request: Pick<AgentProviderRequest, 'runId' | 'agentId' | 'mode' | 'taskId' | 'onStatus' | 'promptTools' | 'toolCatalog' | 'toolBindings'>;
  toolName: AgentToolName;
  toolInput: unknown;
  currentTools?: AgentProviderRequest['promptTools'];
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
    case 'artifact.list': return 'Artifacts: list';
    case 'artifact.get': return `Artifacts: get ${args.artifactId || 'active artifact'}`;
    case 'artifact.get_active': return 'Artifacts: get active';
    case 'artifact.read': return `Artifacts: read ${args.artifactId || 'active artifact'}`;
    case 'artifact.create': return `Artifacts: create ${args.title || 'artifact'}`;
    case 'artifact.delete': return `Artifacts: delete ${args.artifactId || 'artifact'}`;
    case 'artifact.replace_content': return `Artifacts: replace ${args.artifactId || 'active artifact'}`;
    case 'artifact.append_content': return `Artifacts: append ${args.artifactId || 'active artifact'}`;
    case 'runtime.search_tools': return `Runtime: search tools "${args.query || ''}"`;
    case 'runtime.require_tools': return 'Runtime: require exact tools';
    case 'runtime.invoke_tool': return `Runtime: invoke ${args.tool || args.name || 'tool'}`;
    case 'runtime.request_tool_pack': return `Runtime: request pack ${args.pack || ''}`.trim();
    case 'runtime.list_tool_packs': return 'Runtime: list tool packs';
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
    case 'browser.evaluate_js': return 'Browser: unsafe js eval';
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
    case 'subagent.wait': return 'Subagent: wait';
    case 'subagent.cancel': return 'Subagent: cancel';
    case 'subagent.list': return 'Subagent: list';
    case 'runtime.request_tool_pack': return `Runtime: load tool pack ${args.pack || ''}`.trim();
    case 'runtime.list_tool_packs': return 'Runtime: list tool packs';
    case 'runtime.search_tools': return `Runtime: search tools "${args.query || ''}"`.trim();
    default: {
      const short = toolName.replace(/^(browser|filesystem|terminal|subagent|chat)\./, '');
      return short.replace(/_/g, ' ');
    }
  }
}

export function resolveRuntimeToolExpansion(
  request: Pick<AgentProviderRequest, 'toolCatalog'>,
  currentTools: AgentProviderRequest['promptTools'],
  toolName: AgentToolName,
  result: AgentToolResult,
): { pack: string; description: string; tools: AgentToolName[]; scope: 'named' | 'all'; relatedPackIds: string[] } | null {
  const currentToolNames = new Set(currentTools.map((tool) => tool.name));

  if (toolName === 'runtime.request_tool_pack') {
    const pack = typeof result.data.pack === 'string' ? result.data.pack : null;
    if (!pack) return null;
    const expansion = resolveRequestedToolPack(pack, request.toolCatalog);
    if (!expansion) return null;
    if (expansion.scope !== 'all' && !expansion.tools.some((name) => !currentToolNames.has(name))) {
      return null;
    }
    return expansion;
  }

  if (toolName !== 'runtime.search_tools') return null;
  const resultTools = Array.isArray(result.data.tools) ? result.data.tools : [];
  const catalogNames = new Set(request.toolCatalog.map((tool) => tool.name));
  const matched = resultTools
    .filter((name): name is AgentToolName => typeof name === 'string' && catalogNames.has(name as AgentToolName));

  const newMatches = matched.filter((name) => !currentToolNames.has(name));
  if (newMatches.length === 0) return null;

  return {
    pack: 'tool-search',
    description: `Loaded ${newMatches.length} searched tools`,
    tools: newMatches,
    scope: 'named',
    relatedPackIds: [],
  };
}

export function applyRuntimeToolExpansion(input: {
  request: Pick<AgentProviderRequest, 'toolCatalog'>;
  toolBindingStore: Pick<AgentToolBindingStore, 'getCallableTools' | 'queueTools'>;
  toolName: AgentToolName;
  result: AgentToolResult;
}): { pack: string; description: string; tools: AgentToolName[]; scope: 'named' | 'all'; relatedPackIds: string[] } | null {
  const expansion = resolveRuntimeToolExpansion(
    input.request,
    input.toolBindingStore.getCallableTools(),
    input.toolName,
    input.result,
  );
  if (!expansion) return null;
  input.toolBindingStore.queueTools(expansion.tools);
  return expansion;
}

export function applyAutoExpandedToolPack(input: {
  message: string;
  toolCatalog: AgentProviderRequest['toolCatalog'];
  toolBindingStore: Pick<AgentToolBindingStore, 'getCallableTools' | 'queueTools'>;
}): { pack: string; reason: string; description: string; tools: AgentToolName[]; scope: 'named' | 'all'; relatedPackIds: string[] } | null {
  const expansion = resolveAutoExpandedToolPack(
    input.message,
    input.toolBindingStore.getCallableTools(),
    input.toolCatalog,
  );
  if (!expansion) return null;
  input.toolBindingStore.queueTools(expansion.tools);
  return expansion;
}

function expansionToolNames(
  expansion: { scope: 'named' | 'all'; tools: AgentToolName[] },
): string[] {
  return expansion.scope === 'all'
    ? ['all eligible tools']
    : expansion.tools;
}

export function formatQueuedExpansionLines(
  expansion: { pack: string; description: string; scope: 'named' | 'all'; tools: AgentToolName[] },
  options?: { style?: 'codex' | 'haiku' },
): string[] {
  const expandedToolNames = expansionToolNames(expansion);
  const headline = (options?.style ?? 'codex') === 'haiku'
    ? (expansion.pack === 'tool-search'
      ? 'Queued searched tools for the next turn.'
      : `Queued tool pack "${expansion.pack}" for the next turn.`)
    : (expansion.pack === 'tool-search'
      ? 'Result: queued searched tools for the next turn'
      : `Result: queued tool pack "${expansion.pack}" for the next turn`);

  return [
    headline,
    `Description: ${expansion.description}`,
    `Expanded tools: ${expandedToolNames.join(', ')}`,
    'Callable now: none newly added in this turn',
    `Callable next turn: ${expandedToolNames.join(', ')}`,
  ];
}

export function formatAutoExpandedToolPackLines(
  expansion: { pack: string; reason: string; description: string; scope: 'named' | 'all'; tools: AgentToolName[] },
  options?: { includeCallableStatus?: boolean; continueInstruction?: boolean },
): string[] {
  const expandedToolNames = expansionToolNames(expansion);
  const lines = [
    `Host auto-expanded tool pack "${expansion.pack}".`,
    `Reason: ${expansion.reason}`,
    `Description: ${expansion.description}`,
    `Expanded tools: ${expandedToolNames.join(', ')}`,
  ];

  if (options?.includeCallableStatus) {
    lines.push(
      'Callable now: none newly added in this turn',
      `Callable next turn: ${expandedToolNames.join(', ')}`,
    );
  }

  if (options?.continueInstruction) {
    lines.push('Continue with the expanded tool scope instead of stopping if more work is still needed.');
  }

  return lines;
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
    const currentTools = input.currentTools ?? listCallableRequestTools(input.request);
    const toolCatalog = input.request.toolCatalog;
    const result = await agentToolExecutor.execute(input.toolName, input.toolInput, {
      runId: input.request.runId,
      agentId: input.request.agentId,
      mode: input.request.mode,
      taskId: input.request.taskId,
      toolNames: currentTools.map((tool) => tool.name),
      toolCatalog,
      onProgress: input.request.onStatus,
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
  const payload = (result && typeof result === 'object') ? result as Record<string, unknown> : {};
  const summary = typeof payload.summary === 'string' ? payload.summary : null;
  const data = (payload.data && typeof payload.data === 'object')
    ? payload.data as Record<string, unknown>
    : {};
  const enriched = enrichToolSummary(summary, data);
  if (enriched) {
    return enriched.length > 120 ? `${enriched.slice(0, 117)}...` : enriched;
  }
  return 'done';
}

function enrichToolSummary(summary: string | null, data: Record<string, unknown>): string | null {
  if (Array.isArray(data.entries)) {
    const preview = data.entries
      .slice(0, 3)
      .map((entry) => {
        if (entry && typeof entry === 'object' && typeof (entry as { name?: unknown }).name === 'string') {
          return (entry as { name: string }).name;
        }
        return null;
      })
      .filter((value): value is string => Boolean(value));
    if (preview.length > 0) {
      return `${summary ?? `Listed ${data.entries.length} entries`} (${preview.join(', ')}${data.entries.length > preview.length ? ', ...' : ''})`;
    }
  }

  if (Array.isArray(data.matches)) {
    const preview = data.matches
      .slice(0, 3)
      .map((match) => {
        if (match && typeof match === 'object' && typeof (match as { path?: unknown }).path === 'string') {
          return path.basename((match as { path: string }).path);
        }
        return null;
      })
      .filter((value): value is string => Boolean(value));
    if (preview.length > 0) {
      return `${summary ?? `Found ${data.matches.length} matches`} (${preview.join(', ')}${data.matches.length > preview.length ? ', ...' : ''})`;
    }
  }

  if (Array.isArray(data.openedPages)) {
    const preview = data.openedPages
      .slice(0, 2)
      .map((pageEntry) => previewTitleOrUrl(pageEntry))
      .filter((value): value is string => Boolean(value));
    if (preview.length > 0) {
      return `${summary ?? `Opened ${data.openedPages.length} pages`} (${preview.join(', ')}${data.openedPages.length > preview.length ? ', ...' : ''})`;
    }
  }

  if (Array.isArray(data.searchResults)) {
    const preview = data.searchResults
      .slice(0, 2)
      .map((resultEntry) => previewTitleOrUrl(resultEntry))
      .filter((value): value is string => Boolean(value));
    if (preview.length > 0) {
      return `${summary ?? `Found ${data.searchResults.length} search results`} (${preview.join(', ')}${data.searchResults.length > preview.length ? ', ...' : ''})`;
    }
  }

  if (Array.isArray(data.tabs)) {
    const preview = data.tabs
      .slice(0, 3)
      .map((tab) => previewTitleOrUrl(tab))
      .filter((value): value is string => Boolean(value));
    if (preview.length > 0) {
      return `${summary ?? `Read ${data.tabs.length} tabs`} (${preview.join(', ')}${data.tabs.length > preview.length ? ', ...' : ''})`;
    }
  }

  if (Array.isArray(data.pages)) {
    const preview = data.pages
      .slice(0, 2)
      .map((pageEntry) => previewTitleOrUrl(pageEntry))
      .filter((value): value is string => Boolean(value));
    if (preview.length > 0) {
      return `${summary ?? `Listed ${data.pages.length} cached pages`} (${preview.join(', ')}${data.pages.length > preview.length ? ', ...' : ''})`;
    }
  }

  if (data.page && typeof data.page === 'object') {
    const preview = previewTitleOrUrl(data.page);
    if (preview) {
      return `${summary ?? 'Read browser page'} (${preview})`;
    }
  }

  if (data.metadata && typeof data.metadata === 'object') {
    const preview = previewTitleOrUrl(data.metadata);
    if (preview) {
      return `${summary ?? 'Read browser metadata'} (${preview})`;
    }
  }

  if (typeof data.exitCode === 'number') {
    const outputSnippet = terminalOutputSnippet(typeof data.output === 'string' ? data.output : '');
    if (outputSnippet) {
      return `exit ${data.exitCode}: ${outputSnippet}`;
    }
    return summary;
  }

  return summary;
}

function terminalOutputSnippet(output: string): string | null {
  for (const rawLine of output.split('\n')) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    return line.length > 72 ? `${line.slice(0, 69)}...` : line;
  }
  return null;
}

function previewTitleOrUrl(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const title = typeof (value as { title?: unknown }).title === 'string' ? (value as { title: string }).title.trim() : '';
  const name = typeof (value as { name?: unknown }).name === 'string' ? (value as { name: string }).name.trim() : '';
  const url = typeof (value as { url?: unknown }).url === 'string' ? (value as { url: string }).url.trim() : '';
  const text = title || name || url;
  if (!text) return null;
  return text.length > 48 ? `${text.slice(0, 45)}...` : text;
}
