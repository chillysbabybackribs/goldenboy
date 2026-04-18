import type { AgentToolName } from './AgentTypes';
import type { AgentTaskKind, AgentTaskProfileOverride, AgentToolPackPreset } from '../../shared/types/model';
import { shouldUseStrictSourceValidation } from './sourceValidationPolicy';
import {
  DEFAULT_TOOL_PACK_PRESET,
  resolveAllowedToolsForTaskKind,
  resolveBrowserInitialSurfaceTools,
  resolveFullSurfaceTools,
  resolveLocalFilesInitialSurfaceTools,
} from './toolPacks';

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

function looksLikeBrowserRoutingDiscussion(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const browserTopic = /\b(browser|tab|tabs|page|pages|url|search|research|navigate|click|type|automation)\b/.test(normalized);
  const routingMeta = /\b(prompt|prompts|task|tasks|message|messages|routing|route|router|classifier|classification|heuristic|trigger|triggers|triggered|triggering|keyword|keywords|word|words|phrase|phrases|text|intent|mode|modes|hard[\s-]?coded|automatic(?:ally)?|auto)\b/.test(normalized);
  return browserTopic && routingMeta;
}

function hasExplicitBrowserAutomationIntent(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const browserAction = '(?:open|visit|navigate(?: to)?|go to|click|type|fill|submit|log in(?: to)?|sign in(?: to)?|upload|download|close|close out|switch(?: to)?|focus|activate|reopen|restore|arrange|clean up|cleanup)';
  const leadingInstruction = new RegExp(`^\\s*(?:please\\s+)?(?:browser\\s*[:,-]\\s*)?${browserAction}\\b`);
  const requestedInstruction = new RegExp(`\\b(?:can you|could you|please|use (?:the )?browser to|in (?:the )?browser(?:,)?|with the browser)\\s+${browserAction}\\b`);
  return leadingInstruction.test(normalized) || requestedInstruction.test(normalized);
}

function hasInternalStateContext(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return /\b(artifact|artifacts|active artifact|current artifact|chat|conversation|thread|message|messages|prompt|prompts|note|notes|panel|pane|sidebar|selection|selected|session|sessions|history|memory|log|logs|status)\b/.test(normalized);
}

function looksLikeRuntimeMetaTask(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const runtimeSurface = /\b(agent|agents|prompt|prompts|system prompt|tool|tools|tooling|runtime|provider|providers|memory|context|hydration|process|processes|workflow|workflows|orchestration|routing|router|classifier|classification|heuristic|task profile|task profiles|search tool|search tools|browser tool|browser tools)\b/.test(normalized);
  const metaIntent = /\b(clean up|cleanup|rebuild|refactor|simplify|improve|fix|change|understand|understanding|why|how|over-?engineer(?:ed|ing)?|limiting|behavior|design)\b/.test(normalized);
  const localSystem = /\b(codebase|repo|repository|workspace|app|system|v2)\b/.test(normalized);
  return runtimeSurface && (metaIntent || localSystem || hasInternalStateContext(prompt));
}

function maxTurnsForPrompt(prompt: string): number {
  return shouldUseStrictSourceValidation(prompt)
    ? STRICT_VALIDATION_MAX_TOOL_TURNS
    : DEFAULT_MAX_TOOL_TURNS;
}

function looksLikeLocalFilesTask(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const localPathIntent = /\b(desktop|downloads|documents|home|folder|directory|path)\b/.test(normalized)
    || /(?:^|[\s(])~\//.test(prompt)
    || /\b[a-z]:\\/.test(prompt)
    || /\/(?:users|home|tmp|var|etc|mnt|opt)\//i.test(prompt);
  const fileIntent = /\b(list|show|find|search|read|open|count|locate)\b/.test(normalized)
    && /\b(file|files|folder|folders|directory|directories|path|paths)\b/.test(normalized);
  const extensionIntent = /\.[a-z0-9]{1,8}\b/i.test(prompt);
  const codeIntent = /\b(build|test|patch|edit|refactor|typescript|javascript|electron|repo|repository|codebase|ci|compile)\b/.test(normalized);
  const browserIntent = looksLikeResearchTask(prompt) || looksLikeBrowserAutomationTask(prompt);

  return !codeIntent && !browserIntent && (fileIntent || (localPathIntent && extensionIntent));
}

function initialAllowedToolsForPrompt(
  kind: AgentTaskKind,
  prompt: string,
  toolPackPreset: AgentToolPackPreset,
): 'all' | AgentToolName[] | null {
  if (toolPackPreset === 'all') return 'all';
  if (toolPackPreset !== 'mode-6') return null;

  if (kind === 'research') {
    return resolveBrowserInitialSurfaceTools();
  }

  if (kind === 'browser-automation') {
    return resolveBrowserInitialSurfaceTools();
  }

  if ((kind === 'implementation' || kind === 'general') && looksLikeLocalFilesTask(prompt)) {
    return resolveLocalFilesInitialSurfaceTools();
  }

  if (kind === 'implementation') {
    return resolveFullSurfaceTools('implementation');
  }

  if (kind === 'debug') {
    return resolveFullSurfaceTools('debug');
  }

  if (kind === 'review') {
    return resolveFullSurfaceTools('review');
  }

  return null;
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
  void overrides;
  return prompt;
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
  const initialAllowedTools = initialAllowedToolsForPrompt(normalizeTaskKind(kind), prompt, toolPackPreset);

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
        allowedTools: initialAllowedTools ?? resolveAllowedToolsForTaskKind('research', toolPackPreset),
        canSpawnSubagents: false,
        maxToolTurns: maxTurnsForPrompt(prompt),
        requiresBrowserSearchDirective: false,
      };
    case 'browser-automation':
      return {
        kind: 'browser-automation',
        skillNames: ['browser-operation'],
        allowedTools: initialAllowedTools ?? resolveAllowedToolsForTaskKind('browser-automation', toolPackPreset),
        canSpawnSubagents: false,
        maxToolTurns: DEFAULT_MAX_TOOL_TURNS,
        requiresBrowserSearchDirective: false,
      };
    case 'implementation':
      return {
        kind: 'implementation',
        skillNames: [],
        allowedTools: initialAllowedTools ?? resolveAllowedToolsForTaskKind('implementation', toolPackPreset),
        canSpawnSubagents: false,
        maxToolTurns: DEFAULT_MAX_TOOL_TURNS,
        requiresBrowserSearchDirective: false,
      };
    case 'debug':
      return {
        kind: 'debug',
        skillNames: [],
        allowedTools: initialAllowedTools ?? resolveAllowedToolsForTaskKind('debug', toolPackPreset),
        canSpawnSubagents: false,
        maxToolTurns: DEBUG_MAX_TOOL_TURNS,
        requiresBrowserSearchDirective: false,
      };
    case 'review':
      return {
        kind: 'review',
        skillNames: [],
        allowedTools: initialAllowedTools ?? resolveAllowedToolsForTaskKind('review', toolPackPreset),
        canSpawnSubagents: false,
        maxToolTurns: REVIEW_MAX_TOOL_TURNS,
        requiresBrowserSearchDirective: false,
      };
    case 'general':
    default:
      return {
        kind: 'general',
        skillNames: [],
        allowedTools: initialAllowedTools ?? resolveAllowedToolsForTaskKind('general', toolPackPreset),
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
  const internalSystemTask = looksLikeRuntimeMetaTask(prompt);
  const web = /\b(search|look up|lookup|find online|research|google|web search)\b/.test(normalized)
    && !internalSystemTask;
  return (local || internalSystemTask)
    && !web
    && !looksLikeReviewTask(prompt)
    && !looksLikeDebugTask(prompt)
    && !looksLikeOrchestrationTask(prompt);
}

export function looksLikeResearchTask(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const explicitSearchIntent = /\b(search(?: the web| online)?(?: for)?|look up|lookup|find online|research(?: online)?|web search|google|duckduckgo|bing)\b/.test(normalized);
  const freshnessIntent = /\b(latest|current|today|news)\b/.test(normalized);
  const freshnessQuestion = /\b(?:what(?:'s| is)|who(?:'s| is)|tell me|give me|show me)\s+(?:the\s+)?(?:latest|current)\b/.test(normalized);
  const sourceVerificationIntent = /\b(current web sources?|sources? with links?|linked sources?|citations?|cited|verify|verified|verification|unverifiable claims?|fact-check|fact check)\b/.test(normalized);
  const externalInfoTarget = /\b(price|prices|pricing|cost|costs|guidance|law|laws|regulation|regulations|policy|policies|weather|forecast|stock|stocks|market|markets|news|release|releases|release notes|version|versions|api|apis|documentation|docs|model|models|schedule|schedules|score|scores|exchange rate|rates|president|ceo|earnings|tariff|tariffs|filing|filings)\b/.test(normalized);
  const localContext = /\b(file|files|codebase|repo|repository|workspace|folder|directory|project|terminal|grep|filesystem)\b/.test(normalized);
  const internalStateContext = hasInternalStateContext(prompt);
  const runtimeMetaTask = looksLikeRuntimeMetaTask(prompt);
  const browserAutomation = /\b(navigate|navigation|go to|visit|open url|open the url|open page|click|type|fill|form|login|sign in|upload|download|checkout|book|submit|automate|workflow|autonomous|agentic|audit|qa|regression)\b/.test(normalized);
  const routingDiscussion = looksLikeBrowserRoutingDiscussion(prompt);

  if (localContext || runtimeMetaTask || browserAutomation || routingDiscussion) return false;
  if (explicitSearchIntent || sourceVerificationIntent) return true;
  if (internalStateContext && !(sourceVerificationIntent || explicitSearchIntent)) return false;
  return freshnessIntent && (externalInfoTarget || freshnessQuestion || sourceVerificationIntent);
}

export function looksLikeBrowserAutomationTask(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const localContext = /\b(file|files|codebase|repo|repository|workspace|folder|directory|project|terminal|typescript|javascript|electron|build|test|server|ci|docs|documentation|readme)\b/.test(normalized);
  const routingDiscussion = looksLikeBrowserRoutingDiscussion(prompt);
  const runtimeMetaTask = looksLikeRuntimeMetaTask(prompt);
  const browserSurface = /\b(browser|tab|tabs|page|pages|site|website|webpage|url|link|links|window|windows)\b/.test(normalized);
  const tabManagement = /\b(close|close out|close all|switch|activate|focus|reopen|restore|arrange|cleanup|clean up)\b/.test(normalized)
    && /\b(tab|tabs|window|windows)\b/.test(normalized);
  const browserActionIntent = hasExplicitBrowserAutomationIntent(prompt);
  const directUrlTarget = /\b(?:https?:\/\/|www\.)\S+/.test(normalized);

  return !localContext
    && !routingDiscussion
    && !runtimeMetaTask
    && !looksLikeResearchTask(prompt)
    && !looksLikeReviewTask(prompt)
    && !looksLikeDebugTask(prompt)
    && !looksLikeOrchestrationTask(prompt)
    && (tabManagement || ((browserSurface || directUrlTarget) && browserActionIntent));
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
