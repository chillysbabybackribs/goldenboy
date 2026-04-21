import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeBrowserOperation } = vi.hoisted(() => ({
  executeBrowserOperation: vi.fn(),
}));

vi.mock('../browser/BrowserService', () => ({
  browserService: {
    executeInPage: vi.fn(),
    isCreated: vi.fn(() => true),
    getTabs: vi.fn(() => []),
    getState: vi.fn(() => ({ activeTabId: '', navigation: { url: '', title: '' } })),
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

  it('routes browser.get_element_state through the browser operation layer', async () => {
    executeBrowserOperation.mockResolvedValue({
      summary: 'Read element state for select.country',
      data: {
        selector: 'select.country',
        result: { selector: 'select.country', found: true, selectedValue: 'us' },
      },
    });

    const tool = createBrowserToolDefinitions().find(item => item.name === 'browser.get_element_state');
    expect(tool).toBeTruthy();

    const result = await tool!.execute(
      { selector: 'select.country', tabId: 'tab_8' },
      { runId: 'run_8', agentId: 'agent_8', mode: 'unrestricted-dev' },
    );

    expect(executeBrowserOperation).toHaveBeenCalledWith({
      kind: 'browser.get-element-state',
      payload: { selector: 'select.country', tabId: 'tab_8' },
    });
    expect(result).toEqual({
      summary: 'Read element state for select.country',
      data: {
        selector: 'select.country',
        result: { selector: 'select.country', found: true, selectedValue: 'us' },
      },
    });
  });

  it('routes browser.select_option through the browser operation layer', async () => {
    executeBrowserOperation.mockResolvedValue({
      summary: 'Selected option in select.country',
      data: {
        selector: 'select.country',
        requested: { value: 'us', label: null, index: null },
        result: { selected: true, selectedValue: 'us', selectedLabel: 'United States', selectedIndex: 1 },
      },
    });

    const tool = createBrowserToolDefinitions().find(item => item.name === 'browser.select_option');
    expect(tool).toBeTruthy();

    const result = await tool!.execute(
      { selector: 'select.country', value: 'us', tabId: 'tab_9' },
      { runId: 'run_9', agentId: 'agent_9', mode: 'unrestricted-dev' },
    );

    expect(executeBrowserOperation).toHaveBeenCalledWith({
      kind: 'browser.select-option',
      payload: { selector: 'select.country', value: 'us', label: undefined, index: undefined, tabId: 'tab_9' },
    });
    expect(result).toEqual({
      summary: 'Selected option in select.country',
      data: {
        selector: 'select.country',
        requested: { value: 'us', label: null, index: null },
        result: { selected: true, selectedValue: 'us', selectedLabel: 'United States', selectedIndex: 1 },
      },
    });
  });

  it('normalizes bare domains for browser.navigate_to', async () => {
    executeBrowserOperation.mockResolvedValue({
      summary: 'Navigated to https://example.com',
      data: { url: 'https://example.com' },
    });

    const tool = createBrowserToolDefinitions().find(item => item.name === 'browser.navigate_to');
    expect(tool).toBeTruthy();

    const result = await tool!.execute(
      { url: 'example' },
      { runId: 'run_3', agentId: 'agent_3', mode: 'unrestricted-dev' },
    );

    expect(executeBrowserOperation).toHaveBeenCalledWith({
      kind: 'browser.navigate',
      payload: { url: 'https://example.com' },
    });
    expect(result).toEqual({
      summary: 'Navigated to https://example.com',
      data: {
        url: 'https://example.com',
        inputUrl: 'example',
        normalizedUrl: 'https://example.com',
      },
    });
  });

  it('reduces all tabs to one Google homepage tab for browser.close_all_tabs', async () => {
    const { browserService } = await import('../browser/BrowserService');
    vi.mocked(browserService.getTabs)
      .mockReturnValueOnce([{ id: 'tab_1' }, { id: 'tab_2' }] as any)
      .mockReturnValueOnce([{ id: 'tab_1' }, { id: 'tab_2' }] as any)
      .mockReturnValueOnce([{ id: 'tab_1' }] as any);
    vi.mocked(browserService.getState).mockReturnValue({
      activeTabId: 'tab_1',
      navigation: { url: 'https://www.google.com/', title: 'Google', isLoading: false },
    } as any);
    executeBrowserOperation
      .mockResolvedValueOnce({ summary: 'Closed tab tab_2', data: {} })
      .mockResolvedValueOnce({ summary: 'Activated tab tab_1', data: {} })
      .mockResolvedValueOnce({ summary: 'Navigated to https://www.google.com/', data: { url: 'https://www.google.com/', title: 'Google' } });

    const tool = createBrowserToolDefinitions().find(item => item.name === 'browser.close_all_tabs');
    expect(tool).toBeTruthy();

    const result = await tool!.execute(
      {},
      { runId: 'run_4', agentId: 'agent_4', mode: 'unrestricted-dev' },
    );

    expect(executeBrowserOperation.mock.calls).toEqual([
      [{ kind: 'browser.close-tab', payload: { tabId: 'tab_2' } }],
      [{ kind: 'browser.activate-tab', payload: { tabId: 'tab_1' } }],
      [{ kind: 'browser.navigate', payload: { url: 'https://www.google.com/' } }],
    ]);
    expect(result).toEqual({
      summary: 'Closed 1 tab and reset the browser to Google',
      data: {
        tabIds: ['tab_2'],
        activeTabId: 'tab_1',
        tabs: [{ id: 'tab_1' }],
        url: 'https://www.google.com/',
        title: 'Google',
        homepageUrl: 'https://www.google.com/',
      },
    });
  });
});
