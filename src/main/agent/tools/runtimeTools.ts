import { agentToolExecutor } from '../AgentToolExecutor';
import { AgentToolDefinition, AgentToolName } from '../AgentTypes';
import {
  buildRuntimeRequestToolDescription,
  listToolPacks,
  searchToolCatalog,
} from '../toolPacks';

function objectInput(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
}

function inputKind(input: unknown): string {
  if (input === null) return 'null';
  if (Array.isArray(input)) return 'array';
  return typeof input;
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

function optionalBoolean(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key];
  return typeof value === 'boolean' ? value : undefined;
}

function optionalInteger(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return Number.isInteger(value) ? Number(value) : undefined;
}

function requireToolNames(input: Record<string, unknown>, key: string): AgentToolName[] {
  const value = input[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Expected non-empty tool name array input: ${key}`);
  }
  const tools = value.filter((entry): entry is AgentToolName => typeof entry === 'string' && entry.trim().length > 0);
  if (tools.length !== value.length) {
    throw new Error(`Expected every ${key} entry to be a non-empty string`);
  }
  return Array.from(new Set(tools));
}

function findCatalogTool(
  toolName: AgentToolName,
  toolCatalog: Array<Pick<AgentToolDefinition, 'name' | 'description' | 'inputSchema'>>,
): Pick<AgentToolDefinition, 'name' | 'description' | 'inputSchema'> | null {
  return toolCatalog.find((tool) => tool.name === toolName) ?? null;
}

function validateSchemaValue(
  value: unknown,
  schema: Record<string, unknown> | undefined,
  path: string,
): string[] {
  if (!schema || Object.keys(schema).length === 0) return [];

  const oneOf = Array.isArray(schema.oneOf) ? schema.oneOf : null;
  if (oneOf) {
    const matches = oneOf.some((candidate) => (
      typeof candidate === 'object'
      && candidate !== null
      && validateSchemaValue(value, candidate as Record<string, unknown>, path).length === 0
    ));
    return matches ? [] : [`${path} must satisfy one of the allowed schemas; got ${inputKind(value)}.`];
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => entry === value)) {
    return [`${path} must be one of ${schema.enum.map((entry) => JSON.stringify(entry)).join(', ')}.`];
  }

  const schemaType = typeof schema.type === 'string' ? schema.type : null;
  switch (schemaType) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return [`${path} must be an object; got ${inputKind(value)}.`];
      }
      const obj = value as Record<string, unknown>;
      const errors: string[] = [];
      const properties = (
        typeof schema.properties === 'object'
        && schema.properties !== null
        && !Array.isArray(schema.properties)
      ) ? schema.properties as Record<string, Record<string, unknown>> : {};
      const required = Array.isArray(schema.required)
        ? schema.required.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        : [];
      for (const key of required) {
        if (!Object.prototype.hasOwnProperty.call(obj, key)) {
          errors.push(`${path}.${key} is required.`);
        }
      }
      for (const [key, propertySchema] of Object.entries(properties)) {
        if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
        errors.push(...validateSchemaValue(obj[key], propertySchema, `${path}.${key}`));
      }
      if (schema.additionalProperties === false) {
        const extras = Object.keys(obj).filter((key) => !Object.prototype.hasOwnProperty.call(properties, key));
        if (extras.length > 0) {
          errors.push(`${path} has unexpected properties: ${extras.join(', ')}.`);
        }
      }
      return errors;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        return [`${path} must be an array; got ${inputKind(value)}.`];
      }
      const errors: string[] = [];
      if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
        errors.push(`${path} must contain at least ${schema.minItems} item(s).`);
      }
      if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
        errors.push(`${path} must contain at most ${schema.maxItems} item(s).`);
      }
      if (typeof schema.items === 'object' && schema.items !== null) {
        value.forEach((item, index) => {
          errors.push(...validateSchemaValue(item, schema.items as Record<string, unknown>, `${path}[${index}]`));
        });
      }
      return errors;
    }
    case 'string':
      return typeof value === 'string' ? [] : [`${path} must be a string; got ${inputKind(value)}.`];
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? []
        : [`${path} must be a finite number; got ${inputKind(value)}.`];
    case 'integer':
      return Number.isInteger(value) ? [] : [`${path} must be an integer; got ${inputKind(value)}.`];
    case 'boolean':
      return typeof value === 'boolean' ? [] : [`${path} must be a boolean; got ${inputKind(value)}.`];
    default:
      return [];
  }
}

function validateNestedToolInput(
  toolName: AgentToolName,
  input: unknown,
  schema: Record<string, unknown>,
): void {
  const errors = validateSchemaValue(input, schema, 'input');
  if (errors.length === 0) return;
  throw new Error(`Invalid input for ${toolName}: ${errors[0]}`);
}

export function createRuntimeToolDefinitions(): AgentToolDefinition[] {
  return [
    {
      name: 'runtime.search_tools',
      description: [
        'Search the full host-managed tool catalog and identify the most relevant exact tools to hydrate into the active runtime scope.',
        'Use this first when you need a capability that is not currently exposed.',
        'This tool returns the best matching tools plus callable-vs-next-turn hydration metadata.',
        'When the runtime hydrates searched tools, newly selected tools become callable on the next turn unless they are already in the current scope.',
        'Prefer this over loading an entire pack when you only need a few tools.',
      ].join('\n'),
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['query'],
        properties: {
          query: { type: 'string' },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 10,
          },
          include_loaded: {
            type: 'boolean',
          },
        },
      },
      async execute(input, context) {
        const obj = objectInput(input);
        const query = requireString(obj, 'query');
        const limit = optionalInteger(obj, 'limit') ?? 5;
        const includeLoaded = optionalBoolean(obj, 'include_loaded') ?? true;
        const matches = searchToolCatalog(query, context.toolCatalog, {
          currentTools: context.toolNames?.map((name) => ({ name })) ?? [],
          limit,
        }).filter((match) => includeLoaded || !match.callableNow);

        return {
          summary: matches.length
            ? `Found ${matches.length} tool matches for "${query}"`
            : `No tool matches found for "${query}"`,
          data: {
            query,
            matches: matches.map((match) => ({
              name: match.name,
              description: match.description,
              category: match.category,
              relatedPackIds: match.relatedPackIds,
              bindingState: match.bindingState,
              callableNow: match.callableNow,
              invokableNow: match.invokableNow,
              invocationMethod: match.invocationMethod,
              availableNextTurn: match.availableNextTurn,
              reason: match.reason,
            })),
            tools: matches.map((match) => match.name),
            suggestedPackIds: Array.from(new Set(matches.flatMap((match) => match.relatedPackIds))),
            hydration: {
              callableNow: matches.filter((match) => match.callableNow).map((match) => match.name),
              invokableNow: matches.filter((match) => match.invokableNow).map((match) => match.name),
              availableNextTurn: matches.filter((match) => match.availableNextTurn).map((match) => match.name),
              failed: [],
            },
          },
        };
      },
    },
    {
      name: 'runtime.require_tools',
      description: [
        'Grant exact tool access through the stable runtime gateway without widening the prompt-bound tool surface.',
        'Use this after runtime.search_tools when you know the exact tools you need right now.',
        'Granted tools are immediately invokable through runtime.invoke_tool in the same run.',
        'This does not replace runtime.request_tool_pack, which is still the right path for broader surfaces.',
      ].join('\n'),
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['tools'],
        properties: {
          tools: {
            type: 'array',
            minItems: 1,
            maxItems: 20,
            items: { type: 'string' },
          },
          mode: {
            type: 'string',
            enum: ['exact'],
          },
          availability: {
            type: 'string',
            enum: ['now'],
          },
          onFailure: {
            type: 'string',
            enum: ['fail', 'continue'],
          },
        },
      },
      async execute(input, context) {
        const obj = objectInput(input);
        const requestedTools = requireToolNames(obj, 'tools');
        const onFailure = optionalString(obj, 'onFailure') ?? 'continue';
        const callableToolNames = new Set(context.toolNames ?? []);
        const grantedNow: AgentToolName[] = [];
        const alreadyCallable: AgentToolName[] = [];
        const denied: Array<{ name: AgentToolName; reason: string }> = [];

        for (const toolName of requestedTools) {
          if (!findCatalogTool(toolName, context.toolCatalog)) {
            denied.push({ name: toolName, reason: 'Tool is not available in this runtime catalog for the current run.' });
            continue;
          }
          grantedNow.push(toolName);
          if (callableToolNames.has(toolName)) {
            alreadyCallable.push(toolName);
          }
        }

        if (denied.length > 0 && onFailure === 'fail') {
          throw new Error(denied.map((entry) => `${entry.name}: ${entry.reason}`).join('\n'));
        }

        return {
          summary: denied.length === 0
            ? `Granted ${grantedNow.length} exact tools for runtime invocation`
            : `Granted ${grantedNow.length} exact tools; ${denied.length} could not be granted`,
          data: {
            mode: 'exact',
            availability: 'now',
            requestedTools,
            grantedNow,
            alreadyCallable,
            denied,
            invocationTool: 'runtime.invoke_tool',
          },
        };
      },
    },
    {
      name: 'runtime.invoke_tool',
      description: [
        'Invoke an exact tool by name through the stable runtime gateway.',
        'Use this when a searched or required tool exists in the runtime catalog but is not directly bound into the prompt tool surface.',
        'This preserves scoped prompting while avoiding next-turn binding drift.',
      ].join('\n'),
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['tool'],
        properties: {
          tool: { type: 'string' },
          input: {},
        },
      },
      async execute(input, context) {
        const obj = objectInput(input);
        const toolName = requireString(obj, 'tool') as AgentToolName;
        const toolInput = Object.prototype.hasOwnProperty.call(obj, 'input') ? obj.input : {};

        if (toolName === 'runtime.invoke_tool') {
          throw new Error('runtime.invoke_tool cannot invoke itself.');
        }
        const targetTool = findCatalogTool(toolName, context.toolCatalog);
        if (!targetTool) {
          throw new Error(`Tool is not available in this runtime catalog: ${toolName}`);
        }
        validateNestedToolInput(toolName, toolInput, targetTool.inputSchema);

        const result = await agentToolExecutor.execute(toolName, toolInput, context);
        return {
          summary: `Invoked ${toolName}: ${result.summary}`,
          data: {
            tool: toolName,
            invokedVia: 'runtime.invoke_tool',
            result,
          },
          validation: result.validation,
        };
      },
    },
    {
      name: 'runtime.list_tool_packs',
      description: 'List the available host-managed tool packs, including their baseline tools, full tool membership, scope, and related packs. Use this first when you suspect the current runtime tool scope is too narrow.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
      async execute() {
        const packs = listToolPacks().map((pack) => ({
          id: pack.id,
          description: pack.description,
          baseline4: pack.baseline4 ?? [],
          baseline6: pack.baseline6 ?? [],
          tools: pack.tools,
          scope: pack.scope ?? 'named',
          relatedPackIds: pack.relatedPackIds ?? [],
        }));

        return {
          summary: `Listed ${packs.length} tool packs`,
          data: { packs },
        };
      },
    },
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
            hydration: {
              callableNow: [],
              availableNextTurn: manifest.tools,
              failed: [],
            },
          },
        };
      },
    },
  ];
}
