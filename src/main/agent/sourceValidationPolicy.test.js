"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const AgentPromptBuilder_1 = require("./AgentPromptBuilder");
const sourceValidationPolicy_1 = require("./sourceValidationPolicy");
const baseConfig = {
    mode: 'unrestricted-dev',
    agentId: 'test-agent',
    role: 'primary',
    task: 'hello',
};
describe('source validation policy', () => {
    it('enables strict validation for factual research tasks', () => {
        expect((0, sourceValidationPolicy_1.shouldUseStrictSourceValidation)('Look up the latest OpenAI API pricing')).toBe(true);
        expect((0, sourceValidationPolicy_1.shouldUseStrictSourceValidation)('Verify the current FDA guidance')).toBe(true);
        expect((0, sourceValidationPolicy_1.shouldUseStrictSourceValidation)('Find authoritative sources for this legal rule')).toBe(true);
    });
    it('does not enable strict validation for low-risk writing tasks', () => {
        expect((0, sourceValidationPolicy_1.shouldUseStrictSourceValidation)('Rewrite this paragraph to be shorter')).toBe(false);
        expect((0, sourceValidationPolicy_1.shouldUseStrictSourceValidation)('Brainstorm names for a local dev tool')).toBe(false);
    });
    it('always injects the compact source rule, constraint ledger, and task completion protocol', () => {
        const prompt = new AgentPromptBuilder_1.AgentPromptBuilder().buildSystemPrompt({
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
        const prompt = new AgentPromptBuilder_1.AgentPromptBuilder().buildSystemPrompt({
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
        const skill = {
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
        const prompt = new AgentPromptBuilder_1.AgentPromptBuilder().buildSystemPrompt({
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
//# sourceMappingURL=sourceValidationPolicy.test.js.map