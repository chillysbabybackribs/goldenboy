import { AgentProvider, AgentToolDefinition } from './AgentTypes';
import { createBrowserToolDefinitions } from './tools/browserTools';
import { createChatToolDefinitions } from './tools/chatTools';
import { createAttachmentToolDefinitions } from './tools/attachmentTools';
import { createFilesystemToolDefinitions } from './tools/filesystemTools';
import { createRuntimeToolDefinitions } from './tools/runtimeTools';
import { createTerminalToolDefinitions } from './tools/terminalTools';
import { createSubAgentToolDefinitions } from './tools/subagentTools';
import { SubAgentSpawnInput } from './subagents/SubAgentTypes';

export type AgentToolSchemaSummary = Pick<AgentToolDefinition, 'name' | 'description' | 'inputSchema'>;

export function summarizeToolDefinitions(tools: AgentToolDefinition[]): AgentToolSchemaSummary[] {
  return tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

export function createUnrestrictedDevToolSchemas(providerFactory: (input: SubAgentSpawnInput) => AgentProvider): AgentToolSchemaSummary[] {
  return summarizeToolDefinitions([
    ...createAttachmentToolDefinitions(),
    ...createRuntimeToolDefinitions(),
    ...createBrowserToolDefinitions(),
    ...createChatToolDefinitions(),
    ...createFilesystemToolDefinitions(),
    ...createTerminalToolDefinitions(),
    ...createSubAgentToolDefinitions(providerFactory),
  ]);
}
