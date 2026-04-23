import * as fs from 'fs';
import { AgentRuntimeConfig, AgentSkill, AgentToolDefinition } from './AgentTypes';
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
export { buildResponseStyleAddendum } from './agentPersonality';

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
  'Structured Response Format',
  'Application Mental Model',
  'Operating Rules',
]);
const ALWAYS_ON_PLANNING_SECTIONS = new Set([
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
   * Builds the system prompt for the current run.
   *
   * The model sees two skill-related sections:
   *
   *   1. `## Skills Available` — an index of every skill on disk (name +
   *      one-line description). The model consults this to decide which skill
   *      to load via the `skill.load` tool when the task calls for it.
   *   2. `## Skills` — the bodies of any skills the runtime eagerly selected
   *      (via `config.skillNames` or taskProfile). These are pre-loaded
   *      operating procedures the runtime is confident will apply.
   *
   * Skill selection is split: the runtime optionally eager-loads a small set,
   * and the model can load more on demand through `skill.load`. This matches
   * the Anthropic Agent Skills progressive-disclosure pattern.
   */
  buildSystemPrompt(input: {
    config: AgentRuntimeConfig;
    skills: AgentSkill[];
    availableSkills?: AgentSkill[];
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
    availableSkills?: AgentSkill[];
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
    availableSkills?: AgentSkill[];
    tools: AgentToolDefinition[];
  },
): SystemPromptSection[] {
  const taskProfile = buildTaskProfile(input.config.task, input.config.taskProfileOverride);
  const baseContract = buildBaseContract(readCachedContract());
  const planningContract = shouldIncludePlanningContractForProfile(taskProfile)
    ? buildPlanningContract(readCachedPlanningContract())
    : '';
  const executionModeText = buildExecutionModeSection(taskProfile);
  const hasSkillLoadTool = input.tools.some((tool) => tool.name === 'skill.load');
  const skillIndexText = hasSkillLoadTool
    ? buildSkillIndexSection(input.availableSkills ?? [], input.skills)
    : '';
  const skillText = buildSkillPromptSection(input.skills);
  const toolMapText = buildToolCategoryMapSection(input.tools);
  const workspaceOverviewText = shouldIncludeWorkspaceOverview(input.tools)
    ? buildWorkspaceOverviewSection()
    : '';

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
      name: 'executionMode',
      text: executionModeText,
    },
    {
      name: 'workspaceRoot',
      text: `\n\n## Workspace Root\n\nAbsolute workspace root: ${APP_WORKSPACE_ROOT}\nResolve relative repository paths from this root unless a tool result explicitly reports a different cwd.${input.config.cwd ? `\nCurrent working directory: ${input.config.cwd}` : ''}`,
    },
    {
      name: 'workspaceOverview',
      text: workspaceOverviewText,
    },
    {
      name: 'additionalInvocationInstructions',
      text: input.config.systemPromptAddendum?.trim()
        ? `\n\n## Additional Invocation Instructions\n\n${input.config.systemPromptAddendum.trim()}`
        : '',
    },
    {
      name: 'finalizingAnswer',
      text: buildFinalizingAnswerSection(input.tools),
    },
    { name: 'toolCategoryMap', text: toolMapText },
    { name: 'skillsAvailable', text: skillIndexText },
    { name: 'skills', text: skillText },
  ];
}

function buildFinalizingAnswerSection(tools: AgentToolDefinition[]): string {
  const hasAnswerSubmit = tools.some((tool) => tool.name === 'answer.submit');
  if (!hasAnswerSubmit) return '';
  return [
    '',
    '## Finalizing Your Answer',
    '',
    'When the task is complete, finish by calling `answer.submit` with `{ claims, unresolved }`.',
    'Every claim must include at least one `evidence` entry that references a real prior tool call id from this run.',
    'Use `unresolved` for anything you could not ground in a validated tool result.',
    'Ungrounded or weakly grounded claims will fail the gate and require revision.',
  ].join('\n');
}

function buildSystemPromptTemplateKey(input: {
  config: AgentRuntimeConfig;
  skills: AgentSkill[];
  availableSkills?: AgentSkill[];
  tools: AgentToolDefinition[];
}): string {
  const taskProfile = buildTaskProfile(input.config.task, input.config.taskProfileOverride);
  const contractVersion = readCachedContractVersion();
  const planningContractVersion = shouldIncludePlanningContractForProfile(taskProfile)
    ? readCachedPlanningContractVersion()
    : 'no-plans';
  const strictValidation = shouldUseStrictSourceValidation(input.config.task) ? 'strict' : 'default';
  const skillSignature = input.skills.length > 0
    ? input.skills.map(skill => `${skill.name}:${skill.path}:${skill.body}`).join('|')
    : 'no-skills';
  const availableSkillSignature = input.availableSkills && input.availableSkills.length > 0
    ? input.availableSkills.map(skill => `${skill.name}:${skill.description}`).join('|')
    : 'no-available-skills';
  const toolSignature = input.tools.length > 0
    ? input.tools.map(tool => tool.name).join('|')
    : 'no-tools';

  return [
    contractVersion,
    planningContractVersion,
    taskProfile.kind,
    taskProfile.executionMode,
    input.config.task,
    input.config.mode,
    input.config.role,
    input.config.agentId,
    input.config.cwd ?? '',
    input.config.systemPromptAddendum?.trim() ?? '',
    strictValidation,
    input.config.taskProfileOverride ? JSON.stringify(input.config.taskProfileOverride) : '',
    toolSignature,
    skillSignature,
    availableSkillSignature,
    workspaceManifestService.getVersion(APP_WORKSPACE_ROOT),
  ].join('::');
}

function buildExecutionModeSection(profile: ReturnType<typeof buildTaskProfile>): string {
  const modeGuidance = (() => {
    switch (profile.executionMode) {
      case 'staged':
        return 'This work is staged. Keep the plan compact, execute in bounded slices, and verify between slices.';
      case 'orchestration':
        return 'This work is orchestration. Keep the parent on the critical path and delegate only bounded independent subtasks.';
      case 'single-pass':
      default:
        return 'This turn is eligible for direct execution if the runtime tool scope and user request support it.';
    }
  })();

  return [
    '',
    '',
    '## Execution Mode',
    '',
    `Task kind: ${profile.kind}`,
    `Execution mode: ${profile.executionMode}`,
    modeGuidance,
  ].join('\n');
}

function shouldIncludePlanningContractForProfile(profile: ReturnType<typeof buildTaskProfile>): boolean {
  return profile.kind === 'orchestration';
}

function buildSkillPromptSection(skills: AgentSkill[]): string {
  if (skills.length === 0) {
    return '\n\n## Skills\n\nNo task-specific skills loaded.';
  }

  return [
    '\n\n## Skills',
    '',
    'If one or more skills are loaded for this turn, treat them as the operating procedure for the task unless the user explicitly overrides them.',
    ...skills.map(skill => `\n## Skill: ${skill.name}\n\n${compactSkillBody(skill.body)}`),
  ].join('\n');
}

/**
 * Render the skill index — a compact `name — description` list the model uses
 * to decide which skill to load via `skill.load`. Skills already eager-loaded
 * for this turn are marked so the model doesn't reload them redundantly.
 */
function buildSkillIndexSection(
  availableSkills: AgentSkill[],
  eagerlyLoaded: AgentSkill[],
): string {
  if (availableSkills.length === 0) return '';
  const eagerNames = new Set(eagerlyLoaded.map((skill) => skill.name));

  const lines = availableSkills.map((skill) => {
    const marker = eagerNames.has(skill.name) ? ' [already loaded]' : '';
    const description = skill.description.trim() || 'No description provided.';
    return `- \`${skill.name}\`${marker} — ${description}`;
  });

  return [
    '',
    '',
    '## Skills Available',
    '',
    'Load a skill when its description matches the task.',
    '',
    ...lines,
    '',
    'Rules:',
    '- Load a matching skill before starting work; do not proceed from memory.',
    '- You may load multiple skills if the task spans domains.',
    '- Skills do not expand permissions beyond the runtime cap.',
  ].join('\n');
}

function buildWorkspaceOverviewSection(): string {
  const overview = workspaceManifestService.getOverviewSync(APP_WORKSPACE_ROOT, {
    maxDepth: 3,
    maxChars: 1200,
  });
  if (!overview) return '';
  return [
    '',
    '',
    '## Workspace Overview',
    '',
    'Compact directory map of the workspace. Use it to self-locate before broader file reads.',
    '',
    'Call `workspace.locate` for unfamiliar areas and `workspace.tree` for a deeper slice of one subtree.',
    '',
    '```',
    overview,
    '```',
  ].join('\n');
}

function shouldIncludeWorkspaceOverview(tools: AgentToolDefinition[]): boolean {
  return tools.some((tool) => (
    tool.name.startsWith('filesystem.')
    || tool.name.startsWith('repomap.')
    || tool.name.startsWith('workspace.')
    || tool.name.startsWith('terminal.')
    || tool.name.startsWith('subagent.')
  ));
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
    'Every tool in your schema is already active for this run. Categories below are informational only.',
    '',
    categoryLines,
    '',
    '### Navigation rules',
    '',
    '- Use `browser.*` for web work; do not use shell/terminal commands to reach the internet.',
    '- Do not invent tools.',
    '- Stop once the evidence is sufficient to answer.',
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
  const rules = sections.find(section => section.headingLevel === 2 && section.heading === 'Rules');
  const preferredTools = sections.find(section => section.headingLevel === 2 && section.heading === 'Preferred Tools');

  return [
    intro?.content.trim() ?? '',
    workflow ? normalizeListSection(workflow.content.trim()) : '',
    rules ? normalizeListSection(rules.content.trim()) : '',
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
 * of the system block is critical: prompt-cache breakpoints
 * only match when the system text is byte-identical across turns, and any
 * minute-precision substring busts that invariant.
 */
export function buildCurrentDateTimeLine(agentId?: string): string {
  void agentId;
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
