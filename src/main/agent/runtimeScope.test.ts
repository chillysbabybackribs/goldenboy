import {
  applyAdaptiveTaskProfileOverride,
  isOrchestrationExecutionReady,
  looksLikeBrowserAutomationTask,
  looksLikeDebugTask,
  looksLikeImplementationTask,
  looksLikeOrchestrationTask,
  looksLikeResearchTask,
  looksLikeReviewTask,
  looksLikeBrowserSearchTask,
  looksLikeDelegationTask,
  looksLikeLocalCodeTask,
  scopeForPrompt,
  withBrowserSearchDirective,
} from './runtimeScope';

describe('runtime scope', () => {
  it('enables orchestration mode when prompt requests multiple agents', () => {
    const scope = scopeForPrompt('Split this work across multiple agents and run in parallel');
    expect(looksLikeOrchestrationTask('Split this work across multiple agents and run in parallel')).toBe(true);
    expect(looksLikeDelegationTask('Split this work across multiple agents and run in parallel')).toBe(true);
    expect(scope.allowedTools).not.toBe('all');
    expect(scope.allowedTools).toHaveLength(8);
    expect(scope.allowedTools).toContain('runtime.search_tools');
    expect(scope.allowedTools).toContain('runtime.load_tools');
    expect(scope.allowedTools).toContain('runtime.list_loaded_tools');
    expect(scope.allowedTools).toContain('subagent.spawn');
    expect(scope.allowedTools).toContain('subagent.wait');
    expect(scope.canSpawnSubagents).toBe(true);
    expect(scope.skillNames).toEqual(['subagent-coordination']);
  });

  it('uses research mode for browser search tasks and injects the search directive', () => {
    const prompt = 'Search the web for the latest Anthropic model pricing';
    const scope = scopeForPrompt(prompt);
    expect(looksLikeResearchTask(prompt)).toBe(true);
    expect(looksLikeBrowserSearchTask(prompt)).toBe(true);
    expect(scope.allowedTools).not.toBe('all');
    expect(scope.allowedTools).toHaveLength(6);
    expect(scope.allowedTools).toContain('runtime.list_loaded_tools');
    expect(scope.allowedTools).toContain('browser.answer_from_cache');
    expect(scope.allowedTools).toContain('browser.extract_page');
    expect(scope.canSpawnSubagents).toBe(false);
    expect(scope.skillNames).toEqual([]);
    expect(withBrowserSearchDirective(prompt)).toContain('browser.research_search first');
  });

  it('does not misclassify browser automation/audit prompts as research tasks', () => {
    const prompt = 'Audit browser automation for navigate, click, and file-system aware tasks';
    expect(looksLikeResearchTask(prompt)).toBe(false);
    expect(looksLikeBrowserSearchTask(prompt)).toBe(false);
    expect(withBrowserSearchDirective(prompt)).toBe(prompt);
  });

  it('routes tab-management requests into browser automation mode', () => {
    const prompt = 'Close out the browser tabs except the active one';
    const scope = scopeForPrompt(prompt);
    expect(looksLikeBrowserAutomationTask(prompt)).toBe(true);
    expect(scope.allowedTools).not.toBe('all');
    expect(scope.allowedTools).toHaveLength(7);
    expect(scope.allowedTools).toEqual(expect.arrayContaining([
      'runtime.list_loaded_tools',
      'browser.get_state',
      'browser.get_tabs',
      'browser.close_tab',
      'browser.navigate',
    ]));
    expect(scope.skillNames).toEqual(['browser-operation']);
  });

  it('detects implementation work and keeps non-orchestration execution broad', () => {
    const prompt = 'Patch this TypeScript file and run the local build';
    const scope = scopeForPrompt(prompt);
    expect(looksLikeImplementationTask(prompt)).toBe(true);
    expect(looksLikeLocalCodeTask(prompt)).toBe(true);
    expect(scope.allowedTools).not.toBe('all');
    expect(scope.allowedTools).toHaveLength(6);
    expect(scope.allowedTools).toContain('runtime.list_loaded_tools');
    expect(scope.allowedTools).toContain('filesystem.patch');
    expect(scope.allowedTools).toContain('terminal.exec');
    expect(scope.canSpawnSubagents).toBe(false);
    expect(scope.skillNames).toEqual(expect.arrayContaining(['code-edit', 'typescript-typecheck']));
  });

  it('distinguishes debug and review tasks from implementation work', () => {
    const debugPrompt = 'Debug why the renderer build is failing with a TypeScript error';
    const debugScope = scopeForPrompt(debugPrompt);
    expect(looksLikeDebugTask(debugPrompt)).toBe(true);
    expect(looksLikeImplementationTask(debugPrompt)).toBe(false);
    expect(debugScope.maxToolTurns).toBe(28);
    expect(debugScope.allowedTools).toHaveLength(6);
    expect(debugScope.skillNames).toEqual(expect.arrayContaining(['code-edit', 'typescript-typecheck', 'test-driven-fix']));

    const reviewPrompt = 'Review this PR diff and identify regressions before merge';
    const reviewScope = scopeForPrompt(reviewPrompt);
    expect(looksLikeReviewTask(reviewPrompt)).toBe(true);
    expect(looksLikeImplementationTask(reviewPrompt)).toBe(false);
    expect(reviewScope.allowedTools).not.toBe('all');
    expect(reviewScope.allowedTools).toHaveLength(6);
    expect(reviewScope.canSpawnSubagents).toBe(false);
    expect(reviewScope.skillNames).toEqual(expect.arrayContaining(['code-edit', 'test-driven-fix']));
  });

  it('general tasks get search and load tools for open-ended discovery', () => {
    const scope = scopeForPrompt('Help me think through a product naming idea');
    expect(scope.allowedTools).not.toBe('all');
    expect(scope.allowedTools).toHaveLength(9);
    expect(scope.allowedTools).toEqual(expect.arrayContaining([
      'runtime.search_tools',
      'runtime.load_tools',
      'runtime.list_loaded_tools',
      'filesystem.search',
      'filesystem.read',
      'filesystem.patch',
      'terminal.exec',
      'chat.thread_summary',
    ]));
  });

  it('treats CI failure investigation as debug work and repo-wide planning as orchestration', () => {
    const ciPrompt = 'Investigate the failing CI and explain root cause';
    expect(looksLikeDebugTask(ciPrompt)).toBe(true);
    expect(looksLikeImplementationTask(ciPrompt)).toBe(false);

    const planningPrompt = 'Plan a repo-wide migration strategy';
    const planningScope = scopeForPrompt(planningPrompt);
    expect(looksLikeOrchestrationTask(planningPrompt)).toBe(true);
    expect(planningScope.canSpawnSubagents).toBe(true);
    expect(planningScope.skillNames).toEqual(['subagent-coordination']);
  });

  it('treats explicit task profile overrides as authoritative', () => {
    const prompt = 'Help me think through a product naming idea';
    const scope = scopeForPrompt(prompt, {
      kind: 'research',
      skillNames: ['browser-operation', 'local-debug'],
      toolScopePreset: 'all',
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

  it('supports the tighter four-tool preset for benchmark runs', () => {
    const scope = scopeForPrompt('Search the web for current SEC guidance', {
      kind: 'research',
      toolScopePreset: 'mode-4',
    });

    expect(scope.allowedTools).not.toBe('all');
    expect(scope.allowedTools).toHaveLength(4);
    expect(scope.allowedTools).toContain('runtime.list_loaded_tools');
    expect(scope.allowedTools).toContain('browser.research_search');
  });

  it('tightens orchestration scope once execution is underway', () => {
    const overrides = applyAdaptiveTaskProfileOverride(
      'Plan a repo-wide migration strategy',
      undefined,
      {
        latestStage: 'subagent-spawn',
        runningSubagents: [{ role: 'research', task: 'Inspect scope', subagentId: 'sub_1' }],
        blockedSubagents: [],
        completedSubagents: [],
        nextAction: 'Wait for research findings',
      },
    );

    const scope = scopeForPrompt('Plan a repo-wide migration strategy', overrides);
    expect(isOrchestrationExecutionReady({
      latestStage: 'subagent-spawn',
      runningSubagents: [{ role: 'research', task: 'Inspect scope', subagentId: 'sub_1' }],
      blockedSubagents: [],
      completedSubagents: [],
      nextAction: 'Wait for research findings',
    })).toBe(true);
    expect(overrides?.toolScopePreset).toBe('mode-4');
    expect(scope.allowedTools).not.toBe('all');
    expect(scope.allowedTools).toHaveLength(4);
    expect(scope.allowedTools).toContain('subagent.spawn');
    expect(scope.allowedTools).not.toContain('runtime.search_tools');
    expect(scope.allowedTools).not.toContain('runtime.load_tools');
  });

  it('preserves explicit tool scope overrides ahead of adaptive orchestration tightening', () => {
    const overrides = applyAdaptiveTaskProfileOverride(
      'Plan a repo-wide migration strategy',
      { toolScopePreset: 'all' },
      {
        latestStage: 'subagent-complete',
        runningSubagents: [],
        blockedSubagents: [],
        completedSubagents: [{ role: 'research', task: 'Inspect scope' }],
        nextAction: 'Patch prompt assembly',
      },
    );

    expect(overrides).toEqual({ toolScopePreset: 'all' });
  });
});
