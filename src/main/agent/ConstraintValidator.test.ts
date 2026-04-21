import { describe, expect, it } from 'vitest';
import { validateToolResult } from './ConstraintValidator';

describe('ConstraintValidator', () => {
  it('validates closed browser tabs against post-action tab state', () => {
    const result = validateToolResult(
      'browser.close_tab',
      {
        summary: 'Closed 2 browser tabs',
        data: {
          tabIds: ['tab-1', 'tab-2'],
          activeTabId: 'tab-3',
          tabs: [{ id: 'tab-3' }],
        },
      },
      { tabIds: ['tab-1', 'tab-2'] },
    );

    expect(result?.status).toBe('VALID');
    expect(result?.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'tab_closed',
        status: 'PASS',
      }),
    ]));
  });

  it('marks browser tab close as invalid when the requested tab is still present', () => {
    const result = validateToolResult(
      'browser.close_tab',
      {
        summary: 'Closed 1 browser tab',
        data: {
          tabIds: ['tab-2'],
          activeTabId: 'tab-2',
          tabs: [{ id: 'tab-2' }, { id: 'tab-3' }],
        },
      },
      { tabId: 'tab-2' },
    );

    expect(result?.status).toBe('INVALID');
    expect(result?.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'tab_closed',
        status: 'FAIL',
      }),
    ]));
  });

  it('validates browser activate_tab against activeTabId', () => {
    const result = validateToolResult(
      'browser.activate_tab',
      {
        summary: 'Activated tab tab-9',
        data: {
          tabId: 'tab-9',
          activeTabId: 'tab-9',
          tabs: [{ id: 'tab-9' }, { id: 'tab-3' }],
        },
      },
      { tabId: 'tab-9' },
    );

    expect(result?.status).toBe('VALID');
    expect(result?.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'active_tab',
        status: 'PASS',
      }),
    ]));
  });

  it('validates browser navigate_to against the normalized target', () => {
    const result = validateToolResult(
      'browser.navigate_to',
      {
        summary: 'Navigated to https://example.com',
        data: {
          url: 'https://example.com',
          normalizedUrl: 'https://example.com',
        },
      },
      { url: 'example' },
    );

    expect(result?.status).toBe('VALID');
    expect(result?.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'navigation_target',
        status: 'PASS',
      }),
    ]));
  });

  it('validates browser get_element_state returns deterministic selector state', () => {
    const result = validateToolResult(
      'browser.get_element_state',
      {
        summary: 'Read element state for select.country',
        data: {
          selector: 'select.country',
          result: {
            selector: 'select.country',
            found: true,
            selectedValue: 'us',
          },
        },
      },
      { selector: 'select.country' },
    );

    expect(result?.status).toBe('VALID');
    expect(result?.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'element_state_returned',
        status: 'PASS',
      }),
    ]));
  });

  it('validates browser select_option against the requested value', () => {
    const result = validateToolResult(
      'browser.select_option',
      {
        summary: 'Selected option in select.country',
        data: {
          selector: 'select.country',
          requested: { value: 'us', label: null, index: null },
          result: {
            selected: true,
            selectedValue: 'us',
            selectedLabel: 'United States',
            selectedIndex: 1,
          },
        },
      },
      { selector: 'select.country', value: 'us' },
    );

    expect(result?.status).toBe('VALID');
    expect(result?.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'option_selected',
        status: 'PASS',
      }),
      expect.objectContaining({
        name: 'selected_value',
        status: 'PASS',
      }),
    ]));
  });

  it('validates browser close_all_tabs against a single Google homepage tab', () => {
    const result = validateToolResult(
      'browser.close_all_tabs',
      {
        summary: 'Closed 2 tabs and reset the browser to Google',
        data: {
          activeTabId: 'tab-1',
          tabs: [{
            id: 'tab-1',
            navigation: { url: 'https://www.google.com/' },
          }],
          url: 'https://www.google.com/',
          homepageUrl: 'https://www.google.com/',
        },
      },
      {},
    );

    expect(result?.status).toBe('VALID');
    expect(result?.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'single_tab_remaining',
        status: 'PASS',
      }),
      expect.objectContaining({
        name: 'homepage_target',
        status: 'PASS',
      }),
    ]));
  });

  it('does not treat source-text matches in read-only terminal inspection output as execution errors', () => {
    const result = validateToolResult(
      'terminal.exec',
      {
        summary: 'Read file contents',
        data: {
          output: 'const message = "error: this is source text, not stderr";',
          exitCode: 0,
        },
      },
      { command: 'sed -n \'1,40p\' src/main/agent/AgentPromptBuilder.ts' },
    );

    expect(result?.status).toBe('VALID');
    expect(result?.constraints).toEqual(expect.not.arrayContaining([
      expect.objectContaining({
        name: 'output_error_signals',
      }),
    ]));
  });
});
