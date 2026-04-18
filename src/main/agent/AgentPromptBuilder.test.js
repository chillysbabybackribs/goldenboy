"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const AgentPromptBuilder_1 = require("./AgentPromptBuilder");
describe('buildResponseStyleAddendum', () => {
    it('does not apply browser-task response rules to browser-routing discussion', () => {
        const addendum = (0, AgentPromptBuilder_1.buildResponseStyleAddendum)('Change the prompt routing so the word browser does not auto-trigger a browser task');
        expect(addendum).toBe('');
    });
    it('keeps browser-task response rules for explicit browser actions', () => {
        const addendum = (0, AgentPromptBuilder_1.buildResponseStyleAddendum)('Please open a new browser tab and go to https://example.com');
        expect(addendum).toContain('For browser, research, and web tasks:');
        expect(addendum).toContain('Do not emit step-by-step progress commentary');
    });
});
describe('AgentPromptBuilder', () => {
    it('omits empty skills filler and uses compact guardrail sections', () => {
        const builder = new AgentPromptBuilder_1.AgentPromptBuilder();
        const prompt = builder.buildSystemPrompt({
            config: {
                agentId: 'gpt-5.4',
                role: 'primary',
                mode: 'unrestricted-dev',
                task: 'Tighten the runtime prompt assembly.',
                taskId: 'task-1',
            },
            skills: [],
            tools: [],
        });
        expect(prompt).toContain('## Runtime Identity');
        expect(prompt).toContain("You are the user's persistent V2 workspace agent");
        expect(prompt).toContain('Act on the user\'s behalf inside this application');
        expect(prompt).toContain('Start from observed state, not assumptions.');
        expect(prompt).toContain('## Execution Guardrails');
        expect(prompt).toContain('## Tooling Guardrails');
        expect(prompt).toContain('## V2 Guardrails');
        expect(prompt).toContain('browser.research_search');
        expect(prompt).not.toContain('## Skills\n\nNo task-specific skills loaded.');
        expect(prompt).not.toContain('## Tool Scope Recovery');
        expect(prompt).not.toContain('## User Visibility Rule');
        expect(prompt).not.toContain('## Workspace Artifact Rule');
        expect(prompt).not.toContain('## Web Access Hard Rule');
    });
    it('keeps strict source validation as a task-specific addendum', () => {
        const builder = new AgentPromptBuilder_1.AgentPromptBuilder();
        const prompt = builder.buildSystemPrompt({
            config: {
                agentId: 'haiku',
                role: 'primary',
                mode: 'unrestricted-dev',
                task: 'Research the latest OpenAI API pricing with linked sources.',
                taskId: 'task-2',
            },
            skills: [],
            tools: [],
        });
        expect(prompt).toContain('## Strict Source Validation Protocol');
    });
});
//# sourceMappingURL=AgentPromptBuilder.test.js.map