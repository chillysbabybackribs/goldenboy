import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HAIKU_PROVIDER_ID } from '../../../shared/types/model';
import type { AgentToolContext } from '../AgentTypes';
import { scopeForPrompt, withBrowserSearchDirective } from '../runtimeScope';

const { runtimeRunMock } = vi.hoisted(() => ({
  runtimeRunMock: vi.fn(),
}));

vi.mock('../AgentRuntime', () => ({
  AgentRuntime: class MockAgentRuntime {
    constructor(_provider: unknown) {}

    run(config: unknown) {
      return runtimeRunMock(config);
    }
  },
}));

vi.mock('../HaikuProvider', () => ({
  HaikuProvider: class MockHaikuProvider {},
}));

import { createHaikuBrowserSessionToolDefinition } from './haikuBrowserSessionTool';

describe('runtime.haiku_browser_session', () => {
  beforeEach(() => {
    runtimeRunMock.mockReset();
  });

  it('runs a normal Haiku browser session and writes the raw response to disk', async () => {
    const responseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-browser-session-tool-test-'));
    const responsePath = path.join(responseDir, 'response.md');
    runtimeRunMock.mockResolvedValue({
      runId: 'child-run-1',
      output: 'Observed the page and collected the result.',
      usage: {
        inputTokens: 12,
        outputTokens: 8,
        durationMs: 25,
      },
    });

    const progress: string[] = [];
    const tool = createHaikuBrowserSessionToolDefinition();
    const context: AgentToolContext = {
      runId: 'parent-run-1',
      agentId: 'gpt-5.4',
      mode: 'unrestricted-dev',
      taskId: 'task-1',
      onProgress: (status) => {
        progress.push(status);
      },
    };
    const prompt = 'Search for the latest Electron release notes and summarize the result.';
    const expectedScope = scopeForPrompt(prompt, { kind: 'research' });

    const result = await tool.execute({
      prompt,
      responsePath,
    }, context);

    expect(runtimeRunMock).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'unrestricted-dev',
      agentId: HAIKU_PROVIDER_ID,
      role: 'primary',
      task: withBrowserSearchDirective(prompt, { kind: 'research' }),
      taskId: 'task-1',
      allowedTools: expectedScope.allowedTools,
      canSpawnSubagents: expectedScope.canSpawnSubagents,
      maxToolTurns: expectedScope.maxToolTurns,
      skillNames: expectedScope.skillNames,
    }));
    expect(result.summary).toContain(responsePath);
    expect(result.data).toMatchObject({
      responsePath,
      childRunId: 'child-run-1',
      taskKind: 'research',
    });
    expect(fs.existsSync(responsePath)).toBe(true);
    expect(fs.readFileSync(responsePath, 'utf-8')).toBe('Observed the page and collected the result.');
    expect(progress).toEqual([
      'haiku-browser-session:start',
      'haiku-browser-session:done:' + responsePath,
    ]);
  });

  it('rejects calls originating from a Haiku parent run', async () => {
    const tool = createHaikuBrowserSessionToolDefinition();

    await expect(tool.execute(
      { prompt: 'Inspect the current page.' },
      {
        runId: 'parent-run-2',
        agentId: HAIKU_PROVIDER_ID,
        mode: 'unrestricted-dev',
      },
    )).rejects.toThrow('runtime.haiku_browser_session cannot be called from a Haiku parent run.');
  });
});
