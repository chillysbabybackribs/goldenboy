import { beforeEach, describe, expect, it, vi } from 'vitest';

const { browserService } = vi.hoisted(() => ({
  browserService: {
    beginOperationNetworkScope: vi.fn(),
    captureTabSnapshot: vi.fn(),
    clickElement: vi.fn(),
    completeOperationNetworkScope: vi.fn(() => null),
    getFormModel: vi.fn(() => Promise.resolve([])),
    getPageMetadata: vi.fn(() => Promise.resolve({})),
    getPageText: vi.fn(() => Promise.resolve('')),
    getState: vi.fn(),
    getTabs: vi.fn(() => [{ id: 'tab_1' }]),
    isCreated: vi.fn(() => true),
  },
}));

vi.mock('./BrowserService', () => ({ browserService }));

import { browserContextManager } from './browserContextManager';
import {
  clearBrowserOperationLedger,
  getRecentBrowserOperationLedgerEntries,
} from './browserOperationLedger';
import { executeBrowserOperation } from './browserOperations';
import { replayBrowserOperation } from './browserOperationReplay';
import { clearBrowserOperationReplayStore } from './browserOperationReplayStore';

function makeSnapshot(selector: string, text: string = 'Buy now') {
  return {
    id: `snap_${selector.replace(/[^a-z0-9]/gi, '')}`,
    tabId: 'tab_1',
    capturedAt: Date.now(),
    url: 'https://example.com/products',
    title: 'Products',
    mainHeading: 'Products',
    visibleTextExcerpt: 'Products',
    forms: [],
    viewport: { url: 'https://example.com/products' },
    actionableElements: [{
      id: 'act_1',
      ref: { tabId: 'tab_1', frameId: null, selector },
      role: 'button',
      tagName: 'button',
      text,
      ariaLabel: '',
      href: null,
      boundingBox: { x: 1, y: 2, width: 100, height: 30 },
      actionability: ['clickable'],
      visible: true,
      enabled: true,
      confidence: 0.95,
    }],
  };
}

describe('replayBrowserOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearBrowserOperationLedger();
    clearBrowserOperationReplayStore();
    browserContextManager.resetForTests(browserService as any);
    browserService.getState.mockReturnValue({
      activeTabId: 'tab_1',
      splitLeftTabId: null,
      splitRightTabId: null,
      navigation: {
        url: 'https://example.com/products',
        title: 'Products',
        canGoBack: false,
        canGoForward: false,
        isLoading: false,
      },
      tabs: [{ id: 'tab_1' }],
    });
  });

  it('replays a supported click through the shared executor using descriptor resolution', async () => {
    browserService.captureTabSnapshot
      .mockResolvedValueOnce(makeSnapshot('#buy-now-old'))
      .mockResolvedValueOnce(makeSnapshot('#buy-now-new'));
    browserService.clickElement.mockResolvedValue({ clicked: true, error: null, method: 'native-input' });

    await executeBrowserOperation({
      kind: 'browser.click',
      payload: { selector: '#buy-now-old' },
    });

    const sourceOperationId = getRecentBrowserOperationLedgerEntries(1)[0]?.operationId;
    expect(sourceOperationId).toBeTruthy();

    const replayResult = await replayBrowserOperation({
      sourceOperationId: sourceOperationId!,
      strictness: 'strict',
    });

    expect(browserService.clickElement).toHaveBeenNthCalledWith(1, '#buy-now-old', undefined);
    expect(browserService.clickElement).toHaveBeenNthCalledWith(2, '#buy-now-new', undefined);
    expect(replayResult.replayedOperationId).toBeTruthy();

    const latest = getRecentBrowserOperationLedgerEntries(1)[0];
    expect(latest).toEqual(expect.objectContaining({
      kind: 'browser.click',
      replayOfOperationId: sourceOperationId,
      decision: expect.objectContaining({
        selectedMode: 'deterministic_replay',
        confidence: 'high',
      }),
      decisionResult: expect.objectContaining({
        selectedMode: 'deterministic_replay',
        finalStatus: 'completed',
      }),
      targetDescriptor: expect.objectContaining({
        evidence: expect.objectContaining({
          selector: '#buy-now-old',
          text: 'Buy now',
        }),
      }),
      validation: expect.objectContaining({
        status: 'matched',
        phase: 'postflight',
      }),
    }));
  });

  it('records a failed replay when strict preflight validation cannot resolve the target', async () => {
    browserService.captureTabSnapshot
      .mockResolvedValueOnce(makeSnapshot('#buy-now-old'))
      .mockResolvedValueOnce({
        ...makeSnapshot('#other-button', 'Something else'),
        actionableElements: [],
      });
    browserService.clickElement.mockResolvedValue({ clicked: true, error: null, method: 'native-input' });

    await executeBrowserOperation({
      kind: 'browser.click',
      payload: { selector: '#buy-now-old' },
    });

    const sourceOperationId = getRecentBrowserOperationLedgerEntries(1)[0]?.operationId;

    await expect(replayBrowserOperation({
      sourceOperationId: sourceOperationId!,
      strictness: 'strict',
    })).rejects.toThrow('no longer resolves');

    const latest = getRecentBrowserOperationLedgerEntries(1)[0];
    expect(latest).toEqual(expect.objectContaining({
      kind: 'browser.click',
      status: 'failed',
      replayOfOperationId: sourceOperationId,
      decision: expect.objectContaining({
        selectedMode: 'abort',
      }),
      decisionResult: expect.objectContaining({
        selectedMode: 'abort',
        finalStatus: 'aborted',
      }),
      validation: expect.objectContaining({
        status: 'missing',
        phase: 'preflight',
      }),
    }));
  });

  it('falls back from replay to heuristic execution in best-effort mode when replay preflight is weak', async () => {
    browserService.captureTabSnapshot
      .mockResolvedValueOnce(makeSnapshot('#buy-now-old'))
      .mockResolvedValueOnce({
        ...makeSnapshot('#other-button', 'Something else'),
        actionableElements: [],
      });
    browserService.clickElement.mockResolvedValue({ clicked: true, error: null, method: 'native-input' });

    await executeBrowserOperation({
      kind: 'browser.click',
      payload: { selector: '#buy-now-old' },
    });

    const sourceOperationId = getRecentBrowserOperationLedgerEntries(1)[0]?.operationId;
    const replayResult = await replayBrowserOperation({
      sourceOperationId: sourceOperationId!,
      strictness: 'best-effort',
    });

    expect(replayResult.replayedOperationId).toBeTruthy();
    expect(browserService.clickElement).toHaveBeenNthCalledWith(2, '#buy-now-old', undefined);

    const latest = getRecentBrowserOperationLedgerEntries(1)[0];
    expect(latest).toEqual(expect.objectContaining({
      kind: 'browser.click',
      status: 'completed',
      replayOfOperationId: sourceOperationId,
      decision: expect.objectContaining({
        selectedMode: 'heuristic_execute',
      }),
      decisionResult: expect.objectContaining({
        selectedMode: 'heuristic_execute',
        attemptedModes: ['deterministic_replay', 'heuristic_execute'],
        fallbackUsed: true,
        finalStatus: 'completed',
      }),
      validation: expect.objectContaining({
        status: 'missing',
        phase: 'preflight',
      }),
    }));
  });
});
