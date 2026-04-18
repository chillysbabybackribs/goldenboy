import type { AgentTaskKind } from '../../shared/types/model';

const CONTEXT_REFERENCE_RE = /\b(this|that|it|same|again|above|below|previous|prior|last|current|selected|active|open|existing)\b/i;
const ARTIFACT_REFERENCE_RE = /\b(artifact|artifacts|note|notes|report|reports|document|documents|sheet|sheets|csv|markdown|html)\b/i;

export function looksLikeContextDependentPrompt(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (!trimmed) return false;
  return CONTEXT_REFERENCE_RE.test(trimmed)
    || (trimmed.length <= 80 && /\b(use|update|fix|open|close|read|review|edit|append|replace|summarize|focus|convert|add|remove|delete)\b/i.test(trimmed));
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

export function shouldIncludeArtifactContext(input: {
  prompt: string;
  taskKind: AgentTaskKind;
  hasArtifacts: boolean;
}): boolean {
  if (!input.hasArtifacts) return false;
  if (ARTIFACT_REFERENCE_RE.test(input.prompt) || looksLikeContextDependentPrompt(input.prompt)) return true;
  return input.taskKind === 'implementation';
}

export function contextPromptBudgetForTaskKind(taskKind: AgentTaskKind): number {
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
