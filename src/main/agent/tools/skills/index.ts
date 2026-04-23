import { agentSkillLoader } from '../../AgentSkillLoader';
import { AgentToolContext, AgentToolDefinition, AgentToolName, AgentToolSchemaSummary } from '../../AgentTypes';
import { agentToolExecutor } from '../../AgentToolExecutor';
import { activeToolNames, addActiveTools } from '../../toolScopeState';

const SKILL_LOAD_DESCRIPTION = [
  'Load a task-specific skill by name and pull its operating procedure into the turn.',
  'Call this when one of the skills listed in the "Skills Available" section of the system prompt matches the current task.',
  'Returns the skill body (workflow + rules + preferred tools) and widens the active tool scope to cover the skill\'s preferred tools, bounded by the runtime\'s allowlist.',
].join(' ');

function objectInput(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
}

function requireSkillName(input: Record<string, unknown>): string {
  const raw = input.name;
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('skill.load requires a non-empty `name` input.');
  }
  return raw.trim();
}

function schemasForTools(names: AgentToolName[]): AgentToolSchemaSummary[] {
  const registered = new Map<AgentToolName, AgentToolSchemaSummary>();
  for (const tool of agentToolExecutor.list()) {
    registered.set(tool.name, {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    });
  }
  const summaries: AgentToolSchemaSummary[] = [];
  for (const name of names) {
    const summary = registered.get(name);
    if (summary) summaries.push(summary);
  }
  return summaries;
}

function clampAgainstRuntimeCap(
  candidates: AgentToolName[],
  runtimeAllowedTools: AgentToolContext['runtimeAllowedTools'],
): { allowed: AgentToolName[]; blockedByRuntime: AgentToolName[] } {
  if (!runtimeAllowedTools || runtimeAllowedTools === 'all') {
    return { allowed: [...candidates], blockedByRuntime: [] };
  }
  const cap = new Set<AgentToolName>(runtimeAllowedTools);
  const allowed: AgentToolName[] = [];
  const blocked: AgentToolName[] = [];
  for (const name of candidates) {
    if (cap.has(name)) allowed.push(name);
    else blocked.push(name);
  }
  return { allowed, blockedByRuntime: blocked };
}

export function createSkillToolDefinitions(): AgentToolDefinition[] {
  return [
    {
      name: 'skill.load',
      description: SKILL_LOAD_DESCRIPTION,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: {
            type: 'string',
            description: 'Directory name of the skill to load (e.g. "code-edit", "browser-operation").',
          },
        },
      },
      async execute(input, context) {
        const obj = objectInput(input);
        const name = requireSkillName(obj);

        const available = new Set(agentSkillLoader.listSkillNames());
        if (!available.has(name)) {
          const suggestions = Array.from(available).slice(0, 10).join(', ');
          return {
            summary: `Unknown skill: ${name}`,
            data: {
              error: 'unknown-skill',
              name,
              availableSkills: Array.from(available),
              hint: suggestions
                ? `Pick one of: ${suggestions}`
                : 'No skills are available in this workspace.',
            },
          };
        }

        const skill = agentSkillLoader.loadSkill(name);

        const { allowed, blockedByRuntime } = clampAgainstRuntimeCap(
          skill.allowedTools,
          context.runtimeAllowedTools,
        );
        const schemas = schemasForTools(allowed);

        let addedToolNames: AgentToolName[] = [];
        if (context.toolScope && schemas.length > 0) {
          addedToolNames = addActiveTools(context.toolScope, schemas);
        }

        const currentActive = context.toolScope
          ? activeToolNames(context.toolScope)
          : null;

        return {
          summary: `Loaded skill: ${skill.name}${
            addedToolNames.length > 0 ? ` (+${addedToolNames.length} tools unlocked)` : ''
          }`,
          data: {
            name: skill.name,
            description: skill.description,
            body: skill.body,
            references: skill.references,
            allowedTools: skill.allowedTools,
            addedTools: addedToolNames,
            blockedByRuntimeCap: blockedByRuntime,
            activeToolsAfterLoad: currentActive,
          },
        };
      },
    },
  ];
}
