import { beforeEach, describe, expect, it, vi } from 'vitest';

const { browserService } = vi.hoisted(() => ({
  browserService: {
    beginOperationNetworkScope: vi.fn(),
    completeOperationNetworkScope: vi.fn(),
    captureTabSnapshot: vi.fn(),
    getFormModel: vi.fn(),
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
import { clearBrowserOperationReplayStore } from './browserOperationReplayStore';

describe('executeBrowserOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearBrowserOperationLedger();
    clearBrowserOperationReplayStore();
    browserContextManager.resetForTests(browserService as any);
    browserService.isCreated.mockReturnValue(true);
    browserService.completeOperationNetworkScope.mockReturnValue(null);
    browserService.captureTabSnapshot.mockResolvedValue({
      id: 'snap_1',
      tabId: 'tab_1',
      capturedAt: Date.now(),
      url: 'https://example.com',
      title: 'Example',
      mainHeading: 'Example',
      visibleTextExcerpt: 'Example page',
      forms: [],
      viewport: { url: 'https://example.com' },
      actionableElements: [{
        id: 'act_1',
        ref: { tabId: 'tab_1', frameId: null, selector: '#buy-now' },
        role: 'button',
        tagName: 'button',
        text: 'Buy now',
        ariaLabel: '',
        href: null,
        boundingBox: { x: 10, y: 20, width: 50, height: 20 },
        actionability: ['clickable'],
        visible: true,
        enabled: true,
        confidence: 0.9,
      }],
    });
    browserService.getFormModel.mockResolvedValue([]);
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
        replayOfOperationId: null,
        decision: expect.objectContaining({
          selectedMode: 'deterministic_execute',
          confidence: 'high',
        }),
        decisionResult: expect.objectContaining({
          selectedMode: 'deterministic_execute',
          finalStatus: 'completed',
        }),
        targetDescriptor: expect.objectContaining({
          kind: 'navigation',
          evidence: expect.objectContaining({
            expectedUrl: 'https://example.com',
          }),
        }),
        validation: expect.objectContaining({
          status: 'matched',
          phase: 'postflight',
        }),
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

  it('routes browser.search-web queries through DuckDuckGo search URLs', async () => {
    const currentYear = new Date().getFullYear();
    browserService.getState.mockReturnValue({
      activeTabId: 'tab_1',
      splitLeftTabId: null,
      splitRightTabId: null,
      navigation: {
        url: `https://duckduckgo.com/?q=acme%20pricing%20${currentYear}`,
        title: `acme pricing ${currentYear} at DuckDuckGo`,
        isLoading: false,
      },
      tabs: [{ id: 'tab_1' }],
    });
    browserService.getPageMetadata.mockResolvedValue({ lang: 'en' });
    browserService.getPageText.mockResolvedValue('DuckDuckGo results');

    const result = await executeBrowserOperation({
      kind: 'browser.search-web',
      payload: { query: 'acme pricing' },
    });

    expect(browserService.navigate).toHaveBeenCalledWith(`https://duckduckgo.com/?q=acme%20pricing%20${currentYear}`);
    expect(result).toEqual({
      summary: `Navigated to https://duckduckgo.com/?q=acme%20pricing%20${currentYear}`,
      data: {
        url: `https://duckduckgo.com/?q=acme%20pricing%20${currentYear}`,
        title: `acme pricing ${currentYear} at DuckDuckGo`,
        isLoading: false,
        tabCount: 1,
        pagePreview: 'DuckDuckGo results',
        metadata: { lang: 'en' },
      },
    });
  });

  it('appends the current year for freshness-sensitive search queries', async () => {
    const currentYear = new Date().getFullYear();
    browserService.getState.mockReturnValue({
      activeTabId: 'tab_1',
      splitLeftTabId: null,
      splitRightTabId: null,
      navigation: {
        url: `https://duckduckgo.com/?q=latest%20electron%20release%20notes%20${currentYear}`,
        title: `latest electron release notes ${currentYear} at DuckDuckGo`,
        isLoading: false,
      },
      tabs: [{ id: 'tab_1' }],
    });
    browserService.getPageMetadata.mockResolvedValue({ lang: 'en' });
    browserService.getPageText.mockResolvedValue('DuckDuckGo results');

    const result = await executeBrowserOperation({
      kind: 'browser.search-web',
      payload: { query: 'latest electron release notes' },
    });

    expect(browserService.navigate).toHaveBeenCalledWith(`https://duckduckgo.com/?q=latest%20electron%20release%20notes%20${currentYear}`);
    expect(result.data.url).toBe(`https://duckduckgo.com/?q=latest%20electron%20release%20notes%20${currentYear}`);
  });

  it('preserves explicit years in freshness-sensitive search queries', async () => {
    browserService.getState.mockReturnValue({
      activeTabId: 'tab_1',
      splitLeftTabId: null,
      splitRightTabId: null,
      navigation: {
        url: 'https://duckduckgo.com/?q=latest%20electron%20release%20notes%202025',
        title: 'latest electron release notes 2025 at DuckDuckGo',
        isLoading: false,
      },
      tabs: [{ id: 'tab_1' }],
    });
    browserService.getPageMetadata.mockResolvedValue({ lang: 'en' });
    browserService.getPageText.mockResolvedValue('DuckDuckGo results');

    const result = await executeBrowserOperation({
      kind: 'browser.search-web',
      payload: { query: 'latest electron release notes 2025' },
    });

    expect(browserService.navigate).toHaveBeenCalledWith('https://duckduckgo.com/?q=latest%20electron%20release%20notes%202025');
    expect(result.data.url).toBe('https://duckduckgo.com/?q=latest%20electron%20release%20notes%202025');
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
        decision: expect.objectContaining({
          selectedMode: 'deterministic_execute',
        }),
        decisionResult: expect.objectContaining({
          selectedMode: 'deterministic_execute',
          finalStatus: 'failed',
        }),
        targetDescriptor: expect.objectContaining({
          kind: 'actionable-element',
          evidence: expect.objectContaining({
            selector: '#buy-now',
            text: 'Buy now',
          }),
        }),
        validation: expect.objectContaining({
          status: 'matched',
          phase: 'preflight',
        }),
      }),
    ]);
  });

  it('falls back to heuristic execution when deterministic target evidence is weak', async () => {
    browserService.captureTabSnapshot.mockResolvedValue({
      id: 'snap_missing',
      tabId: 'tab_1',
      capturedAt: Date.now(),
      url: 'https://example.com',
      title: 'Example',
      mainHeading: 'Example',
      visibleTextExcerpt: 'Example page',
      forms: [],
      viewport: { url: 'https://example.com' },
      actionableElements: [],
    });
    browserService.clickElement.mockResolvedValue({ clicked: true, error: null, method: 'native-input' });

    const result = await executeBrowserOperation({
      kind: 'browser.click',
      payload: { selector: '#buy-now' },
    });

    expect(result.summary).toBe('Clicked: #buy-now');
    expect(getRecentBrowserOperationLedgerEntries(1)).toEqual([
      expect.objectContaining({
        kind: 'browser.click',
        status: 'completed',
        decision: expect.objectContaining({
          selectedMode: 'heuristic_execute',
          confidence: 'low',
        }),
        decisionResult: expect.objectContaining({
          selectedMode: 'heuristic_execute',
          attemptedModes: ['deterministic_execute', 'heuristic_execute'],
          fallbackUsed: true,
          finalStatus: 'completed',
        }),
        validation: expect.objectContaining({
          status: 'missing',
          phase: 'preflight',
        }),
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
