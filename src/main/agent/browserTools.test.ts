import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeBrowserOperation, recordTabFinding } = vi.hoisted(() => ({
  executeBrowserOperation: vi.fn(),
  recordTabFinding: vi.fn(),
}));

vi.mock('../browser/BrowserService', () => ({
  browserService: {
    executeInPage: vi.fn(),
    isCreated: vi.fn(() => true),
    getTabs: vi.fn(() => [
      {
        id: 'tab_1',
        navigation: {
          url: 'https://example.com',
          title: 'Example',
          canGoBack: false,
          canGoForward: false,
          isLoading: false,
          loadingProgress: null,
          favicon: '',
          lastNavigationAt: null,
        },
        status: 'ready',
        zoomLevel: 0,
        muted: false,
        isAudible: false,
        createdAt: 1,
      },
    ]),
    getState: vi.fn(() => ({ activeTabId: 'tab_1', navigation: { url: 'https://example.com', title: 'Example' } })),
    recordTabFinding,
  },
}));

const EXPECTED_TAB_ECHO = {
  activeTabId: 'tab_1',
  tabs: [
    { id: 'tab_1', url: 'https://example.com', title: 'Example', isLoading: false },
  ],
};

vi.mock('../browser/browserOperations', () => ({ executeBrowserOperation }));

import { buildWaitForTextExpression, createBrowserToolDefinitions } from './tools/browser';

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
    recordTabFinding.mockReset();
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
      data: { url: 'https://example.com', ...EXPECTED_TAB_ECHO },
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
      data: { selector: 'button.submit', result: { clicked: true }, ...EXPECTED_TAB_ECHO },
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
        ...EXPECTED_TAB_ECHO,
      },
    });
  });

  it('normalizes bare domains when browser.navigate is called with normalize=true', async () => {
    executeBrowserOperation.mockResolvedValue({
      summary: 'Navigated to https://example.com',
      data: { url: 'https://example.com' },
    });

    const tool = createBrowserToolDefinitions().find(item => item.name === 'browser.navigate');
    expect(tool).toBeTruthy();

    const result = await tool!.execute(
      { url: 'example', normalize: true },
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
        ...EXPECTED_TAB_ECHO,
      },
    });
  });

  it('echoes {activeTabId, tabs} on action tools so the model keeps a fresh cross-tab inventory without re-calling browser.tabs', async () => {
    executeBrowserOperation.mockResolvedValue({
      summary: 'Typed into input.search',
      data: { selector: 'input.search', result: { typed: true } },
    });

    const tool = createBrowserToolDefinitions().find(item => item.name === 'browser.type');
    expect(tool).toBeTruthy();

    const result = await tool!.execute(
      { selector: 'input.search', text: 'hello' },
      { runId: 'run_echo', agentId: 'agent_echo', mode: 'unrestricted-dev' },
    );

    expect(result.data).toMatchObject({
      selector: 'input.search',
      result: { typed: true },
      activeTabId: 'tab_1',
    });
    expect(Array.isArray(result.data.tabs)).toBe(true);
    expect(result.data.tabs).toEqual([
      { id: 'tab_1', url: 'https://example.com', title: 'Example', isLoading: false },
    ]);
  });

  it('no longer exposes browser.tabs — tab state lives in the per-turn prompt and the tab-echo on mutating tool responses', () => {
    const names = createBrowserToolDefinitions().map(tool => tool.name);
    expect(names).not.toContain('browser.tabs');
  });

  it('exposes browser.record_finding for pinning research into task memory', async () => {
    recordTabFinding.mockResolvedValue({
      id: 'finding_1',
      taskId: 'task_7',
      tabId: 'tab_1',
      snapshotId: null,
      title: 'Claude Sonnet 4.5 price',
      summary: '$3 input / $15 output per million tokens',
      severity: 'info',
      evidence: ['anthropic.com/pricing lists $3/$15.'],
      createdAt: 12345,
    });

    const tool = createBrowserToolDefinitions().find(item => item.name === 'browser.record_finding');
    expect(tool).toBeTruthy();

    const result = await tool!.execute(
      {
        title: 'Claude Sonnet 4.5 price',
        summary: '$3 input / $15 output per million tokens',
        severity: 'info',
        evidence: ['anthropic.com/pricing lists $3/$15.'],
      },
      { runId: 'run_f', agentId: 'agent_f', mode: 'unrestricted-dev', taskId: 'task_7' },
    );

    expect(recordTabFinding).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task_7',
      title: 'Claude Sonnet 4.5 price',
      summary: '$3 input / $15 output per million tokens',
      severity: 'info',
      snapshotId: null,
    }));
    expect(result.summary).toContain('Pinned finding');
    expect(result.data).toMatchObject({
      findingId: 'finding_1',
      tabId: 'tab_1',
      title: 'Claude Sonnet 4.5 price',
      severity: 'info',
      evidenceCount: 1,
      activeTabId: 'tab_1',
    });
    expect(Array.isArray(result.data.tabs)).toBe(true);
  });

  it('rejects browser.record_finding when invoked without a task context', async () => {
    const tool = createBrowserToolDefinitions().find(item => item.name === 'browser.record_finding');
    expect(tool).toBeTruthy();
    await expect(
      tool!.execute(
        { title: 'stray', summary: 'no task' },
        { runId: 'run_f', agentId: 'agent_f', mode: 'unrestricted-dev' },
      ),
    ).rejects.toThrow(/task context/i);
    expect(recordTabFinding).not.toHaveBeenCalled();
  });

  it('coerces unknown severity values on browser.record_finding to info', async () => {
    recordTabFinding.mockResolvedValue({
      id: 'finding_2',
      taskId: 'task_8',
      tabId: 'tab_1',
      snapshotId: null,
      title: 't',
      summary: 's',
      severity: 'info',
      evidence: [],
      createdAt: 1,
    });

    const tool = createBrowserToolDefinitions().find(item => item.name === 'browser.record_finding');
    await tool!.execute(
      { title: 't', summary: 's', severity: 'bogus' },
      { runId: 'run_f', agentId: 'agent_f', mode: 'unrestricted-dev', taskId: 'task_8' },
    );
    expect(recordTabFinding).toHaveBeenCalledWith(expect.objectContaining({ severity: 'info' }));
  });
});
