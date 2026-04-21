import { AgentPromptBuilder, buildResponseStyleAddendum } from './AgentPromptBuilder';
import { shouldUseStrictSourceValidation } from './sourceValidationPolicy';
import { AgentRuntimeConfig, AgentSkill } from './AgentTypes';
import { APP_WORKSPACE_ROOT } from '../workspaceRoot';
import { PRIMARY_PROVIDER_ID } from '../../shared/types/model';

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
      config: {
        ...baseConfig,
        agentId: PRIMARY_PROVIDER_ID,
      },
      skills: [],
      tools: [],
    });

    expect(prompt).toContain('## Source Validation');
    expect(prompt).toContain('never fabricate citations');
    expect(prompt).toContain('## Constraint Ledger');
    expect(prompt).toContain('single source of truth');
    expect(prompt).toContain('Before marking any result valid');
    expect(prompt).toContain('## Physical Task Completion');
    expect(prompt).toContain('perform it via tools');
    expect(prompt).toContain('## Workspace Root');
    expect(prompt).toContain(APP_WORKSPACE_ROOT);
    expect(prompt).toContain('## Operating Rules');
    expect(prompt).toContain('## Deterministic Validation Authority');
    expect(prompt).not.toContain('## Result Validation Discipline');
    expect(prompt).not.toMatch(/Current date\/time: [A-Z][a-z]+day,/);
    expect(prompt).toContain('Current date/time is provided in the user-turn runtime context below');
    expect(prompt).toContain('## Tool Map');
    expect(prompt).toContain('Every tool listed in your tool schema is already active for this run');
    expect(prompt).toContain('`context.load`');
    expect(prompt).not.toContain('## Tool Catalog');
    expect(prompt).not.toContain('tool-runtime.html');
    expect(prompt).not.toContain('window.runTool');
    expect(prompt).not.toContain('runtime.search_tools');
    expect(prompt).not.toContain('runtime.load_tools');
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

    expect(prompt).toContain('## Source Validation');
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

  it('treats architectural audits differently from code review findings', () => {
    const addendum = buildResponseStyleAddendum('Audit the prompt and tool architecture for conflicts');

    expect(addendum).toContain('Current state and the main tensions or conflicts.');
    expect(addendum).toContain('Concrete recommendations, ordered by leverage.');
    expect(addendum).not.toContain('Findings first, ordered by severity.');
  });

  it('treats code review requests as findings-first review tasks', () => {
    const addendum = buildResponseStyleAddendum('Audit this diff for regressions and code review findings');

    expect(addendum).toContain('Findings first, ordered by severity.');
    expect(addendum).toContain('Each finding must include a file reference when available.');
  });
});
