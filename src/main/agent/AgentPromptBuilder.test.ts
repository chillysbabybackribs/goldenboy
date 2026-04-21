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
        task: 'Plan a repo-wide migration strategy with sub agents',
        taskId: 'task-plans-orchestration',
      },
      skills: [],
      tools,
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
      tools,
    });

    expect(orchestrationPrompt).toContain('## Planning Contract');
    expect(orchestrationPrompt).toContain('## When To Use');
    expect(orchestrationPrompt).toContain('## Output Contract');

    expect(implementationPrompt).not.toContain('## Planning Contract');
    expect(implementationPrompt).not.toContain('## When To Use');
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
    expect(prompt).toContain('Every tool listed in your tool schema is already active');
    expect(prompt).toContain('Never use shell/terminal commands to reach the internet');
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
    expect(prompt).toContain('Every tool listed in your tool schema is already active');
  });
});
