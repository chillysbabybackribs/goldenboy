import { AgentProvider, AgentToolDefinition } from './AgentTypes';
import { createAnswerSubmitToolDefinitions } from './tools/answerSubmit';
import { createBrowserToolDefinitions } from './tools/browser';
import { createAttachmentToolDefinitions } from './tools/attachments';
import { createFilesystemToolDefinitions } from './tools/filesystem';
import { createMemoryToolDefinitions } from './tools/memory';
import { createTerminalToolDefinitions } from './tools/terminal';
import { createSubAgentToolDefinitions } from './tools/subagent';
import { createRepoMapToolDefinitions } from './tools/repomap';
import { SubAgentSpawnInput } from './subagents/SubAgentTypes';

export type AgentToolSchemaSummary = Pick<AgentToolDefinition, 'name' | 'description' | 'inputSchema'>;

export function summarizeToolDefinitions(tools: AgentToolDefinition[]): AgentToolSchemaSummary[] {
  return tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

export function createUnrestrictedDevToolSchemas(providerFactory: (input: SubAgentSpawnInput) => AgentProvider): AgentToolSchemaSummary[] {
  return summarizeToolDefinitions([
    ...createAnswerSubmitToolDefinitions(),
    ...createAttachmentToolDefinitions(),
    ...createBrowserToolDefinitions(),
    ...createFilesystemToolDefinitions(),
    ...createMemoryToolDefinitions(),
    ...createTerminalToolDefinitions(),
    ...createRepoMapToolDefinitions(),
    ...createSubAgentToolDefinitions(providerFactory),
  ]);
}
