import { describe, expect, it } from 'vitest';
import { AgentPromptBuilder } from './AgentPromptBuilder';
import type { AgentToolDefinition } from './AgentTypes';
import { GEMINI_PROVIDER_ID, PRIMARY_PROVIDER_ID } from '../../shared/types/model';

describe('AgentPromptBuilder', () => {
  const promptBuilder = new AgentPromptBuilder();
  const tools: AgentToolDefinition[] = [{
    name: 'terminal.exec',
    description: 'Run a terminal command',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        command: { type: 'string' },
      },
    },
    async execute() {
      return {
        summary: 'listed',
        data: {},
      };
    },
  }];
  const browserTools: AgentToolDefinition[] = [
    ...tools,
    {
      name: 'browser.navigate',
      description: 'Navigate the active tab to a URL.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { url: { type: 'string' } },
        required: ['url'],
      },
      async execute() {
        return {
          summary: 'navigated',
          data: {},
        };
      },
    },
  ];
  const filesystemTools: AgentToolDefinition[] = [
    {
      name: 'filesystem.read',
      description: 'Read a file from the workspace.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      async execute() {
        return {
          summary: 'read',
          data: {},
        };
      },
    },
  ];
  const answerTools: AgentToolDefinition[] = [
    ...tools,
    {
      name: 'answer.submit',
      description: 'Submit a grounded final answer.',
      inputSchema: {
        type: 'object',
        properties: {
          claims: { type: 'array' },
          unresolved: { type: 'array' },
        },
        required: ['claims', 'unresolved'],
      },
      async execute() {
        return {
          summary: 'accepted',
          data: {},
        };
      },
    },
  ];
  const submitOnlyTools: AgentToolDefinition[] = [answerTools[1]];
  const subagentTools: AgentToolDefinition[] = [
    ...tools,
    {
      name: 'subagent.spawn',
      description: 'Spawn a runtime-managed child agent',
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string' },
          providerId: { type: 'string' },
          modelId: { type: 'string' },
        },
        required: ['task'],
      },
      async execute() {
        return {
          summary: 'spawned',
          data: {},
        };
      },
    },
  ];

  it('injects the planning contract only for orchestration prompts', () => {
    const orchestrationPrompt = promptBuilder.buildSystemPrompt({
      config: {
        mode: 'unrestricted-dev',
        agentId: PRIMARY_PROVIDER_ID,
        role: 'primary',
        task: 'Split this work across multiple agents and run in parallel',
        taskId: 'task-plans-orchestration',
      },
      skills: [],
      tools: filesystemTools,
    });

    const implementationPrompt = promptBuilder.buildSystemPrompt({
      config: {
        mode: 'unrestricted-dev',
        agentId: PRIMARY_PROVIDER_ID,
        role: 'primary',
        task: 'Patch this TypeScript file and run the local build',
        taskId: 'task-plans-implementation',
      },
      skills: [],
      tools: filesystemTools,
    });

    expect(orchestrationPrompt).toContain('## Planning Contract');
    expect(orchestrationPrompt).toContain('## Planning Workflow');
    expect(orchestrationPrompt).toContain('## Output Contract');

    expect(implementationPrompt).not.toContain('## Planning Contract');
    expect(implementationPrompt).not.toContain('## Planning Workflow');
  });

  it('surfaces the selected execution mode in the system prompt', () => {
    const prompt = promptBuilder.buildSystemPrompt({
      config: {
        mode: 'unrestricted-dev',
        agentId: PRIMARY_PROVIDER_ID,
        role: 'primary',
        task: 'How do we set up a watcher for this repo and which files would we need to edit?',
        taskId: 'task-execution-mode-plan-only',
      },
      skills: [],
      tools: filesystemTools,
    });

    expect(prompt).toContain('## Execution Mode');
    expect(prompt).toContain('Task kind: implementation');
    expect(prompt).toContain('Execution mode: single-pass');
    expect(prompt).toContain('eligible for direct execution');
  });

  it('uses the runtime task-profile override when surfacing execution mode', () => {
    const prompt = promptBuilder.buildSystemPrompt({
      config: {
        mode: 'unrestricted-dev',
        agentId: PRIMARY_PROVIDER_ID,
        role: 'primary',
        task: 'User request: enough, just start',
        taskProfileOverride: {
          kind: 'implementation',
          executionMode: 'single-pass',
        },
        taskId: 'task-execution-mode-override',
      },
      skills: [],
      tools,
    });

    expect(prompt).toContain('Task kind: implementation');
    expect(prompt).toContain('Execution mode: single-pass');
    expect(prompt).toContain('eligible for direct execution');
  });

  it('advertises tool categories via the map and forbids shell-based web access', () => {
    const prompt = promptBuilder.buildSystemPrompt({
      config: {
        mode: 'unrestricted-dev',
        agentId: GEMINI_PROVIDER_ID,
        role: 'primary',
        task: 'Research current API pricing and summarize it',
        taskId: 'task-gemini-prompt-contract',
      },
      skills: [],
      tools,
    });

    expect(prompt).toContain('## Tool Map');
    expect(prompt).toContain('`browser`');
    expect(prompt).toContain('`filesystem`');
    expect(prompt).toContain('Every tool in your schema is already active');
    expect(prompt).toContain('Use `browser.*` for web work');
  });

  it('marks active and inactive categories in the tool map based on the scoped tool list', () => {
    const prompt = promptBuilder.buildSystemPrompt({
      config: {
        mode: 'unrestricted-dev',
        agentId: GEMINI_PROVIDER_ID,
        role: 'primary',
        task: 'Close out all browser tabs',
        taskId: 'task-gemini-browser-surface-contract',
      },
      skills: [],
      tools: browserTools,
    });

    expect(prompt).toContain('## Tool Map');
    expect(prompt).toContain('`browser` [active]');
    expect(prompt).toContain('`filesystem` [inactive]');
  });

  it('includes the structured response format guidance from the agent contract', () => {
    const prompt = promptBuilder.buildSystemPrompt({
      config: {
        mode: 'unrestricted-dev',
        agentId: PRIMARY_PROVIDER_ID,
        role: 'primary',
        task: 'Answer a simple question',
        taskId: 'task-structured-response-format',
      },
      skills: [],
      tools,
    });

    expect(prompt).toContain('## Structured Response Format');
    expect(prompt).toContain('Lead with the answer, result, or finding.');
    expect(prompt).toContain('Do not open by echoing, paraphrasing, or congratulating the user');
  });

  it('omits the workspace overview when the active tools cannot inspect the repo', () => {
    const prompt = promptBuilder.buildSystemPrompt({
      config: {
        mode: 'unrestricted-dev',
        agentId: PRIMARY_PROVIDER_ID,
        role: 'primary',
        task: 'Just submit a grounded answer',
        taskId: 'task-no-workspace-overview',
      },
      skills: [],
      tools: submitOnlyTools,
    });

    expect(prompt).not.toContain('## Workspace Overview');
  });

  it('keeps the system prompt byte-stable by excluding the volatile current timestamp for every agent', () => {
    const geminiPrompt = promptBuilder.buildSystemPrompt({
      config: {
        mode: 'unrestricted-dev',
        agentId: GEMINI_PROVIDER_ID,
        role: 'primary',
        task: 'Summarize the task state',
        taskId: 'task-gemini-stable-prefix',
      },
      skills: [],
      tools,
    });
    const primaryPrompt = promptBuilder.buildSystemPrompt({
      config: {
        mode: 'unrestricted-dev',
        agentId: PRIMARY_PROVIDER_ID,
        role: 'primary',
        task: 'Summarize the task state',
        taskId: 'task-primary-stable-prefix',
      },
      skills: [],
      tools,
    });

    for (const prompt of [geminiPrompt, primaryPrompt]) {
      expect(prompt).not.toMatch(/Current date\/time: [A-Z][a-z]+day,/);
      expect(prompt).not.toContain('Do not rely on a volatile timestamp string');
      expect(prompt).toContain('Current date/time is provided in the user-turn runtime context below');
    }
  });

  it('exposes a per-section breakdown that matches the final system prompt length', () => {
    const input = {
      config: {
        mode: 'unrestricted-dev' as const,
        agentId: PRIMARY_PROVIDER_ID,
        role: 'primary',
        task: 'Implement a small helper',
        taskId: 'task-breakdown',
      },
      skills: [],
      tools: browserTools,
    };

    const breakdown = promptBuilder.describeSystemPromptSections(input);
    const prompt = promptBuilder.buildSystemPrompt(input);

    expect(breakdown.total).toBeGreaterThan(0);
    expect(breakdown.total).toBe(breakdown.sections.reduce((acc, section) => acc + section.chars, 0));
    expect(prompt.length).toBeGreaterThanOrEqual(breakdown.total - 200);
    expect(prompt.length).toBeLessThanOrEqual(breakdown.total + 200);

    const sectionNames = breakdown.sections.map((section) => section.name);
    expect(sectionNames).toContain('baseContract');
    expect(sectionNames).toContain('activeRuntime');
    expect(sectionNames).toContain('toolCategoryMap');

    const toolMap = breakdown.sections.find((section) => section.name === 'toolCategoryMap');
    expect(toolMap?.chars).toBeGreaterThan(0);
  });

  it('advertises the subagent category in the tool map', () => {
    const prompt = promptBuilder.buildSystemPrompt({
      config: {
        mode: 'unrestricted-dev',
        agentId: GEMINI_PROVIDER_ID,
        role: 'primary',
        task: 'Delegate a review sub-agent',
        taskId: 'task-subagent-hint',
      },
      skills: [],
      tools: subagentTools,
    });

    expect(prompt).toContain('## Tool Map');
    expect(prompt).toContain('`subagent`');
    expect(prompt).toContain('Every tool in your schema is already active');
  });

  it('adds finalization instructions when answer.submit is in scope', () => {
    const prompt = promptBuilder.buildSystemPrompt({
      config: {
        mode: 'unrestricted-dev',
        agentId: PRIMARY_PROVIDER_ID,
        role: 'primary',
        task: 'Finish with grounded claims',
        taskId: 'task-finalization',
      },
      skills: [],
      tools: answerTools,
    });

    expect(prompt).toContain('## Finalizing Your Answer');
    expect(prompt).toContain('`answer.submit`');
    expect(prompt).toContain('Every claim must include at least one `evidence` entry');
    expect(prompt).toContain('Use `unresolved`');
  });

  it('tells the model to follow loaded skills as the operating procedure', () => {
    const prompt = promptBuilder.buildSystemPrompt({
      config: {
        mode: 'unrestricted-dev',
        agentId: PRIMARY_PROVIDER_ID,
        role: 'primary',
        task: 'Implement a local code change',
        taskId: 'task-skill-pointer',
      },
      skills: [{
        name: 'code-edit',
        path: '/tmp/code-edit/SKILL.md',
        description: 'Use this skill when a task requires patching source files.',
        allowedTools: ['filesystem.read', 'filesystem.patch'],
        references: [],
        body: [
          '# Code Edit',
          '',
          'Use this skill when a task requires patching source files.',
          '',
          '## Workflow',
          '',
          '1. Read before editing.',
          '2. Patch narrowly.',
        ].join('\n'),
      }],
      tools,
    });

    expect(prompt).toContain('## Skills');
    expect(prompt).toContain('treat them as the operating procedure for the task');
    expect(prompt).toContain('## Skill: code-edit');
  });
});
