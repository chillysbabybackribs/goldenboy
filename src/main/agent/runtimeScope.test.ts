import { describe, expect, it } from 'vitest';
import {
  applyAdaptiveTaskProfileOverride,
  isOrchestrationExecutionReady,
  looksLikeBrowserAutomationTask,
  looksLikeDebugTask,
  looksLikeExecutionEscapePrompt,
  looksLikeImplementationTask,
  looksLikeOrchestrationTask,
  looksLikeReviewTask,
  looksLikeDelegationTask,
  looksLikeLocalCodeTask,
  looksLikeLocalPlanningTask,
  looksLikeScopingPrompt,
  scopeForPrompt,
  withBrowserSearchDirective,
  withExecutionModeDirective,
} from './runtimeScope';

// ------------------------------------------------------------
// Current contract:
//
//   - Primary tasks default to `allowedTools: 'all'`.
//   - Task profiles still classify execution mode, max tool turns, browser-search directives,
//     and sub-agent eligibility.
//   - Narrow tool scopes are reserved for explicit overrides/callers (for example sub-agents
//     or deterministic workflows).
//
// The old startup scope bootstrapper is still gone. The runtime exposes the full
// registered surface unless a caller explicitly narrows it.
//
// Skill selection is model-driven via `skill.load`. The classifier does
// NOT pre-load skills. `skillNames` is always empty in profiles produced
// by the default classifier; callers may still pass `overrides.skillNames`
// to force-load specific skills (used for deterministic workflows).
// ------------------------------------------------------------

describe('runtime scope', () => {
  it('classifies orchestration prompts and keeps the primary run on the full tool surface', () => {
    const prompt = 'Split this work across multiple agents and run in parallel';
    const scope = scopeForPrompt(prompt);

    expect(looksLikeOrchestrationTask(prompt)).toBe(true);
    expect(looksLikeDelegationTask(prompt)).toBe(true);
    expect(scope.allowedTools).toBe('all');
    expect(scope.canSpawnSubagents).toBe(true);
    expect(scope.skillNames).toEqual([]);
  });

  it('classifies web-search prompts as research and injects the browser-first directive', () => {
    const prompt = 'Search the web for the latest Anthropic model pricing';
    expect(withBrowserSearchDirective(prompt)).toContain('browser.research_search first');
    const scope = scopeForPrompt(prompt);
    expect(scope.skillNames).toEqual([]);
    expect(scope.allowedTools).toBe('all');
    expect(scope.canSpawnSubagents).toBe(false);
  });

  it('does not misclassify browser automation/audit prompts as research tasks', () => {
    const prompt = 'Audit browser automation for navigate, click, and file-system aware tasks';
    expect(withBrowserSearchDirective(prompt)).toBe(prompt);
  });

  it('classifies tab-management prompts as browser automation without pre-narrowing the tool set', () => {
    const prompt = 'Close out the browser tabs except the active one';
    const scope = scopeForPrompt(prompt);
    expect(looksLikeBrowserAutomationTask(prompt)).toBe(true);
    expect(scope.allowedTools).toBe('all');
    expect(scope.skillNames).toEqual([]);
  });

  it('classifies direct site navigation prompts like "navigate to tiktok" as browser automation', () => {
    const prompt = 'navigate to tiktok';
    const scope = scopeForPrompt(prompt);
    expect(looksLikeBrowserAutomationTask(prompt)).toBe(true);
    expect(scope.allowedTools).toBe('all');
    expect(scope.skillNames).toEqual([]);
  });

  it('classifies implementation work while keeping tool choice dynamic', () => {
    const prompt = 'Patch this TypeScript file and run the local build';
    const scope = scopeForPrompt(prompt);
    expect(looksLikeImplementationTask(prompt)).toBe(true);
    expect(looksLikeLocalCodeTask(prompt)).toBe(true);
    expect(scope.allowedTools).toBe('all');
    expect(scope.canSpawnSubagents).toBe(false);
    expect(scope.executionMode).toBe('single-pass');
    expect(scope.skillNames).toEqual([]);
  });

  it('classifies debug and review prompts and keeps them on the local-code surface', () => {
    const debugPrompt = 'Debug why the renderer build is failing with a TypeScript error';
    const debugScope = scopeForPrompt(debugPrompt);
    expect(looksLikeDebugTask(debugPrompt)).toBe(true);
    expect(looksLikeImplementationTask(debugPrompt)).toBe(false);
    expect(debugScope.executionMode).toBe('single-pass');
    expect(debugScope.maxToolTurns).toBe(28);
    expect(debugScope.allowedTools).toBe('all');
    expect(debugScope.skillNames).toEqual([]);

    const reviewPrompt = 'Review this PR diff and identify regressions before merge';
    const reviewScope = scopeForPrompt(reviewPrompt);
    expect(looksLikeReviewTask(reviewPrompt)).toBe(true);
    expect(looksLikeImplementationTask(reviewPrompt)).toBe(false);
    expect(reviewScope.allowedTools).toBe('all');
    expect(reviewScope.canSpawnSubagents).toBe(false);
    expect(reviewScope.executionMode).toBe('single-pass');
    expect(reviewScope.skillNames).toEqual([]);
  });

  it('general / ambiguous prompts keep the full tool surface unless explicitly narrowed', () => {
    const scope = scopeForPrompt('Help me think through a product naming idea');
    expect(scope.allowedTools).toBe('all');
    expect(scope.executionMode).toBe('single-pass');
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
    expect(planningScope.executionMode).toBe('orchestration');
    expect(planningScope.skillNames).toEqual([]);
  });

  it('keeps scoping questions classified as implementation while allowing direct execution tools', () => {
    const prompt = 'How do we set up a watcher for this repo and which files would we need to edit?';
    const scope = scopeForPrompt(prompt);

    expect(looksLikeScopingPrompt(prompt)).toBe(true);
    expect(looksLikeLocalPlanningTask(prompt)).toBe(true);
    expect(looksLikeImplementationTask(prompt)).toBe(false);
    expect(scope.allowedTools).toBe('all');
    expect(scope.executionMode).toBe('single-pass');
    expect(scope.skillNames).toEqual([]);
    expect(withExecutionModeDirective(prompt)).toBe(prompt);
  });

  it('marks large implementation work as staged instead of pretending it is single-pass', () => {
    const prompt = 'Implement a staged repo-wide refactor and run the build';
    const scope = scopeForPrompt(prompt);

    expect(looksLikeImplementationTask(prompt)).toBe(true);
    expect(scope.executionMode).toBe('staged');
    expect(withExecutionModeDirective(prompt)).toContain('This work is staged, not single-pass.');
  });

  it('treats explicit task profile overrides as authoritative for skills / turns / spawn', () => {
    const prompt = 'Help me think through a product naming idea';
    const scope = scopeForPrompt(prompt, {
      kind: 'research',
      skillNames: ['browser-operation', 'local-debug'],
      allowedTools: ['browser.research_search'],
      canSpawnSubagents: true,
      maxToolTurns: 9,
    });

    expect(scope.allowedTools).toEqual(['browser.research_search']);
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

  it('breaks out of plan-only when the user explicitly says to start', () => {
    const prompt = 'Enough, just start implementing this watcher and stop planning';
    const scope = scopeForPrompt(prompt);

    expect(looksLikeExecutionEscapePrompt(prompt)).toBe(true);
    expect(looksLikeImplementationTask(prompt)).toBe(true);
    expect(scope.executionMode).toBe('single-pass');
    expect(scope.allowedTools).toBe('all');
    expect(withExecutionModeDirective(prompt)).toBe(prompt);
  });

  it('inherits the previous planned task kind when a frustrated follow-up just says to start', () => {
    const override = applyAdaptiveTaskProfileOverride(
      'enough, just start',
      undefined,
      null,
      'How do we set up a watcher for this repo and which files would we need to edit?',
    );

    expect(override).toEqual({
      kind: 'implementation',
      executionMode: 'single-pass',
    });
  });

  it('keeps orchestration mode when the follow-up says to start after a repo-wide plan', () => {
    const override = applyAdaptiveTaskProfileOverride(
      'stop planning and start now',
      undefined,
      {
        latestStage: 'scaffold',
        runningSubagents: [],
        blockedSubagents: [],
        completedSubagents: [],
        nextAction: 'Start the first execution track.',
      },
      'Plan a repo-wide migration strategy',
    );

    expect(override).toEqual({
      kind: 'orchestration',
      executionMode: 'orchestration',
    });
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
