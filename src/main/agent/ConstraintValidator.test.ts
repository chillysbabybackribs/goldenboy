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
});
