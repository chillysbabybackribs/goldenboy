import type { AgentToolName } from './AgentTypes';
import type { AgentTaskKind, AgentTaskProfileOverride } from '../../shared/types/model';
import { shouldUseStrictSourceValidation } from './sourceValidationPolicy';
import { DEFAULT_TOOL_PACK_PRESET, resolveAllowedToolsForTaskKind } from './toolPacks';

export type AgentTaskProfile = {
  kind: AgentTaskKind;
  skillNames: string[];
  allowedTools: 'all' | AgentToolName[];
  canSpawnSubagents: boolean;
  maxToolTurns: number;
  requiresBrowserSearchDirective: boolean;
};

const DEFAULT_MAX_TOOL_TURNS = 20;
const STRICT_VALIDATION_MAX_TOOL_TURNS = 32;
const DEBUG_MAX_TOOL_TURNS = 28;
const REVIEW_MAX_TOOL_TURNS = 24;
const DELEGATION_MAX_TOOL_TURNS = 40;

function maxTurnsForPrompt(prompt: string): number {
  return shouldUseStrictSourceValidation(prompt)
    ? STRICT_VALIDATION_MAX_TOOL_TURNS
    : DEFAULT_MAX_TOOL_TURNS;
}

export function buildTaskProfile(prompt: string, overrides?: AgentTaskProfileOverride): AgentTaskProfile {
  const kind = resolveTaskKind(prompt, overrides);
  const toolPackPreset = overrides?.toolPackPreset ?? DEFAULT_TOOL_PACK_PRESET;
  const base = defaultTaskProfileForKind(kind, prompt, toolPackPreset);
  return {
    ...base,
    skillNames: overrides?.skillNames ? [...overrides.skillNames] : base.skillNames,
    canSpawnSubagents: overrides?.canSpawnSubagents ?? base.canSpawnSubagents,
    maxToolTurns: overrides?.maxToolTurns ?? base.maxToolTurns,
    requiresBrowserSearchDirective: overrides?.requiresBrowserSearchDirective ?? base.requiresBrowserSearchDirective,
  };
}

export function withBrowserSearchDirective(prompt: string, overrides?: AgentTaskProfileOverride): string {
  if (!buildTaskProfile(prompt, overrides).requiresBrowserSearchDirective) return prompt;
  return [
    'Runtime directive: This is a browser-search task. You must call browser.research_search first with the user query. Let it open/cache one result at a time and stop when enough evidence is found. Use only browser-observed search results, cached page chunks, or pages opened in the owned browser as evidence. Do not answer from model memory or provider-native search.',
    '',
    `User request: ${prompt}`,
  ].join('\n');
}

function normalizeTaskKind(kind: AgentTaskKind): AgentTaskKind {
  switch (kind) {
    case 'delegation':
      return 'orchestration';
    case 'browser-search':
      return 'research';
    case 'browser-automation':
      return 'browser-automation';
    case 'local-code':
      return 'implementation';
    default:
      return kind;
  }
}

function resolveTaskKind(prompt: string, overrides?: AgentTaskProfileOverride): AgentTaskKind {
  if (overrides?.kind) return normalizeTaskKind(overrides.kind);
  if (looksLikeOrchestrationTask(prompt)) return 'orchestration';
  if (looksLikeResearchTask(prompt)) return 'research';
  if (looksLikeReviewTask(prompt)) return 'review';
  if (looksLikeDebugTask(prompt)) return 'debug';
  if (looksLikeBrowserAutomationTask(prompt)) return 'browser-automation';
  if (looksLikeImplementationTask(prompt)) return 'implementation';
  return 'general';
}

function defaultTaskProfileForKind(
  kind: AgentTaskKind,
  prompt: string,
  toolPackPreset = DEFAULT_TOOL_PACK_PRESET,
): AgentTaskProfile {
  switch (normalizeTaskKind(kind)) {
    case 'orchestration':
      return {
        kind: 'orchestration',
        skillNames: [],
        allowedTools: resolveAllowedToolsForTaskKind('orchestration', toolPackPreset),
        canSpawnSubagents: true,
        maxToolTurns: DELEGATION_MAX_TOOL_TURNS,
        requiresBrowserSearchDirective: false,
      };
    case 'research':
      return {
        kind: 'research',
        skillNames: [],
        allowedTools: resolveAllowedToolsForTaskKind('research', toolPackPreset),
        canSpawnSubagents: false,
        maxToolTurns: maxTurnsForPrompt(prompt),
        requiresBrowserSearchDirective: true,
      };
    case 'browser-automation':
      return {
        kind: 'browser-automation',
        skillNames: ['browser-operation'],
        allowedTools: resolveAllowedToolsForTaskKind('browser-automation', toolPackPreset),
        canSpawnSubagents: false,
        maxToolTurns: DEFAULT_MAX_TOOL_TURNS,
        requiresBrowserSearchDirective: false,
      };
    case 'implementation':
      return {
        kind: 'implementation',
        skillNames: [],
        allowedTools: resolveAllowedToolsForTaskKind('implementation', toolPackPreset),
        canSpawnSubagents: false,
        maxToolTurns: DEFAULT_MAX_TOOL_TURNS,
        requiresBrowserSearchDirective: false,
      };
    case 'debug':
      return {
        kind: 'debug',
        skillNames: [],
        allowedTools: resolveAllowedToolsForTaskKind('debug', toolPackPreset),
        canSpawnSubagents: false,
        maxToolTurns: DEBUG_MAX_TOOL_TURNS,
        requiresBrowserSearchDirective: false,
      };
    case 'review':
      return {
        kind: 'review',
        skillNames: [],
        allowedTools: resolveAllowedToolsForTaskKind('review', toolPackPreset),
        canSpawnSubagents: false,
        maxToolTurns: REVIEW_MAX_TOOL_TURNS,
        requiresBrowserSearchDirective: false,
      };
    case 'general':
    default:
      return {
        kind: 'general',
        skillNames: [],
        allowedTools: resolveAllowedToolsForTaskKind('general', toolPackPreset),
        canSpawnSubagents: false,
        maxToolTurns: maxTurnsForPrompt(prompt),
        requiresBrowserSearchDirective: false,
      };
  }
}

export function looksLikeOrchestrationTask(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const delegationIntent = /\b(sub-?agents?|delegate|parallel|concurrently|multiple agents?|workers?|split (?:the )?work)\b/.test(normalized);
  const planningIntent = /\b(plan|planning|strategy|roadmap|migration plan|migration strategy|rollout plan|execution plan)\b/.test(normalized);
  const projectScope = /\b(repo|repository|codebase|workspace|project|architecture|system|refactor|migration|rollout)\b/.test(normalized);
  return delegationIntent || (planningIntent && projectScope);
}

export function looksLikeImplementationTask(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const local = /\b(file|files|codebase|repo|repository|workspace|folder|directory|project|typescript|javascript|electron|compile|build|test|fix|implement|patch|edit|refactor|terminal|filesystem)\b/.test(normalized);
  const web = /\b(search|look up|lookup|find online|research|google|web search)\b/.test(normalized);
  return local
    && !web
    && !looksLikeReviewTask(prompt)
    && !looksLikeDebugTask(prompt)
    && !looksLikeOrchestrationTask(prompt);
}

export function looksLikeResearchTask(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const explicitSearchIntent = /\b(search(?: the web| online)?(?: for)?|look up|lookup|find online|research(?: online)?|web search|google|duckduckgo|bing)\b/.test(normalized);
  const freshnessIntent = /\b(latest|current|today|news)\b/.test(normalized);
  const localContext = /\b(file|files|codebase|repo|repository|workspace|folder|directory|project|terminal|grep|filesystem)\b/.test(normalized);
  const browserAutomation = /\b(navigate|navigation|go to|visit|open url|open the url|open page|click|type|fill|form|login|sign in|upload|download|checkout|book|submit|automate|workflow|autonomous|agentic|audit|qa|regression)\b/.test(normalized);

  if (localContext || browserAutomation) return false;
  return explicitSearchIntent || freshnessIntent;
}

export function looksLikeBrowserAutomationTask(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const localContext = /\b(file|files|codebase|repo|repository|workspace|folder|directory|project|terminal|typescript|javascript|electron|build|test|server|ci)\b/.test(normalized);
  const browserSurface = /\b(browser|tab|tabs|page|pages|site|website|webpage|url|link|links|window|windows)\b/.test(normalized);
  const tabManagement = /\b(close|close out|close all|switch|activate|focus|reopen|restore|arrange|cleanup|clean up)\b/.test(normalized)
    && /\b(tab|tabs|window|windows)\b/.test(normalized);
  const browserActions = /\b(navigate|go to|open|visit|click|type|fill|submit|login|log in|sign in|upload|download|checkout)\b/.test(normalized);

  return !localContext
    && !looksLikeResearchTask(prompt)
    && !looksLikeReviewTask(prompt)
    && !looksLikeDebugTask(prompt)
    && !looksLikeOrchestrationTask(prompt)
    && (tabManagement || (browserSurface && browserActions));
}

export function looksLikeReviewTask(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const reviewVerb = /\b(review|code review|pull request|requested changes|inline comments?|diff)\b/.test(normalized);
  const auditVerb = /\b(audit|inspect)\b/.test(normalized);
  const codeContext = /\b(code|repo|repository|workspace|diff|pr|pull request|change|changes|comment|comments)\b/.test(normalized);
  const browserAutomation = /\b(browser|navigate|click|type|form|automation|workflow|qa)\b/.test(normalized);

  if (browserAutomation && !codeContext) return false;
  return reviewVerb || (auditVerb && codeContext);
}

export function looksLikeDebugTask(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const debugVerb = /\b(debug|diagnose|investigate|troubleshoot|why (?:does|is|isn'?t)|root cause)\b/.test(normalized);
  const failureSignal = /\b(failing|failure|failed|broken|error|exception|stack trace|crash|regression|not working|doesn'?t work|won'?t start)\b/.test(normalized);
  const localContext = /\b(file|files|codebase|repo|repository|workspace|project|build|test|terminal|typescript|javascript|electron|app|server|ci|pipeline|github actions|checks?)\b/.test(normalized);

  return localContext
    && (debugVerb || failureSignal)
    && !looksLikeResearchTask(prompt)
    && !looksLikeReviewTask(prompt)
    && !looksLikeOrchestrationTask(prompt);
}

export const looksLikeDelegationTask = looksLikeOrchestrationTask;
export const looksLikeBrowserSearchTask = looksLikeResearchTask;
export const looksLikeBrowserAutomationWork = looksLikeBrowserAutomationTask;
export const looksLikeLocalCodeTask = looksLikeImplementationTask;
