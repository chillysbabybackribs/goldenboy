import type { DocumentInvocationAttachment } from './attachments';

// ═══════════════════════════════════════════════════════════════════════════
// Model Layer Types — Provider registry, Codex events, and invocation shape
// ═══════════════════════════════════════════════════════════════════════════

// ─── Provider Identity ────────────────────────────────────────────────────

export const PRIMARY_PROVIDER_ID = 'gpt-5.4' as const;
export const PROVIDER_IDS = [PRIMARY_PROVIDER_ID] as const;

export type ProviderId = typeof PROVIDER_IDS[number];

export type ProviderStatus = 'available' | 'unavailable' | 'busy' | 'error';

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

export function isProviderId(value: string): value is ProviderId {
  return value === PRIMARY_PROVIDER_ID;
}

// ─── Task Ownership ───────────────────────────────────────────────────────

export type ModelOwner = ProviderId | 'user';

export type AgentTaskKind =
  | 'orchestration'
  | 'research'
  | 'browser-automation'
  | 'implementation'
  | 'debug'
  | 'review'
  | 'delegation'
  | 'browser-search'
  | 'local-code'
  | 'general';

export type AgentExecutionMode =
  | 'single-pass'
  | 'staged'
  | 'orchestration';

export type AgentTaskProfileOverride = {
  kind?: AgentTaskKind;
  executionMode?: AgentExecutionMode;
  skillNames?: string[];
  allowedTools?: 'all' | string[];
  canSpawnSubagents?: boolean;
  maxToolTurns?: number;
  requiresBrowserSearchDirective?: boolean;
};

export type ImageInvocationAttachment = {
  type: 'image';
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  /** Base64-encoded image data (no data-URL prefix). */
  data: string;
  name?: string;
  /** Optional local filesystem path for providers that can read images directly from disk. */
  path?: string;
};

export type InvocationAttachment = ImageInvocationAttachment | DocumentInvocationAttachment;

export type AgentInvocationOptions = {
  systemPrompt?: string;
  cwd?: string;
  taskProfile?: AgentTaskProfileOverride;
  attachments?: InvocationAttachment[];
  displayPrompt?: string;
  maxTokensOverride?: number;
};

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
  /**
   * Reasoning output tokens emitted by reasoning-class models (e.g. GPT-5).
   * Optional because older Codex protocol versions may omit it; when present
   * it is billed as output and should be added to `output_tokens` for usage
   * accounting.
   */
  reasoning_output_tokens?: number;
};

export type CodexEvent =
  | { type: 'thread.started'; thread_id: string }
  | { type: 'turn.started' }
  | { type: 'turn.completed'; usage: CodexUsage }
  | { type: 'turn.failed'; error: { message: string } }
  | { type: 'item.started'; item: CodexItem }
  | { type: 'item.completed'; item: CodexItem };

// ─── Invocation Types (shared by all gates) ───────────────────────────────

export type InvocationProgress =
  | {
      taskId: string;
      providerId: ProviderId;
      type: 'stdout' | 'stderr' | 'token' | 'status' | 'item';
      data: string;
      codexItem?: CodexItem;
      timestamp: number;
    }
  | {
      taskId: string;
      providerId: ProviderId;
      type: 'usage';
      data: {
        inputTokens: number;
        outputTokens: number;
        apiCalls: number;
        cachedInputTokens?: number;
        cacheCreationInputTokens?: number;
      };
      timestamp: number;
    };

export type InvocationResult = {
  taskId: string;
  providerId: ProviderId;
  success: boolean;
  status?: 'completed' | 'failed' | 'cancelled';
  output: string;
  error?: string;
  usage: { inputTokens: number; outputTokens: number; durationMs: number };
  codexItems?: CodexItem[];
};

export type TaskMemoryEntryKind =
  | 'user_prompt'
  | 'model_result'
  | 'browser_finding'
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

export type TaskPlanMetadata = {
  category: 'plan';
  planId?: string;
  planName?: string;
  sourceKind?: TaskMemoryEntryKind;
  scratchpadPath?: string;
  stage:
    | 'scaffold'
    | 'checklist-captured'
    | 'checklist-updated'
    | 'parent-turn-complete'
    | 'parent-turn-failed'
    | 'parent-turn-cancelled'
    | 'subagent-spawn'
    | 'subagent-complete'
    | 'subagent-failed'
    | 'subagent-cancelled';
  items?: Array<{
    id: string;
    text: string;
    status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'dropped';
    notes?: string;
  }>;
  currentItemId?: string;
  objective?: string;
  tracks?: string[];
  delegation?: string[];
  validation?: string[];
  nextAction?: string;
  status?: 'running' | 'completed' | 'failed' | 'cancelled';
  providerId?: ProviderId;
  role?: string;
  subagentId?: string;
  task?: string;
  findings?: string[];
  blockers?: string[];
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
