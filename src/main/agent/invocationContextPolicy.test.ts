import { describe, expect, it } from 'vitest';
import {
  contextPromptBudgetForTaskKind,
  looksLikeContextDependentPrompt,
  shouldIncludeArtifactContext,
  shouldIncludeConversationContext,
  shouldIncludeTaskMemoryContext,
} from './invocationContextPolicy';

describe('invocationContextPolicy', () => {
  it('keeps fresh standalone prompts lightweight', () => {
    expect(looksLikeContextDependentPrompt('Audit the Codex runtime for prompt overhead.')).toBe(false);
    expect(shouldIncludeConversationContext({
      prompt: 'Audit the Codex runtime for prompt overhead.',
      hasPriorConversation: true,
      isContinuation: false,
    })).toBe(false);
    expect(shouldIncludeTaskMemoryContext({
      prompt: 'Audit the Codex runtime for prompt overhead.',
      taskKind: 'implementation',
      hasPriorTaskMemory: true,
      isContinuation: false,
      lastInvocationFailed: false,
    })).toBe(false);
  });

  it('keeps continuation-style prompts contextual', () => {
    expect(looksLikeContextDependentPrompt('Use the current artifact and update it.')).toBe(true);
    expect(looksLikeContextDependentPrompt('Focus only on B.')).toBe(true);
    expect(looksLikeContextDependentPrompt('Remove section 3.')).toBe(true);
    expect(shouldIncludeConversationContext({
      prompt: 'Use the current artifact and update it.',
      hasPriorConversation: true,
      isContinuation: false,
    })).toBe(true);
    expect(shouldIncludeTaskMemoryContext({
      prompt: 'continue from the last failure',
      taskKind: 'debug',
      hasPriorTaskMemory: true,
      isContinuation: true,
      lastInvocationFailed: true,
    })).toBe(true);
  });

  it('only includes artifact context when the prompt is artifact-aware', () => {
    expect(shouldIncludeArtifactContext({
      prompt: 'summarize the weekly research note',
      taskKind: 'general',
      hasArtifacts: true,
    })).toBe(true);
    expect(shouldIncludeArtifactContext({
      prompt: 'Audit the Codex runtime for prompt overhead.',
      taskKind: 'general',
      hasArtifacts: true,
    })).toBe(false);
  });

  it('uses smaller budgets for lightweight task kinds', () => {
    expect(contextPromptBudgetForTaskKind('general')).toBe(2_500);
    expect(contextPromptBudgetForTaskKind('implementation')).toBe(3_000);
    expect(contextPromptBudgetForTaskKind('research')).toBe(4_000);
  });
});
