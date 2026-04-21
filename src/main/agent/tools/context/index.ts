import type { AgentToolDefinition, AgentToolSchemaSummary } from '../../AgentTypes';
import { agentToolExecutor } from '../../AgentToolExecutor';
import { addActiveTools } from '../../toolScopeState';
import {
  TOOL_CATEGORIES,
  TOOL_CATEGORY_IDS,
  isKnownCategory,
  toolsForCategory,
  type ToolCategoryId,
} from '../../toolCategories';

export function createContextToolDefinitions(): AgentToolDefinition[] {
  return [
    {
      name: 'context.load',
      description: 'LEGACY. All tools are already active at run start — you do not need to call this. Kept for backward compatibility; calling it is a no-op that simply reports which categories are already loaded. Available: browser, filesystem, terminal, attachments, subagent, session, repomap, workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          categories: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['categories'],
      },
      async execute(rawInput, context) {
        const input = (rawInput ?? {}) as { categories?: unknown };
        const requested = Array.isArray(input.categories) ? input.categories : [];
        const valid: ToolCategoryId[] = [];
        const unknown: string[] = [];
        for (const item of requested) {
          if (typeof item !== 'string') continue;
          const normalized = item.trim().toLowerCase();
          if (isKnownCategory(normalized)) valid.push(normalized);
          else unknown.push(item);
        }

        if (!context.toolScope) {
          return {
            summary: 'context.load called but no mutable tool scope is attached to this run.',
            data: { requested, loaded: [], rejected: unknown, alreadyActive: [], rules: [] },
          };
        }

        const registry = agentToolExecutor.list();
        const registryByName = new Map(registry.map((tool) => [tool.name, tool] as const));
        const summariesToAdd: AgentToolSchemaSummary[] = [];
        const alreadyActiveNames: string[] = [];
        const missingFromRegistry: string[] = [];
        const activeNames = new Set(context.toolScope.activeTools.map((t) => t.name));
        const loadedRules: Array<{ category: ToolCategoryId; rules: string }> = [];

        for (const categoryId of valid) {
          loadedRules.push({
            category: categoryId,
            rules: TOOL_CATEGORIES[categoryId].rules,
          });
          for (const toolName of toolsForCategory(categoryId)) {
            if (activeNames.has(toolName)) {
              alreadyActiveNames.push(toolName);
              continue;
            }
            const def = registryByName.get(toolName);
            if (!def) {
              missingFromRegistry.push(toolName);
              continue;
            }
            summariesToAdd.push({
              name: def.name,
              description: def.description,
              inputSchema: def.inputSchema,
            });
            activeNames.add(def.name);
          }
        }

        const addedNames = addActiveTools(context.toolScope, summariesToAdd);

        const summaryLines: string[] = [];
        if (valid.length > 0) {
          summaryLines.push(
            `Loaded categories: ${valid.join(', ')} (+${addedNames.length} tools${alreadyActiveNames.length ? `, ${alreadyActiveNames.length} already active` : ''}).`,
          );
        }
        if (unknown.length > 0) {
          summaryLines.push(
            `Unknown categories ignored: ${unknown.join(', ')}. Known: ${TOOL_CATEGORY_IDS.join(', ')}.`,
          );
        }
        if (missingFromRegistry.length > 0) {
          summaryLines.push(
            `Registry missing: ${missingFromRegistry.join(', ')}.`,
          );
        }
        if (valid.length === 0 && unknown.length === 0) {
          summaryLines.push(
            `No categories provided. Known: ${TOOL_CATEGORY_IDS.join(', ')}.`,
          );
        }

        return {
          summary: summaryLines.join(' '),
          data: {
            requested,
            loaded: valid,
            added: addedNames,
            alreadyActive: alreadyActiveNames,
            rejected: unknown,
            missing: missingFromRegistry,
            rules: loadedRules,
          },
        };
      },
    },
  ];
}
