import { AgentToolContext, AgentToolDefinition, AgentToolName, AgentToolResult } from './AgentTypes';
export declare class AgentToolExecutor {
    private tools;
    register(tool: AgentToolDefinition): void;
    registerMany(tools: AgentToolDefinition[]): void;
    list(): AgentToolDefinition[];
    execute(name: AgentToolName, input: unknown, context: AgentToolContext): Promise<AgentToolResult>;
}
export declare const agentToolExecutor: AgentToolExecutor;
