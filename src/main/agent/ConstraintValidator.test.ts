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

  it('accepts the required homepage survivor when closing the last remaining tab', () => {
    const result = validateToolResult(
      'browser.close_tab',
      {
        summary: 'Closed 1 browser tab',
        data: {
          tabIds: ['tab-2'],
          activeTabId: 'tab-2',
          tabs: [{ id: 'tab-2', url: 'https://www.google.com/' }],
        },
      },
      { tabId: 'tab-2' },
    );

    expect(result?.status).toBe('VALID');
    expect(result?.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'tab_closed',
        status: 'PASS',
      }),
    ]));
  });

  it('validates browser close_tab with all=true from the returned tabIds', () => {
    const result = validateToolResult(
      'browser.close_tab',
      {
        summary: 'Closed all 3 browser tabs',
        data: {
          tabIds: ['tab-1', 'tab-2', 'tab-3'],
          all: true,
          activeTabId: 'tab-3',
          tabs: [{ id: 'tab-3', url: 'https://www.google.com/' }],
        },
      },
      { all: true },
    );

    expect(result?.status).toBe('VALID');
    expect(result?.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'tab_closed',
        status: 'PASS',
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

  it('validates browser navigate with normalize=true against the normalized target', () => {
    const result = validateToolResult(
      'browser.navigate',
      {
        summary: 'Navigated to https://example.com',
        data: {
          url: 'https://example.com',
          normalizedUrl: 'https://example.com',
        },
      },
      { url: 'example', normalize: true },
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

  it('validates structured repository build results', () => {
    const result = validateToolResult(
      'terminal.build_repo',
      {
        summary: 'Built repository with npm run build (exit 0)',
        data: {
          exitCode: 0,
          buildVerified: true,
          buildCommand: 'npm run build',
        },
      },
      {},
    );

    expect(result?.status).toBe('VALID');
    expect(result?.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'exit_code',
        status: 'PASS',
      }),
      expect.objectContaining({
        name: 'build_verified',
        status: 'PASS',
      }),
    ]));
  });

  it('marks structured repository build invalid when verification metadata is missing', () => {
    const result = validateToolResult(
      'terminal.build_repo',
      {
        summary: 'Built repository with npm run build (exit 0)',
        data: {
          exitCode: 0,
        },
      },
      {},
    );

    expect(result?.status).toBe('INCOMPLETE');
    expect(result?.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'build_verified',
        status: 'UNKNOWN',
      }),
    ]));
  });

  it('validates structured repository test results', () => {
    const result = validateToolResult(
      'terminal.test_repo',
      {
        summary: 'Tested repository with npm test (exit 0)',
        data: {
          exitCode: 0,
          testVerified: true,
          testCommand: 'npm test',
        },
      },
      {},
    );

    expect(result?.status).toBe('VALID');
    expect(result?.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'exit_code',
        status: 'PASS',
      }),
      expect.objectContaining({
        name: 'test_verified',
        status: 'PASS',
      }),
    ]));
  });

  it('marks structured repository test invalid when verification metadata is missing', () => {
    const result = validateToolResult(
      'terminal.test_repo',
      {
        summary: 'Tested repository with npm test (exit 0)',
        data: {
          exitCode: 0,
        },
      },
      {},
    );

    expect(result?.status).toBe('INCOMPLETE');
    expect(result?.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'test_verified',
        status: 'UNKNOWN',
      }),
    ]));
  });
});
