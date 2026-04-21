import { describe, expect, it } from 'vitest';
import {
  applyAdaptiveTaskProfileOverride,
  isOrchestrationExecutionReady,
  looksLikeBrowserAutomationTask,
  looksLikeDebugTask,
  looksLikeImplementationTask,
  looksLikeOrchestrationTask,
  looksLikeReviewTask,
  looksLikeDelegationTask,
  looksLikeLocalCodeTask,
  scopeForPrompt,
  withBrowserSearchDirective,
} from './runtimeScope';

// ------------------------------------------------------------
// NEW CONTRACT (eradicated runtime tool-scope limiter):
//
//   Every task kind MUST return `allowedTools === 'all'`.
//
// The previous behavior narrowed tools per task kind (e.g. 4-tool "mode-4"
// preset, 6-tool implementation preset, etc.) and forced the model to
// bootstrap its scope via tool-loading indirection. That
// machinery is intentionally gone. The only thing task kind influences now
// is ancillary behavior: skill selection, max tool turns, subagent spawn
// permission, and the browser-search directive. `canSpawnSubagents` is still
// the one legitimate override that removes `subagent.*` from the surface.
// ------------------------------------------------------------

describe('runtime scope', () => {
  it('classifies orchestration prompts and exposes every tool for spawning work', () => {
    const prompt = 'Split this work across multiple agents and run in parallel';
    const scope = scopeForPrompt(prompt);

    expect(looksLikeOrchestrationTask(prompt)).toBe(true);
    expect(looksLikeDelegationTask(prompt)).toBe(true);
    expect(scope.allowedTools).toBe('all');
    expect(scope.canSpawnSubagents).toBe(true);
    expect(scope.skillNames).toEqual(['subagent-coordination']);
  });

  it('does not auto-classify web-search-looking prompts as research (regex auto-router retired)', () => {
    const prompt = 'Search the web for the latest Anthropic model pricing';
    expect(withBrowserSearchDirective(prompt)).toBe(prompt);
    const scope = scopeForPrompt(prompt);
    expect(scope.skillNames).not.toContain('browser-operation');
    expect(scope.allowedTools).toBe('all');
  });

  it('routes to research mode only when the caller explicitly asks for it', () => {
    const prompt = 'Search the web for the latest Anthropic model pricing';
    expect(withBrowserSearchDirective(prompt, { kind: 'research' }))
      .toContain('browser.research_search first');
    const scope = scopeForPrompt(prompt, { kind: 'research' });
    expect(scope.allowedTools).toBe('all');
  });

  it('does not misclassify browser automation/audit prompts as research tasks', () => {
    const prompt = 'Audit browser automation for navigate, click, and file-system aware tasks';
    expect(withBrowserSearchDirective(prompt)).toBe(prompt);
  });

  it('classifies tab-management prompts as browser automation and still exposes every tool', () => {
    const prompt = 'Close out the browser tabs except the active one';
    const scope = scopeForPrompt(prompt);
    expect(looksLikeBrowserAutomationTask(prompt)).toBe(true);
    expect(scope.allowedTools).toBe('all');
    expect(scope.skillNames).toEqual(['browser-operation']);
  });

  it('classifies implementation work but keeps the surface wide open', () => {
    const prompt = 'Patch this TypeScript file and run the local build';
    const scope = scopeForPrompt(prompt);
    expect(looksLikeImplementationTask(prompt)).toBe(true);
    expect(looksLikeLocalCodeTask(prompt)).toBe(true);
    expect(scope.allowedTools).toBe('all');
    expect(scope.canSpawnSubagents).toBe(false);
    expect(scope.skillNames).toEqual(expect.arrayContaining(['code-edit', 'typescript-typecheck']));
  });

  it('classifies debug and review prompts and preserves wide tool access for both', () => {
    const debugPrompt = 'Debug why the renderer build is failing with a TypeScript error';
    const debugScope = scopeForPrompt(debugPrompt);
    expect(looksLikeDebugTask(debugPrompt)).toBe(true);
    expect(looksLikeImplementationTask(debugPrompt)).toBe(false);
    expect(debugScope.maxToolTurns).toBe(28);
    expect(debugScope.allowedTools).toBe('all');
    expect(debugScope.skillNames).toEqual(expect.arrayContaining(['code-edit', 'typescript-typecheck', 'test-driven-fix']));

    const reviewPrompt = 'Review this PR diff and identify regressions before merge';
    const reviewScope = scopeForPrompt(reviewPrompt);
    expect(looksLikeReviewTask(reviewPrompt)).toBe(true);
    expect(looksLikeImplementationTask(reviewPrompt)).toBe(false);
    expect(reviewScope.allowedTools).toBe('all');
    expect(reviewScope.canSpawnSubagents).toBe(false);
    expect(reviewScope.skillNames).toEqual(expect.arrayContaining(['code-edit', 'test-driven-fix']));
  });

  it('general / ambiguous prompts still get the full tool surface', () => {
    const scope = scopeForPrompt('Help me think through a product naming idea');
    expect(scope.allowedTools).toBe('all');
  });

  it('treats CI failure investigation as debug work and repo-wide planning as orchestration', () => {
    const ciPrompt = 'Investigate the failing CI and explain root cause';
    expect(looksLikeDebugTask(ciPrompt)).toBe(true);
    expect(looksLikeImplementationTask(ciPrompt)).toBe(false);

    const planningPrompt = 'Plan a repo-wide migration strategy';
    const planningScope = scopeForPrompt(planningPrompt);
    expect(looksLikeOrchestrationTask(planningPrompt)).toBe(true);
    expect(planningScope.canSpawnSubagents).toBe(true);
    expect(planningScope.allowedTools).toBe('all');
    expect(planningScope.skillNames).toEqual(['subagent-coordination']);
  });

  it('treats explicit task profile overrides as authoritative for skills / turns / spawn', () => {
    const prompt = 'Help me think through a product naming idea';
    const scope = scopeForPrompt(prompt, {
      kind: 'research',
      skillNames: ['browser-operation', 'local-debug'],
      canSpawnSubagents: true,
      maxToolTurns: 9,
    });

    expect(scope.allowedTools).toBe('all');
    expect(scope.canSpawnSubagents).toBe(true);
    expect(scope.maxToolTurns).toBe(9);
    expect(scope.skillNames).toEqual(['browser-operation', 'local-debug']);
    expect(withBrowserSearchDirective(prompt, { kind: 'research' }))
      .toContain('browser.research_search first');
    expect(withBrowserSearchDirective(prompt, { kind: 'general' })).toBe(prompt);
  });

  it('normalizes legacy task kinds in overrides for compatibility', () => {
    expect(scopeForPrompt('Investigate a crash', { kind: 'delegation' }).canSpawnSubagents).toBe(true);
    expect(withBrowserSearchDirective('Find current pricing', { kind: 'browser-search' }))
      .toContain('browser.research_search first');
    expect(looksLikeLocalCodeTask('Patch this file and run the build')).toBe(true);
  });

  it('applyAdaptiveTaskProfileOverride is a passthrough — no hidden narrowing', () => {
    // No overrides, no snapshot -> nothing to return.
    expect(applyAdaptiveTaskProfileOverride('Plan a repo-wide migration strategy', undefined, null)).toBeUndefined();

    // Explicit override is returned untouched.
    const explicit = { kind: 'research' as const, maxToolTurns: 42 };
    expect(applyAdaptiveTaskProfileOverride('Plan a repo-wide migration strategy', explicit, {
      latestStage: 'subagent-spawn',
      runningSubagents: [{ role: 'research', task: 'Inspect scope', subagentId: 'sub_1' }],
      blockedSubagents: [],
      completedSubagents: [],
      nextAction: 'Wait for research findings',
    })).toEqual(explicit);
  });

  it('isOrchestrationExecutionReady correctly reflects ongoing orchestration state', () => {
    expect(isOrchestrationExecutionReady(null)).toBe(false);
    expect(isOrchestrationExecutionReady({
      latestStage: 'scaffold',
      runningSubagents: [],
      blockedSubagents: [],
      completedSubagents: [],
      nextAction: null,
    })).toBe(false);
    expect(isOrchestrationExecutionReady({
      latestStage: 'subagent-spawn',
      runningSubagents: [{ role: 'research', task: 'Inspect scope', subagentId: 'sub_1' }],
      blockedSubagents: [],
      completedSubagents: [],
      nextAction: 'Wait for research findings',
    })).toBe(true);
  });
});
