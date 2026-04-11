export type AgentMode = 'unrestricted-dev' | 'guarded' | 'production';

export type AgentRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type AgentToolStatus = 'running' | 'completed' | 'failed';

export type AgentToolName =
  | 'browser.get_state'
  | 'browser.get_tabs'
  | 'browser.navigate'
  | 'browser.search_web'
  | 'browser.research_search'
  | 'browser.back'
  | 'browser.forward'
  | 'browser.reload'
  | 'browser.create_tab'
  | 'browser.close_tab'
  | 'browser.activate_tab'
  | 'browser.click'
  | 'browser.type'
  | 'browser.extract_page'
  | 'browser.inspect_page'
  | 'browser.find_element'
  | 'browser.click_text'
  | 'browser.wait_for'
  | 'browser.summarize_page'
  | 'browser.evaluate_js'
  | 'browser.run_intent_program'
  | 'browser.cache_current_page'
  | 'browser.answer_from_cache'
  | 'browser.search_page_cache'
  | 'browser.read_cached_chunk'
  | 'browser.list_cached_pages'
  | 'browser.list_cached_sections'
  | 'browser.cache_stats'
  | 'browser.get_actionable_elements'
  | 'browser.capture_snapshot'
  | 'filesystem.list'
  | 'filesystem.search'
  | 'filesystem.index_workspace'
  | 'filesystem.answer_from_cache'
  | 'filesystem.search_file_cache'
  | 'filesystem.read_file_chunk'
  | 'filesystem.list_cached_files'
  | 'filesystem.file_cache_stats'
  | 'filesystem.read'
  | 'filesystem.write'
  | 'filesystem.patch'
  | 'filesystem.delete'
  | 'filesystem.mkdir'
  | 'filesystem.move'
  | 'terminal.exec'
  | 'terminal.spawn'
  | 'terminal.write'
  | 'terminal.kill'
  | 'chat.thread_summary'
  | 'chat.read_last'
  | 'chat.search'
  | 'chat.read_message'
  | 'chat.read_window'
  | 'chat.recall'
  | 'chat.cache_stats'
  | 'subagent.spawn'
  | 'subagent.message'
  | 'subagent.wait'
  | 'subagent.cancel'
  | 'subagent.list';

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

export type AgentToolDefinition<TInput = unknown> = {
  name: AgentToolName;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: TInput, context: AgentToolContext) => Promise<AgentToolResult>;
};

export type AgentRuntimeConfig = {
  mode: AgentMode;
  agentId: string;
  role: string;
  task: string;
  taskId?: string;
  contextPrompt?: string | null;
  parentRunId?: string | null;
  depth?: number;
  skillNames?: string[];
  allowedTools?: 'all' | AgentToolName[];
  canSpawnSubagents?: boolean;
  maxToolTurns?: number;
  onToken?: (text: string) => void;
};

export type AgentProviderRequest = {
  runId: string;
  agentId: string;
  mode: AgentMode;
  taskId?: string;
  systemPrompt: string;
  task: string;
  contextPrompt?: string | null;
  maxToolTurns?: number;
  tools: Array<Pick<AgentToolDefinition, 'name' | 'description' | 'inputSchema'>>;
  onToken?: (text: string) => void;
};

export type AgentProviderResult = {
  output: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
  };
};

export interface AgentProvider {
  invoke(request: AgentProviderRequest): Promise<AgentProviderResult>;
}
