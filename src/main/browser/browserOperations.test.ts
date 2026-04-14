import { beforeEach, describe, expect, it, vi } from 'vitest';

const { browserService } = vi.hoisted(() => ({
  browserService: {
    beginOperationNetworkScope: vi.fn(),
    completeOperationNetworkScope: vi.fn(),
    isCreated: vi.fn(() => true),
    navigate: vi.fn(),
    getState: vi.fn(),
    getPageMetadata: vi.fn(),
    getPageText: vi.fn(),
    createTab: vi.fn(),
    getTabs: vi.fn(),
    clickElement: vi.fn(),
    splitTab: vi.fn(),
  },
}));

vi.mock('./BrowserService', () => ({ browserService }));

import { executeBrowserOperation } from './browserOperations';
import { browserContextManager } from './browserContextManager';
import {
  clearBrowserOperationLedger,
  getRecentBrowserOperationLedgerEntries,
} from './browserOperationLedger';

describe('executeBrowserOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearBrowserOperationLedger();
    browserContextManager.resetForTests(browserService as any);
    browserService.isCreated.mockReturnValue(true);
    browserService.completeOperationNetworkScope.mockReturnValue(null);
    browserService.getState.mockReturnValue({
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
      tabs: [{ id: 'tab_1' }],
    });
  });

  it('navigates through the shared browser operation executor', async () => {
    browserService.getState.mockReturnValue({
      activeTabId: 'tab_1',
      splitLeftTabId: null,
      splitRightTabId: null,
      navigation: {
        url: 'https://example.com',
        title: 'Example',
        isLoading: false,
      },
      tabs: [{ id: 'tab_1' }],
    });
    browserService.getPageMetadata.mockResolvedValue({ lang: 'en' });
    browserService.getPageText.mockResolvedValue('Example page');

    const result = await executeBrowserOperation({
      kind: 'browser.navigate',
      payload: { url: 'https://example.com' },
      context: {
        taskId: 'task_1',
        source: 'agent',
        agentId: 'agent_1',
        runId: 'run_1',
      },
    });

    expect(browserService.navigate).toHaveBeenCalledWith('https://example.com');
    expect(browserService.beginOperationNetworkScope).toHaveBeenCalledWith({
      operationId: expect.any(String),
      contextId: 'default',
      kind: 'browser.navigate',
      tabId: 'tab_1',
    });
    expect(result).toEqual({
      summary: 'Navigated to https://example.com',
      data: {
        url: 'https://example.com',
        title: 'Example',
        isLoading: false,
        tabCount: 1,
        pagePreview: 'Example page',
        metadata: { lang: 'en' },
      },
    });

    expect(getRecentBrowserOperationLedgerEntries(1)).toEqual([
      expect.objectContaining({
        kind: 'browser.navigate',
        contextId: 'default',
        status: 'completed',
        resultSummary: 'Navigated to https://example.com',
        errorSummary: null,
        durationMs: expect.any(Number),
        context: expect.objectContaining({
          taskId: 'task_1',
          tabId: 'tab_1',
          source: 'agent',
          agentId: 'agent_1',
          runId: 'run_1',
          activeTabId: 'tab_1',
          activeUrl: 'https://example.com',
        }),
        inputSummary: expect.objectContaining({
          fields: expect.objectContaining({
            url: 'https://example.com',
          }),
        }),
        network: null,
      }),
    ]);
  });

  it('creates tabs through the shared browser operation executor', async () => {
    browserService.createTab.mockReturnValue({ id: 'tab_2' });
    browserService.getTabs.mockReturnValue([{ id: 'tab_1' }, { id: 'tab_2' }]);

    const result = await executeBrowserOperation({
      kind: 'browser.create-tab',
      payload: { url: 'https://open.example' },
    });

    expect(browserService.createTab).toHaveBeenCalledWith('https://open.example', undefined);
    expect(result).toEqual({
      summary: 'Opened tab: https://open.example',
      data: {
        tabId: 'tab_2',
        url: 'https://open.example',
        totalTabs: 2,
      },
    });
  });

  it('fails click operations when the browser reports a click failure', async () => {
    browserService.clickElement.mockResolvedValue({ clicked: false, error: 'intercepted' });
    browserService.completeOperationNetworkScope.mockReturnValue({
      eventIds: ['net_1'],
      summary: {
        requestCount: 1,
        failedRequestCount: 1,
        urls: ['https://example.com/api'],
        statusCodes: [500],
      },
    });

    await expect(executeBrowserOperation({
      kind: 'browser.click',
      payload: { selector: '#buy-now' },
    })).rejects.toThrow('intercepted');

    expect(getRecentBrowserOperationLedgerEntries(1)).toEqual([
      expect.objectContaining({
        kind: 'browser.click',
        status: 'failed',
        resultSummary: null,
        errorSummary: 'intercepted',
        inputSummary: expect.objectContaining({
          fields: expect.objectContaining({
            selector: '#buy-now',
          }),
        }),
        related: expect.objectContaining({
          networkEventIds: ['net_1'],
        }),
        network: {
          requestCount: 1,
          failedRequestCount: 1,
          urls: ['https://example.com/api'],
          statusCodes: [500],
        },
      }),
    ]);
  });

  it('supports split-view operations through the shared executor', async () => {
    browserService.splitTab.mockReturnValue({ id: 'tab_split' });
    browserService.getState.mockReturnValue({
      activeTabId: 'tab_left',
      splitLeftTabId: 'tab_left',
      splitRightTabId: 'tab_split',
      navigation: {
        url: 'https://example.com',
        title: 'Example',
        canGoBack: false,
        canGoForward: false,
        isLoading: false,
      },
      tabs: [{ id: 'tab_left' }, { id: 'tab_split' }],
    });

    const result = await executeBrowserOperation({
      kind: 'browser.split-tab',
      payload: { tabId: 'tab_left' },
    });

    expect(browserService.splitTab).toHaveBeenCalledWith('tab_left');
    expect(result).toEqual({
      summary: 'Split browser tab into tab_split',
      data: {
        tabId: 'tab_split',
        splitLeftTabId: 'tab_left',
        splitRightTabId: 'tab_split',
      },
    });
  });

  it('routes operations through an explicitly resolved browser context', async () => {
    const secondaryContext = {
      beginOperationNetworkScope: vi.fn(),
      completeOperationNetworkScope: vi.fn(() => null),
      isCreated: vi.fn(() => true),
      getState: vi.fn(() => ({
        activeTabId: 'tab_secondary',
        splitLeftTabId: null,
        splitRightTabId: null,
        navigation: {
          url: 'https://secondary.example',
          title: 'Secondary',
          canGoBack: false,
          canGoForward: false,
          isLoading: false,
        },
        tabs: [{ id: 'tab_secondary' }, { id: 'tab_secondary_2' }],
      })),
      createTab: vi.fn(() => ({ id: 'tab_secondary_2' })),
      getTabs: vi.fn(() => [{ id: 'tab_secondary' }, { id: 'tab_secondary_2' }]),
    };
    browserContextManager.createContext({
      id: 'ctx_secondary',
      label: 'Secondary',
      service: secondaryContext as any,
    });

    const result = await executeBrowserOperation({
      kind: 'browser.create-tab',
      payload: { url: 'https://secondary.example/new' },
      context: { contextId: 'ctx_secondary' },
    });

    expect(secondaryContext.createTab).toHaveBeenCalledWith('https://secondary.example/new', undefined);
    expect(browserService.createTab).not.toHaveBeenCalled();
    expect(result).toEqual({
      summary: 'Opened tab: https://secondary.example/new',
      data: {
        tabId: 'tab_secondary_2',
        url: 'https://secondary.example/new',
        totalTabs: 2,
      },
    });
    expect(getRecentBrowserOperationLedgerEntries(1)).toEqual([
      expect.objectContaining({
        contextId: 'ctx_secondary',
        context: expect.objectContaining({
          activeTabId: 'tab_secondary',
          activeUrl: 'https://secondary.example',
        }),
      }),
    ]);
  });
});
