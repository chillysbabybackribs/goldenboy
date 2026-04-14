import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeBrowserOperation } = vi.hoisted(() => ({
  executeBrowserOperation: vi.fn(),
}));

vi.mock('../browser/browserOperations', () => ({ executeBrowserOperation }));

import { executeBrowserAction } from './browserActionExecutor';

describe('executeBrowserAction', () => {
  beforeEach(() => {
    executeBrowserOperation.mockReset();
  });

  it('forwards surface browser actions to the authoritative browser operation layer', async () => {
    executeBrowserOperation.mockResolvedValue({
      summary: 'Opened tab: https://example.com',
      data: { tabId: 'tab_1' },
    });

    const result = await executeBrowserAction(
      'browser.create-tab',
      { url: 'https://example.com' },
      { taskId: 'task_1', origin: 'command-center' },
    );

    expect(executeBrowserOperation).toHaveBeenCalledWith({
      kind: 'browser.create-tab',
      payload: { url: 'https://example.com' },
      context: {
        taskId: 'task_1',
        contextId: null,
        source: 'ui',
      },
    });
    expect(result).toEqual({
      summary: 'Opened tab: https://example.com',
      data: { tabId: 'tab_1' },
    });
  });

  it('rejects non-browser actions', async () => {
    await expect(executeBrowserAction('terminal.execute', { command: 'pwd' }))
      .rejects
      .toThrow('Unknown browser action kind: terminal.execute');
  });
});
