export declare const PRIMARY_PROVIDER_ID: "gpt-5.4";
export declare const HAIKU_PROVIDER_ID: "haiku";
export declare const PROVIDER_IDS: readonly ["gpt-5.4", "haiku"];
export type ProviderId = typeof PROVIDER_IDS[number];
export type LegacyProviderId = 'codex';
export type AnyProviderId = ProviderId | LegacyProviderId;
export type ProviderKind = 'cli-process' | 'api-streaming';
export type ProviderStatus = 'available' | 'unavailable' | 'busy' | 'error';
export type ProviderCapability = 'code-generation' | 'code-editing' | 'shell-execution' | 'repo-analysis' | 'chat' | 'summarization' | 'intent-parsing' | 'plan' | 'planning' | 'synthesis';
export type ProviderDefinition = {
    id: ProviderId;
    displayName: string;
    kind: ProviderKind;
    capabilities: ProviderCapability[];
};
export type CodexStatusMetrics = {
    contextWindow?: {
        percentLeft: number;
        used: string;
        total: string;
    };
    limit5h?: {
        percentLeft: number;
        resetsAt: string;
    };
    limitWeekly?: {
        percentLeft: number;
        resetsAt: string;
    };
    credits?: number;
};
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
export declare function createDefaultProviderRuntime(id: ProviderId): ProviderRuntime;
export declare function isProviderId(value: string): value is ProviderId;
export declare function isLegacyProviderId(value: string): value is LegacyProviderId;
export type ModelOwner = ProviderId | 'user';
export type AgentTaskKind = 'orchestration' | 'research' | 'browser-automation' | 'implementation' | 'debug' | 'review' | 'delegation' | 'browser-search' | 'local-code' | 'general';
export declare const AGENT_TOOL_PACK_PRESETS: readonly ["all", "mode-6", "mode-4"];
export type AgentToolPackPreset = typeof AGENT_TOOL_PACK_PRESETS[number];
export type AgentTaskProfileOverride = {
    kind?: AgentTaskKind;
    skillNames?: string[];
    toolPackPreset?: AgentToolPackPreset;
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
};
export type CodexItemType = 'agent_message' | 'command_execution' | 'file_change' | 'mcp_tool_call';
export type CodexItemStatus = 'in_progress' | 'completed' | 'failed';
export type CodexFileChangeKind = 'add' | 'update' | 'delete';
export type CodexFileChange = {
    path: string;
    kind: CodexFileChangeKind;
};
export type CodexItem = {
    id: string;
    type: 'agent_message';
    text: string;
} | {
    id: string;
    type: 'command_execution';
    command: string;
    aggregated_output: string;
    exit_code: number | null;
    status: CodexItemStatus;
} | {
    id: string;
    type: 'file_change';
    changes: CodexFileChange[];
    status: CodexItemStatus;
} | {
    id: string;
    type: 'mcp_tool_call';
    server: string;
    tool: string;
    arguments: Record<string, unknown>;
    result: unknown;
    error: {
        message: string;
    } | null;
    status: CodexItemStatus;
};
export type CodexUsage = {
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
};
export type CodexEvent = {
    type: 'thread.started';
    thread_id: string;
} | {
    type: 'turn.started';
} | {
    type: 'turn.completed';
    usage: CodexUsage;
} | {
    type: 'turn.failed';
    error: {
        message: string;
    };
} | {
    type: 'item.started';
    item: CodexItem;
} | {
    type: 'item.completed';
    item: CodexItem;
};
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
export type PersistedTurnProcessEntry = {
    kind: 'thought' | 'tool';
    text: string;
};
export type InvocationResult = {
    taskId: string;
    providerId: ProviderId;
    success: boolean;
    output: string;
    artifacts: HandoffArtifact[];
    error?: string;
    usage: {
        inputTokens: number;
        outputTokens: number;
        durationMs: number;
    };
    codexItems?: CodexItem[];
    processEntries?: PersistedTurnProcessEntry[];
    runId?: string;
};
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
export type TaskMemoryEntryKind = 'user_prompt' | 'model_result' | 'browser_finding' | 'handoff' | 'system';
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
export declare function createEmptyTaskMemoryRecord(taskId: string): TaskMemoryRecord;
export type RuntimeLedgerEventKind = 'task_status' | 'provider_switch' | 'artifact' | 'tool' | 'browser' | 'subagent' | 'user_prompt' | 'model_result' | 'browser_finding' | 'handoff' | 'claim' | 'evidence' | 'critique' | 'verification';
export type RuntimeLedgerEventScope = 'task' | 'global';
export type RuntimeLedgerEventSource = 'agent-service' | 'task-memory' | 'browser' | 'subagent' | 'system';
export type RuntimeLedgerEvent = {
    id: string;
    taskId: string | null;
    runId?: string;
    providerId?: ProviderId;
    timestamp: number;
    kind: RuntimeLedgerEventKind;
    scope: RuntimeLedgerEventScope;
    summary: string;
    source: RuntimeLedgerEventSource;
    metadata?: Record<string, unknown>;
};
export type RuntimeTaskAwareness = {
    taskId: string;
    taskTitle: string | null;
    lastUpdatedAt: number | null;
    activeProviderId: ProviderId | null;
    taskStatus: 'queued' | 'running' | 'completed' | 'failed' | null;
    latestUserPrompt: string | null;
    latestModelResult: string | null;
    latestBrowserFinding: string | null;
    activeArtifactLabel: string | null;
    activeBrowserTabLabel: string | null;
    activeSubagentLabels: string[];
    openIssues: string[];
    evidence: string[];
    decisions: string[];
    recentEvents: RuntimeLedgerEvent[];
};
export type RuntimeRunSnapshot = {
    runId: string;
    taskId: string | null;
    providerId: ProviderId | null;
    status: 'running' | 'completed' | 'failed' | null;
    startedAt: number | null;
    completedAt: number | null;
    latestToolCallLabel: string | null;
    latestToolStatus: 'running' | 'completed' | 'failed' | null;
    latestToolSummary: string | null;
};
export type RuntimeArtifactSnapshot = {
    artifactId: string;
    taskId: string | null;
    title: string;
    format: string;
    status: string;
    isActive: boolean;
    lastUpdatedAt: number;
    lastAction: string | null;
    lastSummary: string | null;
};
export type RuntimeBrowserTabSnapshot = {
    tabId: string;
    taskId: string | null;
    title: string | null;
    url: string | null;
    isActive: boolean;
    isLoading: boolean | null;
    lastUpdatedAt: number;
    lastAction: string | null;
    lastSummary: string | null;
};
export type RuntimeDecisionSnapshot = {
    taskId: string | null;
    summary: string;
    sourceKind: 'verification' | 'handoff';
    timestamp: number;
    providerId: ProviderId | null;
};
export type RuntimeEvidenceSnapshot = {
    taskId: string | null;
    summary: string;
    sourceKind: 'evidence' | 'browser_finding';
    timestamp: number;
    providerId: ProviderId | null;
};
export type RuntimeTaskEntitySnapshot = {
    taskId: string;
    currentRun: RuntimeRunSnapshot | null;
    artifacts: RuntimeArtifactSnapshot[];
    browserTabs: RuntimeBrowserTabSnapshot[];
    decisions: RuntimeDecisionSnapshot[];
    evidence: RuntimeEvidenceSnapshot[];
};
export type RoutingRule = {
    match: RoutingMatch;
    assignTo: ProviderId;
    priority: number;
};
export type RoutingMatch = {
    type: 'capability';
    capability: ProviderCapability;
} | {
    type: 'explicit';
    owner: ProviderId;
} | {
    type: 'default';
};
export type CodexApprovalMode = 'full-auto' | 'dangerously-bypass';
export type CodexInvocationConfig = {
    approvalMode: CodexApprovalMode;
    sandbox: 'read-only' | 'workspace-write' | null;
    timeoutMs: number;
    ephemeral: boolean;
};
export declare const DEFAULT_CODEX_CONFIG: CodexInvocationConfig;
export type HaikuInvocationConfig = {
    modelId: string;
    maxTokens: number;
    streaming: boolean;
};
export declare const DEFAULT_HAIKU_CONFIG: HaikuInvocationConfig;
import type { DocumentInvocationAttachment } from './attachments';
