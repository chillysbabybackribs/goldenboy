import { AgentProvider, AgentToolDefinition } from './AgentTypes';
import { SubAgentSpawnInput } from './subagents/SubAgentTypes';
export type AgentToolSchemaSummary = Pick<AgentToolDefinition, 'name' | 'description' | 'inputSchema'>;
export declare function summarizeToolDefinitions(tools: AgentToolDefinition[]): AgentToolSchemaSummary[];
export declare function createUnrestrictedDevToolSchemas(providerFactory: (input: SubAgentSpawnInput) => AgentProvider): AgentToolSchemaSummary[];
