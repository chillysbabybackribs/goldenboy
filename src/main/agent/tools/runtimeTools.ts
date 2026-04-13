import { AgentToolDefinition } from '../AgentTypes';
import { buildRuntimeRequestToolDescription, listToolPacks } from '../toolPacks';

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
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

export function createRuntimeToolDefinitions(): AgentToolDefinition[] {
  return [
    {
      name: 'runtime.request_tool_pack',
      description: buildRuntimeRequestToolDescription(),
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['pack'],
        properties: {
          pack: {
            type: 'string',
            enum: listToolPacks().map((pack) => pack.id),
          },
          reason: { type: 'string' },
        },
      },
      async execute(input) {
        const obj = objectInput(input);
        const pack = requireString(obj, 'pack');
        const reason = optionalString(obj, 'reason');
        const manifest = listToolPacks().find((entry) => entry.id === pack);
        if (!manifest) {
          throw new Error(`Unknown tool pack: ${pack}`);
        }

        return {
          summary: `Requested tool pack: ${pack}`,
          data: {
            pack: manifest.id,
            description: manifest.description,
            tools: manifest.tools,
            scope: manifest.scope ?? 'named',
            relatedPackIds: manifest.relatedPackIds ?? [],
            reason: reason ?? null,
          },
        };
      },
    },
  ];
}
