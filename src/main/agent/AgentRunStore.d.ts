import { AgentRunRecord, AgentRunStatus, AgentToolCallRecord, AgentToolName, AgentToolStatus } from './AgentTypes';
export declare class AgentRunStore {
    private runs;
    private toolCalls;
    createRun(input: Omit<AgentRunRecord, 'id' | 'startedAt' | 'completedAt' | 'status' | 'resultSummary' | 'error'>): AgentRunRecord;
    updateRun(id: string, patch: Partial<Pick<AgentRunRecord, 'status' | 'completedAt' | 'resultSummary' | 'error'>>): AgentRunRecord;
    finishRun(id: string, status: Exclude<AgentRunStatus, 'queued' | 'running'>, resultSummary: string | null, error?: string | null): AgentRunRecord;
    getRun(id: string): AgentRunRecord | null;
    listRuns(): AgentRunRecord[];
    startToolCall(input: {
        runId: string;
        agentId: string;
        toolName: AgentToolName;
        toolInput: unknown;
    }): AgentToolCallRecord;
    finishToolCall(id: string, status: AgentToolStatus, output: unknown, error?: string | null): AgentToolCallRecord;
    listToolCalls(runId?: string): AgentToolCallRecord[];
    prune(now?: number): void;
    private pruneMapByAge;
}
export declare const agentRunStore: AgentRunStore;
