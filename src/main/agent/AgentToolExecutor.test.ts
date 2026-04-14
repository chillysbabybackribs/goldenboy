import { describe, expect, it } from 'vitest';

import { getBrowserOperationContext } from '../browser/browserOperationContext';
import { AgentToolExecutor } from './AgentToolExecutor';
import type { AgentToolDefinition } from './AgentTypes';

describe('AgentToolExecutor', () => {
  it('provides browser operation context to browser tools', async () => {
    const executor = new AgentToolExecutor();
    const tool: AgentToolDefinition<{ url: string }> = {
      name: 'browser.navigate',
      description: 'Test browser tool',
      inputSchema: { type: 'object' },
      async execute() {
        return {
          summary: 'ok',
          data: {
            context: getBrowserOperationContext(),
          },
        };
      },
    };

    executor.register(tool);

    const result = await executor.execute(
      'browser.navigate',
      { url: 'https://example.com' },
      {
        runId: 'run_1',
        agentId: 'agent_1',
        mode: 'unrestricted-dev',
        taskId: 'task_1',
      },
    );

    expect(result.data.context).toEqual({
      source: 'agent',
      taskId: 'task_1',
      agentId: 'agent_1',
      runId: 'run_1',
      contextId: null,
    });
  });
});
