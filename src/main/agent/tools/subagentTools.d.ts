import { AgentProvider, AgentToolDefinition } from '../AgentTypes';
import { SubAgentSpawnInput } from '../subagents/SubAgentTypes';
export declare function createSubAgentToolDefinitions(providerFactory: (input: SubAgentSpawnInput) => AgentProvider): AgentToolDefinition[];
