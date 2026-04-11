// ═══════════════════════════════════════════════════════════════════════════
// Model Layer Types — Provider registry, routing, handoff, Codex events
// ═══════════════════════════════════════════════════════════════════════════

// ─── Provider Identity ────────────────────────────────────────────────────

export type ProviderId = 'codex' | 'haiku' | 'sonnet';

export type ProviderKind = 'cli-process' | 'api-streaming';

export type ProviderStatus = 'available' | 'unavailable' | 'busy' | 'error';

export type ProviderCapability =
  | 'code-generation'
  | 'code-editing'
  | 'shell-execution'
  | 'repo-analysis'
  | 'chat'
  | 'summarization'
  | 'intent-parsing'
  | 'plan'
  | 'planning'
  | 'synthesis';

// ─── Provider Definition (static, configured at startup) ──────────────────

export type ProviderDefinition = {
  id: ProviderId;
  displayName: string;
  kind: ProviderKind;
  capabilities: ProviderCapability[];
};

// ─── Provider Metrics (from Codex /status) ────────────────────────────────

export type CodexStatusMetrics = {
  contextWindow?: { percentLeft: number; used: string; total: string };
  limit5h?: { percentLeft: number; resetsAt: string };
  limitWeekly?: { percentLeft: number; resetsAt: string };
  credits?: number;
};

// ─── Provider Runtime (dynamic, changes per-request) ──────────────────────

export type ProviderRuntime = {
  id: ProviderId;
  status: ProviderStatus;
  activeTaskId: string | null;
  lastActivityAt: number | null;
  errorDetail: string | null;
  sessionId?: string;
  model?: string;
  metrics?: CodexStatusMetrics;
};

export function createDefaultProviderRuntime(id: ProviderId): ProviderRuntime {
  return {
    id,
    status: 'unavailable',
    activeTaskId: null,
    lastActivityAt: null,
    errorDetail: null,
  };
}

// ─── Task Ownership ───────────────────────────────────────────────────────

export type ModelOwner = ProviderId | 'user';

// ─── Codex CLI Event Types (from `codex exec --json`) ─────────────────────

export type CodexItemType = 'agent_message' | 'command_execution' | 'file_change' | 'mcp_tool_call';
export type CodexItemStatus = 'in_progress' | 'completed' | 'failed';
export type CodexFileChangeKind = 'add' | 'update' | 'delete';

export type CodexFileChange = {
  path: string;
  kind: CodexFileChangeKind;
};

export type CodexItem =
  | { id: string; type: 'agent_message'; text: string }
  | { id: string; type: 'command_execution'; command: string; aggregated_output: string; exit_code: number | null; status: CodexItemStatus }
  | { id: string; type: 'file_change'; changes: CodexFileChange[]; status: CodexItemStatus }
  | { id: string; type: 'mcp_tool_call'; server: string; tool: string; arguments: Record<string, unknown>; result: unknown; error: { message: string } | null; status: CodexItemStatus };

export type CodexUsage = {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
};

export type CodexEvent =
  | { type: 'thread.started'; thread_id: string }
  | { type: 'turn.started' }
  | { type: 'turn.completed'; usage: CodexUsage }
  | { type: 'turn.failed'; error: { message: string } }
  | { type: 'item.started'; item: CodexItem }
  | { type: 'item.completed'; item: CodexItem };

// ─── Invocation Types (shared by all gates) ───────────────────────────────

export type InvocationRequest = {
  taskId: string;
  prompt: string;
  context: HandoffPacket | null;
  memoryContext?: string | null;
  systemPrompt?: string;
  cwd?: string;
  allowedToolNames?: string[];
  allowedToolBundles?: string[];
  workflowType?: string;
  maxTokensOverride?: number;
  abortSignal: AbortSignal;
};

export type InvocationProgress = {
  taskId: string;
  providerId: ProviderId;
  type: 'stdout' | 'stderr' | 'token' | 'status' | 'item';
  data: string;
  codexItem?: CodexItem;
  timestamp: number;
};

export type InvocationResult = {
  taskId: string;
  providerId: ProviderId;
  success: boolean;
  output: string;
  artifacts: HandoffArtifact[];
  error?: string;
  usage: { inputTokens: number; outputTokens: number; durationMs: number };
  codexItems?: CodexItem[];
};

// ─── Handoff Types ────────────────────────────────────────────────────────

export type HandoffArtifactType = 'file_change' | 'command_output' | 'agent_message' | 'error';

export type HandoffArtifact = {
  type: HandoffArtifactType;
  label: string;
  content: string;
  path?: string;
};

export type HandoffPacket = {
  id: string;
  taskId: string;
  fromProvider: ProviderId;
  toProvider: ProviderId;
  summary: string;
  artifacts: HandoffArtifact[];
  recentDecisions: string[];
  tokenEstimate: number;
  createdAt: number;
};

export type TaskMemoryEntryKind =
  | 'user_prompt'
  | 'model_result'
  | 'browser_finding'
  | 'handoff'
  | 'system';

export type TaskMemoryEntry = {
  id: string;
  taskId: string;
  kind: TaskMemoryEntryKind;
  text: string;
  providerId?: ProviderId;
  createdAt: number;
  metadata?: Record<string, unknown>;
};

export type TaskMemoryRecord = {
  taskId: string;
  lastUpdatedAt: number | null;
  entries: TaskMemoryEntry[];
};

export function createEmptyTaskMemoryRecord(taskId: string): TaskMemoryRecord {
  return {
    taskId,
    lastUpdatedAt: null,
    entries: [],
  };
}

// ─── Routing Types ────────────────────────────────────────────────────────

export type RoutingRule = {
  match: RoutingMatch;
  assignTo: ProviderId;
  priority: number;
};

export type RoutingMatch =
  | { type: 'capability'; capability: ProviderCapability }
  | { type: 'explicit'; owner: ProviderId }
  | { type: 'default' };

// ─── Codex Configuration ──────────────────────────────────────────────────

export type CodexApprovalMode = 'full-auto' | 'dangerously-bypass';

export type CodexInvocationConfig = {
  approvalMode: CodexApprovalMode;
  sandbox: 'read-only' | 'workspace-write' | null;
  timeoutMs: number;
  ephemeral: boolean;
};

export const DEFAULT_CODEX_CONFIG: CodexInvocationConfig = {
  approvalMode: 'dangerously-bypass',
  sandbox: null,
  timeoutMs: 300_000,
  ephemeral: false,
};

// ─── Haiku Configuration ──────────────────────────────────────────────────

export type HaikuInvocationConfig = {
  modelId: string;
  maxTokens: number;
  streaming: boolean;
};

export const DEFAULT_HAIKU_CONFIG: HaikuInvocationConfig = {
  modelId: 'claude-haiku-4-5-20251001',
  maxTokens: 4096,
  streaming: true,
};

// ─── Sonnet Configuration ─────────────────────────────────────────────

export type SonnetInvocationConfig = {
  modelId: string;
  maxTokens: number;
};

export const DEFAULT_SONNET_CONFIG: SonnetInvocationConfig = {
  modelId: 'claude-sonnet-4-6-20250514',
  maxTokens: 1024,
};
