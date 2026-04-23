import type { AgentExecutionMode, AgentTaskKind, AgentTaskProfileOverride } from '../../shared/types/model';
import type { AgentToolName } from './AgentTypes';
import { shouldUseStrictSourceValidation } from './sourceValidationPolicy';

export type AgentTaskProfile = {
  kind: AgentTaskKind;
  executionMode: AgentExecutionMode;
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
const ORCHESTRATION_COMPLEXITY_PATTERNS = [
  /\b(repo-wide|codebase-wide|workspace-wide|cross-cutting|end-to-end|multi-step|staged|phased)\b/,
  /\b(migration|rollout|architecture|system|refactor|decomposition|coordination)\b/,
  /\b(multiple surfaces|multiple areas|several modules|several teams|several components)\b/,
] as const;
const IMPLEMENTATION_INTENT_RE = /\b(implement|build|patch|edit|update|modify|change|refactor|fix|wire|connect|integrate|add|remove|create|write|start)\b/;
const SCOPING_INTENT_RE = /\b(how do (?:i|we)|what files|which files|where (?:does|would|should)|what would it take|talk through|discuss|brainstorm|approach|plan|design|architecture|scope|scoping)\b/;
const LARGE_BUILD_RE = /\b(repo-wide|codebase-wide|workspace-wide|cross-cutting|migration|rollout|phased|staged|multi-step|multi phase|refactor)\b/;
const EXECUTION_ESCAPE_RE = /\b(?:enough(?: already)?|stop planning|quit planning|no more planning|skip the plan|skip planning|just start|start now|go ahead and (?:start|do it|implement)|begin (?:now|implementing)|proceed (?:now|with implementation)|start implementing|just do it)\b/;

function maxTurnsForPrompt(prompt: string): number {
  return shouldUseStrictSourceValidation(prompt)
    ? STRICT_VALIDATION_MAX_TOOL_TURNS
    : DEFAULT_MAX_TOOL_TURNS;
}

export function buildTaskProfile(prompt: string, overrides?: AgentTaskProfileOverride): AgentTaskProfile {
  const kind = resolveTaskKind(prompt, overrides);
  const base = defaultTaskProfileForKind(kind, prompt);
  return {
    ...base,
    executionMode: overrides?.executionMode ?? base.executionMode,
    allowedTools: overrides?.allowedTools
      ? (overrides.allowedTools === 'all' ? 'all' : overrides.allowedTools as AgentToolName[])
      : base.allowedTools,
    skillNames: overrides?.skillNames ? [...overrides.skillNames] : base.skillNames,
    canSpawnSubagents: overrides?.canSpawnSubagents ?? base.canSpawnSubagents,
    maxToolTurns: overrides?.maxToolTurns ?? base.maxToolTurns,
    requiresBrowserSearchDirective: overrides?.requiresBrowserSearchDirective ?? base.requiresBrowserSearchDirective,
  };
}

export function withBrowserSearchDirective(prompt: string, overrides?: AgentTaskProfileOverride): string {
  if (!buildTaskProfile(prompt, overrides).requiresBrowserSearchDirective) return prompt;
  return [
    'Runtime directive: This is a browser-search task. You must call browser.research_search first with the user query. Open results one at a time, and stop as soon as you have enough live evidence to answer. Use only the inline evidence that research_search returns, pages you extracted from the owned browser via browser.extract_page or browser.summarize_page, and findings you persisted with browser.record_finding. Do not answer from model memory or provider-native search, and do not assume prior pages are still readable from the in-app history — re-navigate the tab and re-extract if you need to reread one.',
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
  if (looksLikeLocalPlanningTask(prompt)) return 'implementation';
  if (looksLikeImplementationTask(prompt)) return 'implementation';
  return 'general';
}

function defaultTaskProfileForKind(
  kind: AgentTaskKind,
  prompt: string,
): AgentTaskProfile {
  const executionMode = resolveExecutionMode(kind, prompt);
  // Skill selection is model-driven via `skill.load`. The classifier still
  // owns the deterministic scope/budget decisions (allowedTools,
  // executionMode, canSpawnSubagents, maxToolTurns) but does not pre-load
  // skills. Callers that need to force a specific skill can still pass
  // `overrides.skillNames`.
  switch (normalizeTaskKind(kind)) {
    case 'orchestration':
      return {
        kind: 'orchestration',
        executionMode,
        skillNames: [],
        allowedTools: 'all',
        canSpawnSubagents: true,
        maxToolTurns: DELEGATION_MAX_TOOL_TURNS,
        requiresBrowserSearchDirective: false,
      };
    case 'research':
      return {
        kind: 'research',
        executionMode,
        skillNames: [],
        allowedTools: 'all',
        canSpawnSubagents: false,
        maxToolTurns: maxTurnsForPrompt(prompt),
        requiresBrowserSearchDirective: true,
      };
    case 'browser-automation':
      return {
        kind: 'browser-automation',
        executionMode,
        skillNames: [],
        allowedTools: 'all',
        canSpawnSubagents: false,
        maxToolTurns: DEFAULT_MAX_TOOL_TURNS,
        requiresBrowserSearchDirective: false,
      };
    case 'implementation':
      return {
        kind: 'implementation',
        executionMode,
        skillNames: [],
        allowedTools: 'all',
        canSpawnSubagents: false,
        maxToolTurns: DEFAULT_MAX_TOOL_TURNS,
        requiresBrowserSearchDirective: false,
      };
    case 'debug':
      return {
        kind: 'debug',
        executionMode,
        skillNames: [],
        allowedTools: 'all',
        canSpawnSubagents: false,
        maxToolTurns: DEBUG_MAX_TOOL_TURNS,
        requiresBrowserSearchDirective: false,
      };
    case 'review':
      return {
        kind: 'review',
        executionMode,
        skillNames: [],
        allowedTools: 'all',
        canSpawnSubagents: false,
        maxToolTurns: REVIEW_MAX_TOOL_TURNS,
        requiresBrowserSearchDirective: false,
      };
    case 'general':
    default:
      return {
        kind: 'general',
        executionMode,
        skillNames: [],
        allowedTools: 'all',
        canSpawnSubagents: false,
        maxToolTurns: maxTurnsForPrompt(prompt),
        requiresBrowserSearchDirective: false,
      };
  }
}

function resolveExecutionMode(kind: AgentTaskKind, prompt: string): AgentExecutionMode {
  const normalizedKind = normalizeTaskKind(kind);
  if (normalizedKind === 'orchestration') return 'orchestration';
  if (normalizedKind === 'implementation' || normalizedKind === 'debug') {
    if (LARGE_BUILD_RE.test(prompt.toLowerCase())) return 'staged';
    return 'single-pass';
  }
  if (normalizedKind === 'general') return 'single-pass';
  return 'single-pass';
}

export function looksLikeScopingPrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return SCOPING_INTENT_RE.test(normalized);
}

export function looksLikeExecutionEscapePrompt(prompt: string): boolean {
  return EXECUTION_ESCAPE_RE.test(prompt.toLowerCase());
}

export function looksLikeLocalPlanningTask(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const local = /\b(file|files|codebase|repo|repository|workspace|folder|directory|project|typescript|javascript|electron|compile|build|test|watcher|watch|terminal|filesystem)\b/.test(normalized);
  return local
    && looksLikeScopingPrompt(prompt)
    && !looksLikeResearchTask(prompt)
    && !looksLikeBrowserAutomationTask(prompt)
    && !looksLikeReviewTask(prompt)
    && !looksLikeDebugTask(prompt)
    && !looksLikeOrchestrationTask(prompt);
}

export function looksLikeOrchestrationTask(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const delegationIntent = /\b(sub-?agents?|delegate|parallel|concurrently|multiple agents?|workers?|split (?:the )?work)\b/.test(normalized);
  const planningIntent = /\b(plan|planning|strategy|roadmap|migration plan|migration strategy|rollout plan|execution plan)\b/.test(normalized);
  const projectScope = /\b(repo|repository|codebase|workspace|project|architecture|system|refactor|migration|rollout)\b/.test(normalized);
  const complexityScore = ORCHESTRATION_COMPLEXITY_PATTERNS.reduce((score, pattern) => (
    score + (pattern.test(normalized) ? 1 : 0)
  ), 0);
  return delegationIntent || (planningIntent && projectScope && complexityScore >= 1);
}

export function looksLikeImplementationTask(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const local = /\b(file|files|codebase|repo|repository|workspace|folder|directory|project|typescript|javascript|electron|compile|build|test|fix|implement|patch|edit|refactor|terminal|filesystem|watch|watcher)\b/.test(normalized);
  const implementationIntent = IMPLEMENTATION_INTENT_RE.test(normalized);
  const web = /\b(search|look up|lookup|find online|research|google|web search)\b/.test(normalized);
  return local
    && implementationIntent
    && (!looksLikeScopingPrompt(prompt) || looksLikeExecutionEscapePrompt(prompt))
    && !web
    && !looksLikeReviewTask(prompt)
    && !looksLikeDebugTask(prompt)
    && !looksLikeOrchestrationTask(prompt);
}

export function looksLikeResearchTask(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  // Match search engines only when used as a verb ("google X"), not as a navigation target ("open google", "go to google")
  const searchEngineAsVerb = /\b(google|duckduckgo|bing)\b/.test(normalized)
    && !/\b(open|go to|visit|navigate to|launch)\b.{0,20}\b(google|duckduckgo|bing)\b/.test(normalized);
  const explicitSearchIntent = /\b(search(?: the web| online)?(?: for)?|look up|lookup|find online|research(?: online)?|web search)\b/.test(normalized)
    || searchEngineAsVerb;
  const freshnessIntent = /\b(latest|current|today|news)\b/.test(normalized);
  const localContext = /\b(file|files|codebase|repo|repository|workspace|folder|directory|project|terminal|grep|filesystem)\b/.test(normalized);
  const browserAutomation = /\b(navigate|navigation|go to|visit|open url|open the url|open page|open|click|type|fill|form|login|sign in|upload|download|checkout|book|submit|automate|workflow|autonomous|agentic|audit|qa|regression)\b/.test(normalized);

  if (localContext || browserAutomation) return false;
  return explicitSearchIntent || freshnessIntent;
}

export function looksLikeBrowserAutomationTask(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const localContext = /\b(file|files|codebase|repo|repository|workspace|folder|directory|project|terminal|typescript|javascript|electron|build|test|server|ci)\b/.test(normalized);
  const browserSurface = /\b(browser|tab|tabs|page|pages|site|website|webpage|url|link|links|window|windows|google|youtube|github|twitter|reddit|gmail|slack|notion|figma|linkedin|amazon|facebook|instagram)\b/.test(normalized);
  const tabManagement = /\b(close|close out|close all|switch|activate|focus|reopen|restore|arrange|cleanup|clean up)\b/.test(normalized)
    && /\b(tab|tabs|window|windows)\b/.test(normalized);
  const browserActions = /\b(navigate|go to|open|visit|click|type|fill|submit|login|log in|sign in|upload|download|checkout)\b/.test(normalized);
  const directNavigationTarget = /\b(?:navigate to|go to|visit|launch)\s+(?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9.-]{1,62}(?:\/\S*)?\b/.test(normalized);

  return !localContext
    && !looksLikeResearchTask(prompt)
    && !looksLikeReviewTask(prompt)
    && !looksLikeDebugTask(prompt)
    && !looksLikeOrchestrationTask(prompt)
    && (tabManagement || directNavigationTarget || (browserSurface && browserActions));
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
