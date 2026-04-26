import { describe, expect, it } from 'vitest';
import { buildResponseStyleAddendum } from './agentPersonality';

describe('agentPersonality', () => {
  it('returns orchestration guidance for orchestration tasks', () => {
    const addendum = buildResponseStyleAddendum('Plan a repo-wide migration strategy with sub agents');
    expect(addendum).toContain('For orchestration and complex planning tasks:');
    expect(addendum).toContain('Keep the parent on the critical path');
    expect(addendum).not.toContain('move from plan to execution');
  });

  it('returns browser guidance for browser automation tasks', () => {
    const addendum = buildResponseStyleAddendum('Close out all browser tabs');
    expect(addendum).toContain('For browser, research, and web tasks:');
    expect(addendum).toContain('Do not open by echoing or paraphrasing the user request.');
    expect(addendum).toContain('If the first obvious step is a browser tool call, make it before emitting any assistant text.');
    expect(addendum).toContain('Do not narrate your plan');
  });

  it('prefers review guidance over audit guidance for review-shaped tasks', () => {
    const addendum = buildResponseStyleAddendum('Audit this pull request diff for regressions');
    expect(addendum).toContain('For review and audit tasks, produce the final answer in this order:');
    expect(addendum).not.toContain('For audit tasks that are not code-review requests');
  });

  it('returns audit guidance for non-review audit tasks', () => {
    const addendum = buildResponseStyleAddendum('Audit the prompt and tool architecture for conflicts');
    expect(addendum).toContain('For audit tasks that are not code-review requests');
    expect(addendum).toContain('Concrete recommendations, ordered by leverage.');
  });

  it('returns debugging guidance for debug tasks', () => {
    const addendum = buildResponseStyleAddendum('Diagnose the failing startup crash');
    expect(addendum).toContain('For debugging tasks, produce the final answer in this order:');
    expect(addendum).toContain('Root cause or strongest current hypothesis.');
    expect(addendum).toContain('Prefer `terminal.build_repo` over raw `terminal.exec`');
    expect(addendum).toContain('Prefer `terminal.test_repo` over raw `terminal.exec`');
  });

  it('returns no addendum for generic tasks', () => {
    expect(buildResponseStyleAddendum('Help me think through a product naming idea')).toBe('');
  });
});
