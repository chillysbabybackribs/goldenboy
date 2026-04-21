import * as fs from 'fs';
import { AgentRuntimeConfig, AgentSkill, AgentToolDefinition } from './AgentTypes';
import { GEMINI_PROVIDER_ID } from '../../shared/types/model';
import { APP_WORKSPACE_ROOT, resolveWorkspacePath } from '../workspaceRoot';
import {
  ALWAYS_ON_SOURCE_VALIDATION_RULE,
  CONSTRAINT_LEDGER_PROTOCOL,
  DETERMINISTIC_VALIDATION_OVERRIDE_RULE,
  PHYSICAL_TASK_COMPLETION_PROTOCOL,
  STRICT_SOURCE_VALIDATION_PROTOCOL,
  shouldUseStrictSourceValidation,
} from './sourceValidationPolicy';
import { buildTaskProfile } from './taskProfile';
import { TOOL_CATEGORIES, TOOL_CATEGORY_IDS } from './toolCategories';
import { workspaceManifestService } from './workspaceManifest';

const AGENT_CONTRACT_PATH = resolveWorkspacePath('AGENTS.md');
const PLANNING_CONTRACT_PATH = resolveWorkspacePath('PLANS.md');
// Sections intentionally omitted and why:
// - 'Result Validation Discipline' : its classification rule, common failure
//   patterns, and probabilistic-vs-deterministic guardrails are fully re-stated
//   by the injected `DETERMINISTIC_VALIDATION_OVERRIDE_RULE` prompt section.
// - 'Runtime Path' : internal code-path architecture (CodexProvider →
//   AgentRuntime → ...). Zero model-facing decision value; the model calls
//   tools and V2 owns what happens inside.
// - 'Skill Loading' : runtime-facing meta-info about when to load skills and a
//   table of available skills. The runtime already resolves skill selection
//   before the prompt is built; the model only sees the skills actually loaded
//   (rendered in the separate `skills` section below).
const ALWAYS_ON_CONTRACT_SECTIONS = new Set([
  'Application Mental Model',
  'Operating Rules',
  'Token Discipline',
  'Sub-Agent Rules',
  'Response Style',
]);
const ALWAYS_ON_PLANNING_SECTIONS = new Set([
  'When To Use',
  'Planning Workflow',
  'Sub-Agent Design',
  'Execution Guardrails',
  'Output Contract',
]);

type CachedFileText = {
  path: string;
  mtimeMs: number;
  text: string;
};

let cachedContract: CachedFileText | null = null;
let cachedPlanningContract: CachedFileText | null = null;
const systemPromptTemplateCache = new Map<string, string>();

export class AgentPromptBuilder {
  /**
   * Lazy-load variant: builds minimal prompt without skills.
   * Skills are compiled on demand in subsequent turns via buildSkillsForNames().
   */
  buildSystemPrompt(input: {
    config: AgentRuntimeConfig;
    skills: AgentSkill[];
    tools: AgentToolDefinition[];
  }): string {
    const templateKey = buildSystemPromptTemplateKey(input);
    const cached = systemPromptTemplateCache.get(templateKey);
    if (cached) return cached;

    const sections = buildSystemPromptSectionEntries(input);
    const template = sections.map((section) => section.text).join('');

    systemPromptTemplateCache.set(templateKey, template);
    return template;
  }

  /**
   * Returns per-section byte measurements for the system prompt produced by
   * `buildSystemPrompt` with the same inputs. Purely diagnostic — does NOT
   * touch or invalidate the template cache. The measured text includes
   * datetime substitution so lengths match the actual send payload.
   */
  describeSystemPromptSections(input: {
    config: AgentRuntimeConfig;
    skills: AgentSkill[];
    tools: AgentToolDefinition[];
  }): SystemPromptBreakdown {
    const sections = buildSystemPromptSectionEntries(input);
    const entries: SystemPromptSectionEntry[] = sections.map((section) => ({
      name: section.name,
      chars: section.text.length,
    }));
    const total = entries.reduce((acc, entry) => acc + entry.chars, 0);
    return { sections: entries, total };
  }

  /**
   * Builds skill text for requested skill names.
   * Use this to lazily append skills to context in later turns.
   */
  buildSkillsForNames(skillNames: string[], allSkills: AgentSkill[]): string {
    if (!skillNames || skillNames.length === 0) return '';

    const skillMap = new Map(allSkills.map(s => [s.name, s]));
    const available = skillNames
      .map(name => skillMap.get(name))
      .filter((skill): skill is AgentSkill => skill !== undefined);

    if (available.length === 0) return '';

    return available
      .map(skill => `## Skill: ${skill.name}\n\n${compactSkillBody(skill.body)}`)
      .join('\n\n');
  }
}

export const agentPromptBuilder = new AgentPromptBuilder();

export type SystemPromptSectionEntry = {
  name: string;
  chars: number;
};

export type SystemPromptBreakdown = {
  sections: SystemPromptSectionEntry[];
  total: number;
};

type SystemPromptSection = {
  name: string;
  text: string;
};

function buildSystemPromptSectionEntries(
  input: {
    config: AgentRuntimeConfig;
    skills: AgentSkill[];
    tools: AgentToolDefinition[];
  },
): SystemPromptSection[] {
  const baseContract = buildBaseContract(readCachedContract());
  const planningContract = shouldIncludePlanningContract(input.config.task)
    ? buildPlanningContract(readCachedPlanningContract())
    : '';
  const skillText = buildSkillPromptSection(input.skills);
  const toolMapText = buildToolCategoryMapSection(input.tools);

  return [
    { name: 'baseContract', text: baseContract },
    {
      name: 'planningContract',
      text: planningContract ? `\n\n## Planning Contract\n\n${planningContract}` : '',
    },
    {
      name: 'sourceValidation',
      text: `\n\n## Source Validation\n\n${ALWAYS_ON_SOURCE_VALIDATION_RULE}`,
    },
    {
      name: 'constraintLedger',
      text: `\n\n## Constraint Ledger\n\n${CONSTRAINT_LEDGER_PROTOCOL}`,
    },
    {
      name: 'deterministicValidation',
      text: `\n\n## Deterministic Validation Authority\n\n${DETERMINISTIC_VALIDATION_OVERRIDE_RULE}`,
    },
    {
      name: 'physicalTaskCompletion',
      text: `\n\n## Physical Task Completion\n\n${PHYSICAL_TASK_COMPLETION_PROTOCOL}`,
    },
    {
      name: 'strictSourceValidation',
      text: shouldUseStrictSourceValidation(input.config.task)
        ? `\n\n## Strict Source Validation Protocol\n\n${STRICT_SOURCE_VALIDATION_PROTOCOL}`
        : '',
    },
    {
      name: 'activeRuntime',
      text: `\n\n## Active Runtime\n\nMode: ${input.config.mode}\nRole: ${input.config.role}\nAgent ID: ${input.config.agentId}\nCurrent date/time is provided in the user-turn runtime context below.`,
    },
    {
      name: 'workspaceRoot',
      text: `\n\n## Workspace Root\n\nAbsolute workspace root: ${APP_WORKSPACE_ROOT}\nResolve relative repository paths from this root unless a tool result explicitly reports a different cwd.${input.config.cwd ? `\nCurrent working directory: ${input.config.cwd}` : ''}`,
    },
    {
      name: 'workspaceOverview',
      text: buildWorkspaceOverviewSection(),
    },
    {
      name: 'additionalInvocationInstructions',
      text: input.config.systemPromptAddendum?.trim()
        ? `\n\n## Additional Invocation Instructions\n\n${input.config.systemPromptAddendum.trim()}`
        : '',
    },
    { name: 'toolCategoryMap', text: toolMapText },
    { name: 'skills', text: skillText },
  ];
}

function buildSystemPromptTemplateKey(input: {
  config: AgentRuntimeConfig;
  skills: AgentSkill[];
  tools: AgentToolDefinition[];
}): string {
  const contractVersion = readCachedContractVersion();
  const planningContractVersion = shouldIncludePlanningContract(input.config.task)
    ? readCachedPlanningContractVersion()
    : 'no-plans';
  const strictValidation = shouldUseStrictSourceValidation(input.config.task) ? 'strict' : 'default';
  const skillSignature = input.skills.length > 0
    ? input.skills.map(skill => `${skill.name}:${skill.path}:${skill.body}`).join('|')
    : 'no-skills';
  const toolSignature = input.tools.length > 0
    ? input.tools.map(tool => tool.name).join('|')
    : 'no-tools';

  return [
    contractVersion,
    planningContractVersion,
    input.config.mode,
    input.config.role,
    input.config.agentId,
    input.config.cwd ?? '',
    input.config.systemPromptAddendum?.trim() ?? '',
    strictValidation,
    toolSignature,
    skillSignature,
    workspaceManifestService.getVersion(APP_WORKSPACE_ROOT),
  ].join('::');
}

function buildSkillPromptSection(skills: AgentSkill[]): string {
  if (skills.length === 0) {
    return '\n\n## Skills\n\nNo task-specific skills loaded.';
  }

  return skills.map(skill => `\n\n## Skill: ${skill.name}\n\n${compactSkillBody(skill.body)}`).join('');
}

function buildWorkspaceOverviewSection(): string {
  const overview = workspaceManifestService.getOverviewSync(APP_WORKSPACE_ROOT, {
    maxDepth: 3,
    maxChars: 4000,
  });
  if (!overview) return '';
  return [
    '',
    '',
    '## Workspace Overview',
    '',
    'Directory map of the current workspace with extracted purpose lines (first JSDoc / markdown heading / frontmatter description). Use this to self-locate before grepping or listing directories. Purpose lines are best-effort — treat them as hints, not contracts.',
    '',
    'When a prompt references an unfamiliar area, call `workspace.locate` with the concept keywords before opening files. Call `workspace.tree` for a deeper slice of a single subtree.',
    '',
    '```',
    overview,
    '```',
  ].join('\n');
}

function buildToolCategoryMapSection(tools: AgentToolDefinition[]): string {
  const activeCategories = new Set<string>();
  for (const tool of tools) {
    const dot = tool.name.indexOf('.');
    if (dot > 0) activeCategories.add(tool.name.slice(0, dot));
  }

  const categoryLines = TOOL_CATEGORY_IDS.map((id) => {
    const desc = TOOL_CATEGORIES[id];
    const marker = activeCategories.has(id) ? '[active]' : '[inactive]';
    return `- \`${id}\` ${marker} — ${desc.summary}`;
  }).join('\n');

  return [
    '',
    '',
    '## Tool Map',
    '',
    'Every tool listed in your tool schema is already active for this run — there is no lazy-load / `context.load` bootstrap step. Call any tool directly by name. The categories below are informational groupings so you can see the surface at a glance.',
    '',
    categoryLines,
    '',
    '### Navigation rules',
    '',
    '- Never use shell/terminal commands to reach the internet. Use `browser.*` tools for any web work.',
    '- Do not invent tools. If a needed capability is not in your tool schema, answer without it or ask the user.',
    '- Stop calling tools once the evidence is sufficient to answer.',
  ].join('\n');
}

function readCachedContract(): string {
  if (!fs.existsSync(AGENT_CONTRACT_PATH)) return 'V2 agent contract file is missing.';

  const stat = fs.statSync(AGENT_CONTRACT_PATH);
  if (cachedContract && cachedContract.path === AGENT_CONTRACT_PATH && cachedContract.mtimeMs === stat.mtimeMs) {
    return cachedContract.text;
  }

  const text = fs.readFileSync(AGENT_CONTRACT_PATH, 'utf-8');
  cachedContract = {
    path: AGENT_CONTRACT_PATH,
    mtimeMs: stat.mtimeMs,
    text,
  };
  return text;
}

function readCachedContractVersion(): string {
  if (!fs.existsSync(AGENT_CONTRACT_PATH)) return `${AGENT_CONTRACT_PATH}:missing`;
  const stat = fs.statSync(AGENT_CONTRACT_PATH);
  return `${AGENT_CONTRACT_PATH}:${stat.mtimeMs}`;
}

function readCachedPlanningContract(): string {
  if (!fs.existsSync(PLANNING_CONTRACT_PATH)) return 'Planning contract file is missing.';

  const stat = fs.statSync(PLANNING_CONTRACT_PATH);
  if (
    cachedPlanningContract
    && cachedPlanningContract.path === PLANNING_CONTRACT_PATH
    && cachedPlanningContract.mtimeMs === stat.mtimeMs
  ) {
    return cachedPlanningContract.text;
  }

  const text = fs.readFileSync(PLANNING_CONTRACT_PATH, 'utf-8');
  cachedPlanningContract = {
    path: PLANNING_CONTRACT_PATH,
    mtimeMs: stat.mtimeMs,
    text,
  };
  return text;
}

function readCachedPlanningContractVersion(): string {
  if (!fs.existsSync(PLANNING_CONTRACT_PATH)) return `${PLANNING_CONTRACT_PATH}:missing`;
  const stat = fs.statSync(PLANNING_CONTRACT_PATH);
  return `${PLANNING_CONTRACT_PATH}:${stat.mtimeMs}`;
}

function buildBaseContract(contract: string): string {
  const sections = parseMarkdownSections(contract);
  if (sections.length === 0) return contract;

  const intro = sections.find(section => section.headingLevel === 1);
  const kept = sections.filter(section =>
    section.headingLevel === 2 && ALWAYS_ON_CONTRACT_SECTIONS.has(section.heading),
  );

  return [
    intro?.content.trim() ?? '',
    ...kept.map(section => section.content.trim()),
  ]
    .filter(Boolean)
    .join('\n\n');
}

function buildPlanningContract(contract: string): string {
  const sections = parseMarkdownSections(contract);
  if (sections.length === 0) return contract;

  const intro = sections.find(section => section.headingLevel === 1);
  const kept = sections.filter(section =>
    section.headingLevel === 2 && ALWAYS_ON_PLANNING_SECTIONS.has(section.heading),
  );

  return [
    intro?.content.trim() ?? '',
    ...kept.map(section => section.content.trim()),
  ]
    .filter(Boolean)
    .join('\n\n');
}

function shouldIncludePlanningContract(task: string): boolean {
  return buildTaskProfile(task).kind === 'orchestration';
}

function compactSkillBody(body: string): string {
  const sections = parseMarkdownSections(body);
  if (sections.length === 0) return body.trim();

  const intro = sections.find(section => section.headingLevel === 1);
  const workflow = sections.find(section => section.headingLevel === 2 && section.heading === 'Workflow');
  const preferredTools = sections.find(section => section.headingLevel === 2 && section.heading === 'Preferred Tools');

  return [
    intro?.content.trim() ?? '',
    workflow ? normalizeListSection(workflow.content.trim()) : '',
    preferredTools ? normalizeListSection(preferredTools.content.trim()) : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

type MarkdownSection = {
  heading: string;
  headingLevel: number;
  content: string;
};

function parseMarkdownSections(markdown: string): MarkdownSection[] {
  const lines = markdown.split('\n');
  const sections: MarkdownSection[] = [];
  let currentHeading = '';
  let currentLevel = 0;
  let currentLines: string[] = [];

  const flush = (): void => {
    if (!currentHeading && currentLevel === 0 && currentLines.length === 0) return;
    sections.push({
      heading: currentHeading,
      headingLevel: currentLevel,
      content: currentLines.join('\n').trim(),
    });
  };

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match) {
      flush();
      currentLevel = match[1].length;
      currentHeading = match[2].trim();
      currentLines = [line];
      continue;
    }
    currentLines.push(line);
  }

  flush();
  return sections.filter(section => section.content);
}

function normalizeListSection(section: string): string {
  return section
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trim();
}

/**
 * Builds the volatile current-date/time line that is now injected into the
 * user-turn context block (outside the cached system prompt). Keeping it out
 * of the system block is critical: the Anthropic ephemeral cache breakpoints
 * only match when the system text is byte-identical across turns, and any
 * minute-precision substring busts that invariant.
 */
export function buildCurrentDateTimeLine(agentId?: string): string {
  if (agentId === GEMINI_PROVIDER_ID) {
    return 'Current date/time should be inferred from runtime-provided dates, browser evidence, and explicit task context. Do not rely on a volatile timestamp string when stable evidence is available.';
  }
  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const local = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(now);

  return `Current date/time: ${local} (${timeZone}). Use this as the authoritative current date/time context for relative-date reasoning and freshness checks.`;
}

export function buildResponseStyleAddendum(task: string): string {
  const normalized = task.toLowerCase();
  if (buildTaskProfile(task).kind === 'orchestration') {
    return [
      'For orchestration and complex planning tasks:',
      '1. Keep the plan compact and executable.',
      '2. Separate objective, tracks, delegation, validation, and immediate next action.',
      '3. Keep the parent on the critical path and delegate only bounded independent subtasks.',
      '4. If the user asked to execute, move from plan to execution once the next action is clear.',
      '5. Do not produce long speculative strategy text when concrete execution can begin.',
    ].join('\n');
  }

  if (/\b(search(?: the web| online)?|look up|lookup|find online|research|latest|current|browser|tab|tabs|page|pages|url|navigate|visit|click|type|form|login|upload|download|automation)\b/.test(normalized)) {
    return [
      'For browser, research, and web tasks:',
      '1. Do not narrate your plan or restate obvious tool actions.',
      '2. Keep interim text to zero or one short sentence before tool calls; prefer no interim text when the next step is obvious from the tool call.',
      '3. As soon as observed browser evidence or verified tool results satisfy the task, stop calling tools and produce the final answer immediately.',
      '4. Do not add an extra recap after the task is complete.',
      '5. Keep the final answer concise and focused on the result, not the tool trace.',
    ].join('\n');
  }

  if (/\b(review|regression|pull request|diff|requested changes|code review)\b/.test(normalized)) {
    return [
      'For review and audit tasks, produce the final answer in this order:',
      '1. Findings first, ordered by severity.',
      '2. Each finding must include a file reference when available.',
      '3. Keep the change summary brief and only after findings.',
      '4. If no findings were found, say that explicitly.',
      'Do not narrate the tool trace in the final answer.',
    ].join('\n');
  }

  if (/\b(audit|architecture review|system review|workflow review|prompt review|tool review)\b/.test(normalized)) {
    return [
      'For audit tasks that are not code-review requests, produce the final answer in this order:',
      '1. Current state and the main tensions or conflicts.',
      '2. Concrete recommendations, ordered by leverage.',
      '3. Risks, open questions, or follow-up changes.',
      'Use findings-first severity ordering only when the user is explicitly asking for code review, regressions, or defects.',
      'Do not narrate the tool trace in the final answer.',
    ].join('\n');
  }

  if (/\b(debug|diagnose|investigate|troubleshoot|root cause|failing|crash|error|exception)\b/.test(normalized)) {
    return [
      'For debugging tasks, produce the final answer in this order:',
      '1. Root cause or strongest current hypothesis.',
      '2. Evidence from observed files, commands, or runtime state.',
      '3. Fix or next action.',
      'Do not narrate the tool trace in the final answer.',
    ].join('\n');
  }

  return '';
}
