import * as fs from 'fs';
import { AgentRuntimeConfig, AgentSkill, AgentToolDefinition } from './AgentTypes';
import { PRIMARY_PROVIDER_ID } from '../../shared/types/model';
import { APP_WORKSPACE_ROOT, resolveWorkspacePath } from '../workspaceRoot';
import {
  ALWAYS_ON_SOURCE_VALIDATION_RULE,
  CONSTRAINT_LEDGER_PROTOCOL,
  DETERMINISTIC_VALIDATION_OVERRIDE_RULE,
  PHYSICAL_TASK_COMPLETION_PROTOCOL,
  STRICT_SOURCE_VALIDATION_PROTOCOL,
  shouldUseStrictSourceValidation,
} from './sourceValidationPolicy';

const AGENT_CONTRACT_PATH = resolveWorkspacePath('AGENT.md');
const ALWAYS_ON_CONTRACT_SECTIONS = new Set([
  'Application Mental Model',
  'Runtime Path',
  'Operating Rules',
  'Result Validation Discipline',
  'Token Discipline',
  'Sub-Agent Rules',
  'Response Style',
]);

type CachedFileText = {
  path: string;
  mtimeMs: number;
  text: string;
};

let cachedContract: CachedFileText | null = null;

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
    const baseContract = buildBaseContract(readCachedContract());

    // For now, include skills if provided (backward compat).
    // Future: defer all skills to lazy loading, pass empty array by default.
    const skillText = input.skills.length > 0
      ? input.skills.map(skill => `\n\n## Skill: ${skill.name}\n\n${compactSkillBody(skill.body)}`).join('')
      : '\n\n## Skills\n\nNo task-specific skills loaded.';

    const toolText = input.tools.length > 0
      ? input.tools.map(tool => tool.name).join(', ')
      : 'No tools registered.';

    return [
      baseContract,
      `\n\n## Source Validation\n\n${ALWAYS_ON_SOURCE_VALIDATION_RULE}`,
      `\n\n## Constraint Ledger\n\n${CONSTRAINT_LEDGER_PROTOCOL}`,
      `\n\n## Deterministic Validation Authority\n\n${DETERMINISTIC_VALIDATION_OVERRIDE_RULE}`,
      `\n\n## Physical Task Completion\n\n${PHYSICAL_TASK_COMPLETION_PROTOCOL}`,
      shouldUseStrictSourceValidation(input.config.task)
        ? `\n\n## Strict Source Validation Protocol\n\n${STRICT_SOURCE_VALIDATION_PROTOCOL}`
        : '',
      `\n\n## Active Runtime\n\nMode: ${input.config.mode}\nRole: ${input.config.role}\nAgent ID: ${input.config.agentId}\n${buildCurrentDateTimeLine()}`,
      `\n\n## Workspace Root\n\nAbsolute workspace root: ${APP_WORKSPACE_ROOT}\nResolve relative repository paths from this root unless a tool result explicitly reports a different cwd.${input.config.cwd ? `\nCurrent working directory: ${input.config.cwd}` : ''}`,
      input.config.systemPromptAddendum?.trim()
        ? `\n\n## Additional Invocation Instructions\n\n${input.config.systemPromptAddendum.trim()}`
        : '',
      '\n\n## Tool Scope Recovery\n\nIf the current tool scope appears too narrow for the task, inspect the available packs with runtime.list_tool_packs, then expand with runtime.request_tool_pack. Do this immediately when the current tool subset is missing a browser, filesystem, terminal, chat, or subagent capability you need.',
      input.config.agentId === PRIMARY_PROVIDER_ID
        ? '\n\n## V2 Tool Priority\n\nYou are running inside V2 Workspace. All browser, filesystem, terminal, and research operations must go through the v2 MCP tools listed in your tool scope. These tools are first-class — they operate the real app-owned browser, real filesystem, and real terminal surfaces.\n\nDo not use any Codex-native capabilities: no built-in web search, no native file access, no built-in shell execution, no native browser control. If you need a capability not in your current tool scope, use runtime.list_tool_packs to find the right pack, then runtime.request_tool_pack to load it. Every action must produce a v2 tool record.'
        : '',
      `\n\n## Available Tools\n\nTool schemas are provided separately. Available tool names: ${toolText}`,
      skillText,
    ].join('');
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

function buildCurrentDateTimeLine(): string {
  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const local = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(now);

  return `Current date/time: ${local} (${timeZone}). Use this as the authoritative current date/time context for relative-date reasoning and freshness checks.`;
}

export function buildResponseStyleAddendum(task: string): string {
  const normalized = task.toLowerCase();
  if (/\b(review|audit|regression|pull request|diff|requested changes|code review)\b/.test(normalized)) {
    return [
      'For review and audit tasks, produce the final answer in this order:',
      '1. Findings first, ordered by severity.',
      '2. Each finding must include a file reference when available.',
      '3. Keep the change summary brief and only after findings.',
      '4. If no findings were found, say that explicitly.',
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
