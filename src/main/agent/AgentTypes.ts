import type { CodexItem, InvocationAttachment } from '../../shared/types/model';

export type AgentMode = 'unrestricted-dev' | 'guarded' | 'production';

export type AgentRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type AgentToolStatus = 'running' | 'completed' | 'failed';

export type AgentToolName =
  | 'attachments.list'
  | 'attachments.search'
  | 'attachments.read_chunk'
  | 'attachments.read_document'
  | 'attachments.stats'
  | 'browser.navigate'
  | 'browser.research_search'
  | 'browser.back'
  | 'browser.forward'
  | 'browser.reload'
  | 'browser.create_tab'
  | 'browser.close_tab'
  | 'browser.activate_tab'
  | 'browser.click'
  | 'browser.type'
  | 'browser.get_element_state'
  | 'browser.select_option'
  | 'browser.upload_file'
  | 'browser.download'
  | 'browser.get_downloads'
  | 'browser.wait_for_download'
  | 'browser.drag'
  | 'browser.hover'
  | 'browser.extract_page'
  | 'browser.inspect_page'
  | 'browser.find_element'
  | 'browser.wait_for'
  | 'browser.summarize_page'
  | 'browser.evaluate_js'
  | 'browser.run_intent_program'
  | 'browser.get_console_events'
  | 'browser.get_network_events'
  | 'browser.cache_current_page'
  | 'browser.search_page_cache'
  | 'browser.read_cached_chunk'
  | 'browser.cache_inventory'
  | 'browser.record_finding'
  | 'browser.pin_page'
  | 'filesystem.list'
  | 'filesystem.glob'
  | 'filesystem.search'
  | 'filesystem.index_workspace'
  | 'filesystem.search_file_cache'
  | 'filesystem.read_file_chunk'
  | 'filesystem.cache_inventory'
  | 'filesystem.read'
  | 'filesystem.write'
  | 'filesystem.patch'
  | 'filesystem.delete'
  | 'filesystem.move'
  | 'terminal.exec'
  | 'terminal.spawn'
  | 'terminal.write'
  | 'terminal.kill'
  | 'terminal.status'
  | 'session.resume_previous'
  | 'subagent.spawn'
  | 'context.load'
  | 'repomap.overview'
  | 'repomap.find_symbol'
  | 'repomap.describe_file'
  | 'repomap.neighbors'
  | 'repomap.refresh'
  | 'workspace.locate'
  | 'workspace.tree'
  | 'workspace.overview'
  | 'workspace.refresh';

export type AgentRunRecord = {
  id: string;
  parentRunId: string | null;
  depth: number;
  role: string;
  task: string;
  mode: AgentMode;
  status: AgentRunStatus;
  startedAt: number;
  completedAt: number | null;
  resultSummary: string | null;
  error: string | null;
};

export type AgentToolCallRecord = {
  id: string;
  runId: string;
  agentId: string;
  toolName: AgentToolName;
  input: unknown;
  output: unknown;
  status: AgentToolStatus;
  startedAt: number;
  completedAt: number | null;
  error: string | null;
};

export type AgentSkill = {
  name: string;
  path: string;
  body: string;
};

export type AgentToolContext = {
  runId: string;
  agentId: string;
  mode: AgentMode;
  taskId?: string;
  contextId?: string;
  toolNames?: string[];
  onProgress?: (status: string) => void;
  toolScope?: AgentToolScopeState;
};

export type ConstraintStatus = 'PASS' | 'FAIL' | 'UNKNOWN' | 'ESTIMATED' | 'CONDITIONAL';

export type ConstraintVerdict = {
  name: string;
  status: ConstraintStatus;
  observed: string;
  expected?: string;
};

export type ValidationStatus = 'VALID' | 'INVALID' | 'INCOMPLETE';

export type ResultValidation = {
  status: ValidationStatus;
  constraints: ConstraintVerdict[];
  summary: string;
};

export type AgentToolResult = {
  summary: string;
  data: Record<string, unknown>;
  validation?: ResultValidation;
};

export type AgentToolSchemaSummary = {
  name: AgentToolName;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type AgentToolScopeState = {
  activeTools: AgentToolSchemaSummary[];
};

export type AgentToolDefinition<TInput = unknown> = {
  name: AgentToolName;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: TInput, context: AgentToolContext) => Promise<AgentToolResult>;
};

/**
 * Prior user/assistant turns for in-chat continuity.
 *
 * Providers that support real multi-turn chat (Haiku/Anthropic, Gemini) should
 * prepend these as real role-tagged messages before the current user turn so
 * the model sees actual chat history instead of an in-context Markdown recap.
 * Providers with server-side thread state (Codex app-server) can ignore this
 * field — their `thread/resume` path already carries history.
 */
export type AgentPriorTurn = {
  role: 'user' | 'assistant';
  content: string;
};

export type AgentRuntimeConfig = {
  mode: AgentMode;
  agentId: string;
  role: string;
  task: string;
  taskId?: string;
  cwd?: string | null;
  contextPrompt?: string | null;
  priorTurns?: AgentPriorTurn[];
  systemPromptAddendum?: string | null;
  parentRunId?: string | null;
  depth?: number;
  skillNames?: string[];
  allowedTools?: 'all' | AgentToolName[];
  canSpawnSubagents?: boolean;
  maxToolTurns?: number;
  maxTokensOverride?: number;
  attachments?: InvocationAttachment[];
  onToken?: (text: string) => void;
  onStatus?: (status: string) => void;
  onItem?: (event: { item: CodexItem; eventType: 'item.started' | 'item.completed' }) => void;
};

export type AgentProviderRequest = {
  runId: string;
  agentId: string;
  mode: AgentMode;
  taskId?: string;
  systemPrompt: string;
  task: string;
  contextPrompt?: string | null;
  priorTurns?: AgentPriorTurn[];
  maxToolTurns?: number;
  maxTokensOverride?: number;
  toolScope: AgentToolScopeState;
  tools: AgentToolSchemaSummary[];
  attachments?: InvocationAttachment[];
  onToken?: (text: string) => void;
  onStatus?: (status: string) => void;
  onItem?: (event: { item: CodexItem; eventType: 'item.started' | 'item.completed' }) => void;
};

export type AgentProviderResult = {
  runId?: string;
  output: string;
  codexItems?: CodexItem[];
  completion?: {
    completed: boolean;
    reason?: 'max_tokens' | 'budget_exhausted' | 'stalled' | 'unknown';
    canContinue?: boolean;
  };
  usage?: {
    inputTokens: number;
    /** Provider-reported cache-read tokens (billed at discounted rate). */
    cachedInputTokens?: number;
    /** Anthropic-only: tokens written into the ephemeral cache on this call. */
    cacheCreationInputTokens?: number;
    outputTokens: number;
    durationMs: number;
  };
};

export interface AgentProvider {
  /**
   * Stable identifier for the underlying provider runtime. Optional on the
   * interface for backwards compatibility with older provider adapters, but
   * modern providers (`codex`, `haiku`, `gemini`, `app-server-backed`) all
   * expose it so consumers like sub-agent token accounting can attribute
   * usage correctly.
   */
  readonly providerId?: string;
  supportsAppToolExecutor?: boolean;
  invoke(request: AgentProviderRequest): Promise<AgentProviderResult>;
  abort?(): void;
  /**
   * Returns whatever usage has been accumulated during the current (or most
   * recent) `invoke()` call. Used on the failure/cancellation path so burned
   * tokens are still reported in the footer and per-task counters instead of
   * silently dropped. Return `null` when nothing was accumulated yet.
   */
  getPartialUsage?(): AgentProviderResult['usage'] | null;
}

export const PARTIAL_USAGE_ERROR_KEY = '__agentPartialUsage';
