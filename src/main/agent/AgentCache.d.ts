import { AgentToolName } from './AgentTypes';
export declare class AgentCache {
    private toolResults;
    getToolResult<T>(key: string): T | null;
    setToolResult<T>(key: string, value: T, ttlMs?: number): void;
    invalidateByToolPrefix(prefix: string): void;
    clear(): void;
}
export declare function makeToolCacheKey(name: AgentToolName, input: unknown): string;
export declare const agentCache: AgentCache;
