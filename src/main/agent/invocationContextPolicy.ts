import type { AgentTaskKind, ProviderId } from '../../shared/types/model';
import { loadEnvFlag } from './loadEnv';
import { HAIKU_PROVIDER_ID, PRIMARY_PROVIDER_ID } from '../../shared/types/model';

const CONTEXT_REFERENCE_RE = /\b(this|that|it|same|again|above|below|previous|prior|last|current|selected|active|open|existing)\b/i;
const ARTIFACT_REFERENCE_RE = /\b(artifact|artifacts|note|notes|report|reports|document|documents|sheet|sheets|csv|markdown|html)\b/i;
const TOKEN_EFFICIENT_CONTEXT_BUDGET_MULTIPLIER = 0.72;
const MIN_TOKEN_EFFICIENT_CONTEXT_BUDGET = 900;

export function looksLikeContextDependentPrompt(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (!trimmed) return false;
  return CONTEXT_REFERENCE_RE.test(trimmed)
    || (trimmed.length <= 80 && /\b(use|update|fix|open|close|read|review|edit|append|replace|summarize|focus|convert|add|remove|delete)\b/i.test(trimmed));
}

export function isTokenEfficientContextMode(): boolean {
  return !loadEnvFlag('V2_FULL_STRENGTH_EVAL');
}

export function shouldIncludeConversationContext(input: {
  prompt: string;
  hasPriorConversation: boolean;
  isContinuation: boolean;
}): boolean {
  return input.hasPriorConversation
    && (input.isContinuation || looksLikeContextDependentPrompt(input.prompt));
}

export function shouldIncludeTaskMemoryContext(input: {
  prompt: string;
  taskKind: AgentTaskKind;
  hasPriorTaskMemory: boolean;
  isContinuation: boolean;
  lastInvocationFailed: boolean;
}): boolean {
  if (!input.hasPriorTaskMemory) return false;
  if (input.lastInvocationFailed || input.isContinuation || looksLikeContextDependentPrompt(input.prompt)) return true;
  return input.taskKind === 'debug' || input.taskKind === 'review' || input.taskKind === 'orchestration';
}

export function shouldIncludeSharedRuntimeContext(input: {
  taskKind: AgentTaskKind;
  hasPriorTaskMemory: boolean;
  providerSwitched: boolean;
  isContinuation: boolean;
  richerConversationContextRequested: boolean;
  lastInvocationFailed: boolean;
  explicitPreviousChatRecall?: boolean;
}): boolean {
  if (!isTokenEfficientContextMode()) {
    return true;
  }
  if (input.providerSwitched || input.isContinuation || input.richerConversationContextRequested || input.lastInvocationFailed) {
    return true;
  }
  if (input.explicitPreviousChatRecall) return true;
  if (input.hasPriorTaskMemory && (input.taskKind === 'debug' || input.taskKind === 'review' || input.taskKind === 'orchestration')) {
    return true;
  }
  return false;
}

/**
 * Optimization 1: Strict artifact context for Haiku and Codex.
 * These models benefit most from token reduction, so we only include artifacts
 * when explicitly referenced in the prompt.
 */
export function shouldIncludeArtifactContext(input: {
  prompt: string;
  taskKind: AgentTaskKind;
  hasArtifacts: boolean;
  providerId?: ProviderId;
}): boolean {
  if (!input.hasArtifacts) return false;

  const contextDependentForArtifacts = ARTIFACT_REFERENCE_RE.test(input.prompt) || looksLikeContextDependentPrompt(input.prompt);
  
  // For Haiku and Codex: only include if explicitly referenced
  if (input.providerId === HAIKU_PROVIDER_ID || input.providerId === PRIMARY_PROVIDER_ID) {
    return contextDependentForArtifacts;
  }
  
  // Default: also include for implementation tasks
  if (contextDependentForArtifacts) return true;
  return input.taskKind === 'implementation';
}

export function contextPromptBudgetForTaskKind(taskKind: AgentTaskKind): number {
  const base = contextPromptBudgetForTaskKindRaw(taskKind);
  if (!isTokenEfficientContextMode()) return base;
  return Math.max(MIN_TOKEN_EFFICIENT_CONTEXT_BUDGET, Math.floor(base * TOKEN_EFFICIENT_CONTEXT_BUDGET_MULTIPLIER));
}

export function contextPromptBudgetForTaskKindRaw(taskKind: AgentTaskKind): number {
  switch (taskKind) {
    case 'research':
      return 4_000;
    case 'debug':
    case 'review':
    case 'orchestration':
      return 3_500;
    case 'implementation':
      return 3_000;
    default:
      return 2_500;
  }
}
