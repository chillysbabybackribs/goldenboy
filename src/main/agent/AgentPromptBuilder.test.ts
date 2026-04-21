import { describe, expect, it } from 'vitest';
import { AgentPromptBuilder } from './AgentPromptBuilder';
import type { AgentToolDefinition } from './AgentTypes';
import { GEMINI_PROVIDER_ID, PRIMARY_PROVIDER_ID } from '../../shared/types/model';

describe('AgentPromptBuilder', () => {
  const promptBuilder = new AgentPromptBuilder();
  const tools: AgentToolDefinition[] = [{
    name: 'runtime.list_loaded_tools',
    description: 'List loaded tools',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
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
      name: 'browser.close_all_tabs',
      description: 'Close all tabs',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
      async execute() {
        return {
          summary: 'closed tabs',
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

  it('applies the v2 tool priority rules to gemini prompts', () => {
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

    expect(prompt).toContain('## V2 Tool Priority');
    expect(prompt).toContain('## Web Access Hard Rule');
    expect(prompt).toContain('browser.research_search');
    expect(prompt).toContain('## Gemini Execution Rules');
    expect(prompt).toContain('single minimal next tool call');
  });

  it('describes browser tab invariants without requiring them in user-facing answers', () => {
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

    expect(prompt).toContain('## Browser Surface Model');
    expect(prompt).toContain('`browser.close_all_tabs` is a standard reset operation.');
    expect(prompt).toContain('Do not mention it in the final answer unless the user asks');
  });

  it('avoids injecting a volatile current timestamp into gemini prompts', () => {
    const prompt = promptBuilder.buildSystemPrompt({
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

    expect(prompt).toContain('Do not rely on a volatile timestamp string');
    expect(prompt).not.toContain('Use this as the authoritative current date/time context');
  });
});
