import { describe, expect, it } from 'vitest';

import { BrowserOperationLedger } from './browserOperationLedger';

describe('BrowserOperationLedger', () => {
  it('keeps only the most recent bounded entries', () => {
    const ledger = new BrowserOperationLedger(3);
    const baseState = {
      activeTabId: 'tab_1',
      splitLeftTabId: null,
      splitRightTabId: null,
      navigation: {
        url: 'https://example.com',
        title: 'Example',
        canGoBack: false,
        canGoForward: false,
        isLoading: false,
      },
    } as any;

    for (let index = 0; index < 4; index += 1) {
      const entry = ledger.start({
        kind: 'browser.get-state',
        payload: { ordinal: index },
        contextId: 'default',
        state: baseState,
      });
      ledger.complete(entry.operationId, {
        summary: `Completed ${index}`,
        data: {},
      });
    }

    const entries = ledger.listRecent(10);
    expect(entries).toHaveLength(3);
    expect(entries.map(entry => entry.resultSummary)).toEqual([
      'Completed 1',
      'Completed 2',
      'Completed 3',
    ]);
  });
});
