import * as fs from 'fs';
import { AgentRuntimeConfig, AgentSkill, AgentToolDefinition } from './AgentTypes';
import { GEMINI_PROVIDER_ID, PRIMARY_PROVIDER_ID } from '../../shared/types/model';
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

const AGENT_CONTRACT_PATH = resolveWorkspacePath('AGENTS.md');
const PLANNING_CONTRACT_PATH = resolveWorkspacePath('PLANS.md');
const ALWAYS_ON_CONTRACT_SECTIONS = new Set([
  'Application Mental Model',
  'Runtime Path',
  'Operating Rules',
  'Result Validation Discipline',
  'Token Discipline',
  'Sub-Agent Rules',
  'Skill Loading',
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
    const cachedTemplate = systemPromptTemplateCache.get(templateKey);
    if (cachedTemplate) {
      return cachedTemplate.replace('__CURRENT_DATETIME__', buildCurrentDateTimeLine(input.config.agentId));
    }

    const baseContract = buildBaseContract(readCachedContract());
    const planningContract = shouldIncludePlanningContract(input.config.task)
      ? buildPlanningContract(readCachedPlanningContract())
      : '';
    const skillText = buildSkillPromptSection(input.skills);
    const toolText = buildToolPromptSummary(input.tools);
    const browserSurfaceText = buildBrowserSurfacePromptSection(input.tools);
    const providerToolPriorityText = buildProviderToolPrioritySection(input.config.agentId);
    const geminiExecutionText = buildGeminiExecutionPromptSection(input.config.agentId, input.tools);

    const template = [
      baseContract,
      planningContract ? `\n\n## Planning Contract\n\n${planningContract}` : '',
      `\n\n## Source Validation\n\n${ALWAYS_ON_SOURCE_VALIDATION_RULE}`,
      `\n\n## Constraint Ledger\n\n${CONSTRAINT_LEDGER_PROTOCOL}`,
      `\n\n## Deterministic Validation Authority\n\n${DETERMINISTIC_VALIDATION_OVERRIDE_RULE}`,
      `\n\n## Physical Task Completion\n\n${PHYSICAL_TASK_COMPLETION_PROTOCOL}`,
      shouldUseStrictSourceValidation(input.config.task)
        ? `\n\n## Strict Source Validation Protocol\n\n${STRICT_SOURCE_VALIDATION_PROTOCOL}`
        : '',
      `\n\n## Active Runtime\n\nMode: ${input.config.mode}\nRole: ${input.config.role}\nAgent ID: ${input.config.agentId}\n__CURRENT_DATETIME__`,
      `\n\n## Workspace Root\n\nAbsolute workspace root: ${APP_WORKSPACE_ROOT}\nResolve relative repository paths from this root unless a tool result explicitly reports a different cwd.${input.config.cwd ? `\nCurrent working directory: ${input.config.cwd}` : ''}`,
      input.config.systemPromptAddendum?.trim()
        ? `\n\n## Additional Invocation Instructions\n\n${input.config.systemPromptAddendum.trim()}`
        : '',
      '\n\n## Tool Scope Recovery\n\nIf additional tools are authorized for the active run, use `runtime.load_tools` to request them by exact tool name.',
      providerToolPriorityText,
      geminiExecutionText,
      browserSurfaceText,
      '\n\n## Tool Scope Truth\n\nTreat the listed tools in this run as the authoritative execution surface. Do not assume hidden capabilities, and do not describe a tool path as available unless it appears in the current tool list or is added through the runtime tool-pack flow.',
      `\n\n## Available Tools\n\nTool schemas are provided separately. Available tool names: ${toolText}`,
      skillText,
    ].join('');

    systemPromptTemplateCache.set(templateKey, template);
    return template.replace('__CURRENT_DATETIME__', buildCurrentDateTimeLine(input.config.agentId));
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
  ].join('::');
}

function buildSkillPromptSection(skills: AgentSkill[]): string {
  if (skills.length === 0) {
    return '\n\n## Skills\n\nNo task-specific skills loaded.';
  }

  return skills.map(skill => `\n\n## Skill: ${skill.name}\n\n${compactSkillBody(skill.body)}`).join('');
}

function buildToolPromptSummary(tools: AgentToolDefinition[]): string {
  return tools.length > 0
    ? tools.map(tool => tool.name).join(', ')
    : 'No tools registered.';
}

function buildBrowserSurfacePromptSection(tools: AgentToolDefinition[]): string {
  if (!tools.some((tool) => tool.name.startsWith('browser.'))) {
    return '';
  }

  return '\n\n## Browser Surface Model\n\nThe V2 browser is an app-owned multi-tab workspace, not a stateless page fetcher.\n\n- Use `browser.get_tabs` to understand the tab set and `browser.get_state` to understand the active tab plus its current navigation state.\n- Use `browser.navigate` to change the current page in the active tab. Use `browser.create_tab` only when the user wants a new, separate, or additional tab.\n- Treat tab ids, active-tab state, and returned browser state as authoritative. Do not invent tab behavior that the tool result did not report.\n- `browser.close_all_tabs` is a standard reset operation. It always leaves one default Google homepage tab open and verifies that final state.\n- When the user asks to close all tabs, treat that remaining homepage tab as internal workspace hygiene. Do not mention it in the final answer unless the user asks for browser state details or it materially affects the task outcome.';
}

function buildProviderToolPrioritySection(agentId: string): string {
  if (agentId === PRIMARY_PROVIDER_ID) {
    return '\n\n## V2 Tool Priority\n\nYou are running inside V2 Workspace. All browser, filesystem, terminal, and research operations must go through the v2 tools in your current runtime scope. These tools are first-class — they operate the real app-owned browser, real filesystem, and real terminal surfaces.\n\nDo not use any Codex-native capabilities: no built-in web search, no native browser control. Every action must produce a v2 tool record.\n\nTool execution is provider-driven: select from the scoped tools exposed in this run, and rely on the host to execute them and return results.\n\n## Web Access Hard Rule\n\nNEVER use shell commands to access the internet. This means: never use python, python3, curl, wget, node, or any other shell command to make HTTP requests, fetch URLs, scrape web pages, call APIs, or retrieve any online content. This prohibition is absolute — no exceptions, no fallbacks.\n\nFor ANY task involving web search, browsing, looking something up, or retrieving online information:\n- Use `browser.research_search` for research tasks (searches and reads multiple pages)\n- Use `browser.navigate` + `browser.extract_page` for direct URL navigation\n- Use `browser.search_web` to open a search without reading results\n\nThese are the ONLY valid paths to web content. Do not fall back to shell commands.';
  }

  if (agentId === GEMINI_PROVIDER_ID) {
    return '\n\n## V2 Tool Priority\n\nYou are running inside V2 Workspace. Use only the scoped v2 tools in this run for browser, filesystem, terminal, and research work. Do not use provider-native search, browser control, or shell-based web access.\n\nEvery real action must produce a v2 tool record. Treat tool results and runtime validation as authoritative.\n\n## Web Access Hard Rule\n\nNever use shell commands to reach the internet. For web tasks use:\n- `browser.research_search` for research\n- `browser.navigate` + `browser.extract_page` for direct URLs\n- `browser.search_web` to open a search page';
  }

  return '';
}

function buildGeminiExecutionPromptSection(agentId: string, tools: AgentToolDefinition[]): string {
  if (agentId !== GEMINI_PROVIDER_ID || tools.length === 0) {
    return '';
  }

  return '\n\n## Gemini Execution Rules\n\n- Prefer the final answer as soon as the available evidence is sufficient.\n- If more evidence is required, request only the single minimal next tool call unless multiple calls are clearly independent and safe to parallelize.\n- Do not spend tool turns restating a plan when you can gather or use evidence instead.\n- After receiving decisive tool results or deterministic validation, stop and answer instead of continuing to explore.';
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

function buildCurrentDateTimeLine(agentId?: string): string {
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
