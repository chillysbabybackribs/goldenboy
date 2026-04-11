import {
  looksLikeBrowserSearchTask,
  looksLikeDelegationTask,
  looksLikeLocalCodeTask,
  scopeForPrompt,
  withBrowserSearchDirective,
} from './runtimeScope';

describe('runtime scope', () => {
  it('enables delegation mode when prompt requests multiple agents', () => {
    const scope = scopeForPrompt('Split this work across multiple agents and run in parallel');
    expect(looksLikeDelegationTask('Split this work across multiple agents and run in parallel')).toBe(true);
    expect(scope.allowedTools).toBe('all');
    expect(scope.canSpawnSubagents).toBe(true);
    expect(scope.skillNames).toContain('subagent-coordination');
  });

  it('keeps full tool access for browser search tasks and injects search directive', () => {
    const prompt = 'Search the web for the latest Anthropic model pricing';
    const scope = scopeForPrompt(prompt);
    expect(looksLikeBrowserSearchTask(prompt)).toBe(true);
    expect(scope.allowedTools).toBe('all');
    expect(scope.canSpawnSubagents).toBe(false);
    expect(scope.skillNames).toEqual(['browser-operation']);
    expect(withBrowserSearchDirective(prompt)).toContain('browser.research_search first');
  });

  it('does not misclassify browser automation/audit prompts as research tasks', () => {
    const prompt = 'Audit browser automation for navigate, click, and file-system aware tasks';
    expect(looksLikeBrowserSearchTask(prompt)).toBe(false);
    expect(withBrowserSearchDirective(prompt)).toBe(prompt);
  });

  it('detects local code work and keeps non-delegated tool execution broad', () => {
    const prompt = 'Patch this TypeScript file and run the local build';
    const scope = scopeForPrompt(prompt);
    expect(looksLikeLocalCodeTask(prompt)).toBe(true);
    expect(scope.allowedTools).toBe('all');
    expect(scope.canSpawnSubagents).toBe(false);
    expect(scope.skillNames).toContain('filesystem-operation');
    expect(scope.skillNames).toContain('local-debug');
  });
});
