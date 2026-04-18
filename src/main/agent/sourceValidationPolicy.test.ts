import { AgentPromptBuilder } from './AgentPromptBuilder';
import { shouldUseStrictSourceValidation } from './sourceValidationPolicy';
import { AgentRuntimeConfig, AgentSkill } from './AgentTypes';

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

    expect(prompt).toContain('# V2 Agent Contract');
    expect(prompt).toContain('## Runtime Identity');
    expect(prompt).toContain("You are the user's persistent V2 workspace agent");
    expect(prompt).toContain('## Execution Guardrails');
    expect(prompt).toContain('use tools to do the work');
    expect(prompt).toContain('Workspace root: /home/dp/Desktop/v2workspace');
    expect(prompt).toContain('## Operating Rules');
    expect(prompt).toContain('## Result Validation Discipline');
    expect(prompt).toContain('## Runtime Identity');
    expect(prompt).toContain('Current date/time:');
    expect(prompt).toContain('authoritative current date/time context');
    expect(prompt).not.toContain('## Current Integration State');
    expect(prompt).not.toContain('## File Map');
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

    expect(prompt).toContain('## Execution Guardrails');
    expect(prompt).toContain('## Strict Source Validation Protocol');
    expect(prompt).toContain('Validation thresholds:');
    expect(prompt).toContain('Search exhaustion:');
  });

  it('compacts injected skills down to operational guidance', () => {
    const skill: AgentSkill = {
      name: 'browser-operation',
      path: '/tmp/browser-operation/SKILL.md',
      body: [
        '# Browser Operation',
        '',
        'Use this skill when a task requires navigation or browser research.',
        '',
        '## Relevant Files',
        '',
        '- `src/main/browser/BrowserService.ts`',
        '',
        '## Workflow',
        '',
        '1. Read current browser state.',
        '2. Search cached chunks before full extraction.',
        '',
        '## Preferred Tools',
        '',
        '- `browser.get_state`',
        '- `browser.research_search`',
      ].join('\n'),
    };

    const prompt = new AgentPromptBuilder().buildSystemPrompt({
      config: baseConfig,
      skills: [skill],
      tools: [],
    });

    expect(prompt).toContain('## Skill: browser-operation');
    expect(prompt).toContain('Use this skill when a task requires navigation or browser research.');
    expect(prompt).toContain('## Workflow');
    expect(prompt).toContain('## Preferred Tools');
    expect(prompt).not.toContain('## Relevant Files');
    expect(prompt).not.toContain('BrowserService.ts');
  });
});
