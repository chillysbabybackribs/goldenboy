import { agentToolExecutor } from '../AgentToolExecutor';
import { AgentToolDefinition, AgentToolName } from '../AgentTypes';
import { buildToolRegistryEntries, searchToolRegistry } from '../toolRegistry';

function objectInput(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Expected non-empty string input: ${key}`);
  }
  return value;
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function optionalNumber(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function requireStringArray(input: Record<string, unknown>, key: string): string[] {
  const value = input[key];
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new Error(`Expected non-empty string array input: ${key}`);
  }
  return value.map((item) => item.trim());
}

function listAllRegisteredTools(): AgentToolDefinition[] {
  return agentToolExecutor
    .list()
    .filter((tool) => tool.name !== 'runtime.list_loaded_tools');
}

export function createRuntimeToolDefinitions(): AgentToolDefinition[] {
  return [
    {
      name: 'runtime.search_tools',
      description: 'Search the runtime tool registry by intent, names, tags, or descriptions. Use this when the current loaded tool scope is insufficient or when you need to discover the exact tool names required for the task.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['query'],
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' },
        },
      },
      async execute(input, context) {
        const obj = objectInput(input);
        const query = requireString(obj, 'query');
        const limit = Math.min(Math.max(optionalNumber(obj, 'limit') ?? 8, 1), 20);
        const results = searchToolRegistry(listAllRegisteredTools(), query, context.toolNames ?? [], limit);

        return {
          summary: `Found ${results.length} tool matches for "${query}"`,
          data: {
            query,
            results,
          },
        };
      },
    },
    {
      name: 'runtime.load_tools',
      description: 'Load specific tools into the active run by exact tool name. Use this after runtime.search_tools identifies the tools you need. The runtime will make those tools available for the rest of the task when authorized.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['tools'],
        properties: {
          tools: {
            type: 'array',
            description: 'Exact runtime tool names to add to the active run, for example "browser.get_tabs" or "filesystem.read".',
            items: { type: 'string' },
          },
          reason: {
            type: 'string',
            description: 'Short explanation of why these tools are needed now.',
          },
        },
      },
      async execute(input) {
        const obj = objectInput(input);
        const tools = requireStringArray(obj, 'tools');
        const reason = optionalString(obj, 'reason');
        const availableTools = new Map(listAllRegisteredTools().map((tool) => [tool.name, tool]));
        const unknown = tools.filter((name) => !availableTools.has(name as AgentToolName));
        if (unknown.length > 0) {
          throw new Error(`Unknown tool name(s): ${unknown.join(', ')}`);
        }
        const uniqueTools = Array.from(new Set(tools)) as AgentToolName[];

        return {
          summary: `Loaded ${uniqueTools.length} tool${uniqueTools.length === 1 ? '' : 's'}`,
          data: {
            tools: uniqueTools,
            reason: reason ?? null,
          },
        };
      },
    },
    {
      name: 'runtime.list_loaded_tools',
      description: 'List the tools currently loaded in this run. Use this to inspect the active execution surface before searching for or loading more tools.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
      async execute(_input, context) {
        const loaded = buildToolRegistryEntries(
          listAllRegisteredTools(),
          context.toolNames ?? [],
        ).filter((entry) => entry.loaded);

        return {
          summary: `Listed ${loaded.length} loaded tools`,
          data: {
            tools: loaded,
          },
        };
      },
    },
  ];
}
