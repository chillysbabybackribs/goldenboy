import type { AnyProviderId, CodexItem } from '../../shared/types/model';
import type { AgentProviderRequest, AgentToolName, AgentToolResult } from './AgentTypes';
import type { AgentToolBindingStore } from './toolBindingScope';
export declare const DEFAULT_PROVIDER_MAX_TOOL_TURNS = 20;
export declare const MAX_PROVIDER_TOOL_TURNS = 40;
type ProviderToolCallItem = Extract<CodexItem, {
    type: 'mcp_tool_call';
}>;
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
export type ProviderToolCallWithEventsExecution = (ProviderToolCallSuccess & ProviderToolCallWithEventsBase) | (ProviderToolCallFailure & ProviderToolCallWithEventsBase);
export declare function normalizeProviderMaxToolTurns(requestedTurns?: number): number;
export declare function describeProviderToolCall(toolName: string, input: unknown): string;
export declare function resolveRuntimeToolExpansion(request: Pick<AgentProviderRequest, 'toolCatalog'>, currentTools: AgentProviderRequest['promptTools'], toolName: AgentToolName, result: AgentToolResult): {
    pack: string;
    description: string;
    tools: AgentToolName[];
    scope: 'named' | 'all';
    relatedPackIds: string[];
} | null;
export declare function applyRuntimeToolExpansion(input: {
    request: Pick<AgentProviderRequest, 'toolCatalog'>;
    toolBindingStore: Pick<AgentToolBindingStore, 'getCallableTools' | 'queueTools'>;
    toolName: AgentToolName;
    result: AgentToolResult;
}): {
    pack: string;
    description: string;
    tools: AgentToolName[];
    scope: 'named' | 'all';
    relatedPackIds: string[];
} | null;
export declare function applyAutoExpandedToolPack(input: {
    message: string;
    toolCatalog: AgentProviderRequest['toolCatalog'];
    toolBindingStore: Pick<AgentToolBindingStore, 'getCallableTools' | 'queueTools'>;
}): {
    pack: string;
    reason: string;
    description: string;
    tools: AgentToolName[];
    scope: 'named' | 'all';
    relatedPackIds: string[];
} | null;
export declare function formatQueuedExpansionLines(expansion: {
    pack: string;
    description: string;
    scope: 'named' | 'all';
    tools: AgentToolName[];
}, options?: {
    style?: 'codex' | 'haiku';
}): string[];
export declare function formatAutoExpandedToolPackLines(expansion: {
    pack: string;
    reason: string;
    description: string;
    scope: 'named' | 'all';
    tools: AgentToolName[];
}, options?: {
    includeCallableStatus?: boolean;
    continueInstruction?: boolean;
}): string[];
export declare function encodeToolInput(value: unknown): string;
export declare function normalizeProviderFinalOutput(text: string): string;
export declare function publishProviderFinalOutput(input: {
    request: Pick<AgentProviderRequest, 'onItem' | 'onToken'>;
    itemId: string;
    text: string;
    emitToken?: boolean;
}): Extract<CodexItem, {
    type: 'agent_message';
}>;
export declare function executeProviderToolCall(input: ExecuteProviderToolCallInput): Promise<ProviderToolCallExecution>;
export declare function executeProviderToolCallWithEvents(input: ExecuteProviderToolCallWithEventsInput): Promise<ProviderToolCallWithEventsExecution>;
export {};
