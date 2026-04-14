import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeBrowserOperation } = vi.hoisted(() => ({
  executeBrowserOperation: vi.fn(),
}));

vi.mock('../browser/BrowserService', () => ({
  browserService: {
    executeInPage: vi.fn(),
    isCreated: vi.fn(() => true),
  },
}));

vi.mock('../browser/browserOperations', () => ({ executeBrowserOperation }));

import { buildWaitForTextExpression, createBrowserToolDefinitions } from './tools/browserTools';

describe('buildWaitForTextExpression', () => {
  it('includes form control values in the page text probe', () => {
    const expression = buildWaitForTextExpression();

    expect(expression).toContain("document.querySelectorAll('input, textarea, select')");
    expect(expression).toContain("'value' in element");
    expect(expression).toContain('element.selectedOptions');
    expect(expression).toContain('document.body?.innerText');
  });
});

describe('createBrowserToolDefinitions', () => {
  beforeEach(() => {
    executeBrowserOperation.mockReset();
  });

  it('routes browser.navigate through the browser operation layer', async () => {
    executeBrowserOperation.mockResolvedValue({
      summary: 'Navigated to https://example.com',
      data: { url: 'https://example.com' },
    });

    const tool = createBrowserToolDefinitions().find(item => item.name === 'browser.navigate');
    expect(tool).toBeTruthy();

    const result = await tool!.execute(
      { url: 'https://example.com' },
      { runId: 'run_1', agentId: 'agent_1', mode: 'unrestricted-dev' },
    );

    expect(executeBrowserOperation).toHaveBeenCalledWith({
      kind: 'browser.navigate',
      payload: { url: 'https://example.com' },
    });
    expect(result).toEqual({
      summary: 'Navigated to https://example.com',
      data: { url: 'https://example.com' },
    });
  });

  it('routes browser.click through the browser operation layer', async () => {
    executeBrowserOperation.mockResolvedValue({
      summary: 'Clicked: button.submit',
      data: { selector: 'button.submit', result: { clicked: true } },
    });

    const tool = createBrowserToolDefinitions().find(item => item.name === 'browser.click');
    expect(tool).toBeTruthy();

    const result = await tool!.execute(
      { selector: 'button.submit', tabId: 'tab_1' },
      { runId: 'run_2', agentId: 'agent_2', mode: 'unrestricted-dev' },
    );

    expect(executeBrowserOperation).toHaveBeenCalledWith({
      kind: 'browser.click',
      payload: { selector: 'button.submit', tabId: 'tab_1' },
    });
    expect(result).toEqual({
      summary: 'Clicked: button.submit',
      data: { selector: 'button.submit', result: { clicked: true } },
    });
  });
});
