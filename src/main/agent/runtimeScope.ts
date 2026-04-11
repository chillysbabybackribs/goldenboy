import { AgentToolName } from './AgentTypes';
import { shouldUseStrictSourceValidation } from './sourceValidationPolicy';

export type RuntimeScope = {
  skillNames: string[];
  allowedTools: 'all' | AgentToolName[];
  canSpawnSubagents: boolean;
  maxToolTurns: number;
};

const DEFAULT_MAX_TOOL_TURNS = 20;
const STRICT_VALIDATION_MAX_TOOL_TURNS = 32;
const DELEGATION_MAX_TOOL_TURNS = 40;

export function scopeForPrompt(prompt: string): RuntimeScope {
  if (looksLikeDelegationTask(prompt)) {
    return {
      skillNames: ['browser-operation', 'filesystem-operation', 'local-debug', 'subagent-coordination'],
      allowedTools: 'all',
      canSpawnSubagents: true,
      maxToolTurns: DELEGATION_MAX_TOOL_TURNS,
    };
  }

  if (looksLikeBrowserSearchTask(prompt)) {
    return {
      skillNames: ['browser-operation'],
      allowedTools: 'all',
      canSpawnSubagents: false,
      maxToolTurns: shouldUseStrictSourceValidation(prompt) ? STRICT_VALIDATION_MAX_TOOL_TURNS : DEFAULT_MAX_TOOL_TURNS,
    };
  }

  if (looksLikeLocalCodeTask(prompt)) {
    return {
      skillNames: ['browser-operation', 'filesystem-operation', 'local-debug'],
      allowedTools: 'all',
      canSpawnSubagents: false,
      maxToolTurns: DEFAULT_MAX_TOOL_TURNS,
    };
  }

  return {
    skillNames: ['browser-operation', 'filesystem-operation', 'local-debug'],
    allowedTools: 'all',
    canSpawnSubagents: false,
    maxToolTurns: shouldUseStrictSourceValidation(prompt) ? STRICT_VALIDATION_MAX_TOOL_TURNS : DEFAULT_MAX_TOOL_TURNS,
  };
}

export function withBrowserSearchDirective(prompt: string): string {
  if (!looksLikeBrowserSearchTask(prompt)) return prompt;
  return [
    'Runtime directive: This is a browser-search task. You must call browser.research_search first with the user query. Let it open/cache one result at a time and stop when enough evidence is found. Use only browser-observed search results, cached page chunks, or pages opened in the owned browser as evidence. Do not answer from model memory or provider-native search.',
    '',
    `User request: ${prompt}`,
  ].join('\n');
}

export function looksLikeDelegationTask(prompt: string): boolean {
  return /\b(sub-?agents?|delegate|parallel|concurrently|multiple agents?|workers?|split (?:the )?work)\b/i.test(prompt);
}

export function looksLikeLocalCodeTask(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const local = /\b(file|files|codebase|repo|repository|workspace|folder|directory|project|typescript|javascript|electron|compile|build|test|fix|implement|patch|edit|refactor|terminal|filesystem)\b/.test(normalized);
  const web = /\b(search|look up|lookup|find online|research|google|web search)\b/.test(normalized);
  return local && !web;
}

export function looksLikeBrowserSearchTask(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const explicitSearchIntent = /\b(search(?: the web| online)?(?: for)?|look up|lookup|find online|research(?: online)?|web search|google|duckduckgo|bing)\b/.test(normalized);
  const freshnessIntent = /\b(latest|current|today|news)\b/.test(normalized);
  const localContext = /\b(file|files|codebase|repo|repository|workspace|folder|directory|project|terminal|grep|filesystem)\b/.test(normalized);
  const browserAutomation = /\b(navigate|navigation|go to|visit|open url|open the url|open page|click|type|fill|form|login|sign in|upload|download|checkout|book|submit|automate|workflow|autonomous|agentic|audit|qa|regression)\b/.test(normalized);

  if (localContext || browserAutomation) return false;
  return explicitSearchIntent || freshnessIntent;
}
