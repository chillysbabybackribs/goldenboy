import { AgentPromptBuilder } from './AgentPromptBuilder';
import { shouldUseStrictSourceValidation } from './sourceValidationPolicy';
import { AgentRuntimeConfig } from './AgentTypes';

const baseConfig: AgentRuntimeConfig = {
  mode: 'unrestricted-dev',
  agentId: 'test-agent',
  role: 'primary',
  task: 'hello',
};

describe('source validation policy', () => {
  it('enables strict validation for factual research tasks', () => {
    expect(shouldUseStrictSourceValidation('Look up the latest OpenAI API pricing')).toBe(true);
    expect(shouldUseStrictSourceValidation('Verify the current FDA guidance')).toBe(true);
    expect(shouldUseStrictSourceValidation('Find authoritative sources for this legal rule')).toBe(true);
  });

  it('does not enable strict validation for low-risk writing tasks', () => {
    expect(shouldUseStrictSourceValidation('Rewrite this paragraph to be shorter')).toBe(false);
    expect(shouldUseStrictSourceValidation('Brainstorm names for a local dev tool')).toBe(false);
  });

  it('always injects the compact source rule, constraint ledger, and task completion protocol', () => {
    const prompt = new AgentPromptBuilder().buildSystemPrompt({
      config: baseConfig,
      skills: [],
      tools: [],
    });

    expect(prompt).toContain('## Source Validation');
    expect(prompt).toContain('never fabricate citations');
    expect(prompt).toContain('## Constraint Ledger');
    expect(prompt).toContain('single source of truth');
    expect(prompt).toContain('Before marking any result as valid');
    expect(prompt).toContain('## Physical Task Completion');
    expect(prompt).toContain('perform the real action');
    expect(prompt).not.toContain('## Strict Source Validation Protocol');
  });

  it('injects the full protocol only for strict-validation tasks', () => {
    const prompt = new AgentPromptBuilder().buildSystemPrompt({
      config: {
        ...baseConfig,
        task: 'Research current product pricing and cite authoritative sources',
      },
      skills: [],
      tools: [],
    });

    expect(prompt).toContain('## Source Validation');
    expect(prompt).toContain('## Strict Source Validation Protocol');
    expect(prompt).toContain('Validation thresholds:');
    expect(prompt).toContain('Search exhaustion:');
  });
});
