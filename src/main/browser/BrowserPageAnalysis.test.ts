import { describe, expect, it, vi } from 'vitest';
import { BrowserPageAnalysis } from './BrowserPageAnalysis';

describe('BrowserPageAnalysis.extractSearchResults', () => {
  it('filters Google utility links before returning search candidates', async () => {
    const executeInPage = vi.fn().mockResolvedValue({
      error: null,
      result: [
        {
          index: 0,
          title: 'Google Search Help',
          url: 'https://support.google.com/websearch/?hl=en',
          snippet: 'Find help for Google Search.',
          selector: 'footer > a',
          source: 'generic',
        },
        {
          index: 1,
          title: 'Policies',
          url: 'https://policies.google.com/privacy',
          snippet: 'Privacy and terms.',
          selector: 'footer > a',
          source: 'generic',
        },
        {
          index: 2,
          title: 'Acme pricing',
          url: 'https://example.com/pricing',
          snippet: 'Compare plans and pricing for Acme.',
          selector: 'main > div.g > a',
          source: 'search',
        },
        {
          index: 3,
          title: 'Acme documentation',
          url: 'https://docs.example.com/getting-started',
          snippet: 'Getting started guide and setup instructions.',
          selector: 'main > div.g > a',
          source: 'search',
        },
      ],
    });

    const analysis = new BrowserPageAnalysis({
      resolveEntry: () => ({
        id: 'tab_1',
        view: {} as any,
        info: {
          id: 'tab_1',
          url: 'https://www.google.com/search?q=acme',
          title: 'acme - Google Search',
        } as any,
      }),
      getTabs: () => [],
      createTab: vi.fn(),
      activateTab: vi.fn(),
      executeInPage,
      captureTabSnapshot: vi.fn(),
      activeTabId: () => 'tab_1',
    });

    const results = await analysis.extractSearchResults('tab_1', 4);

    expect(executeInPage).toHaveBeenCalledOnce();
    expect(results).toEqual([
      expect.objectContaining({
        index: 0,
        title: 'Acme pricing',
        url: 'https://example.com/pricing',
      }),
      expect.objectContaining({
        index: 1,
        title: 'Acme documentation',
        url: 'https://docs.example.com/getting-started',
      }),
    ]);
  });

  it('unwraps Google redirect URLs to the destination page', async () => {
    const executeInPage = vi.fn().mockResolvedValue({
      error: null,
      result: [
        {
          index: 0,
          title: 'Acme pricing',
          url: 'https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fpricing&sa=U&ved=123',
          snippet: 'Compare plans and pricing for Acme.',
          selector: 'main > div.g > a',
          source: 'search',
        },
      ],
    });

    const analysis = new BrowserPageAnalysis({
      resolveEntry: () => ({
        id: 'tab_1',
        view: {} as any,
        info: {
          id: 'tab_1',
          url: 'https://www.google.com/search?q=acme',
          title: 'acme - Google Search',
        } as any,
      }),
      getTabs: () => [],
      createTab: vi.fn(),
      activateTab: vi.fn(),
      executeInPage,
      captureTabSnapshot: vi.fn(),
      activeTabId: () => 'tab_1',
    });

    const results = await analysis.extractSearchResults('tab_1', 4);

    expect(results).toEqual([
      expect.objectContaining({
        index: 0,
        url: 'https://example.com/pricing',
      }),
    ]);
  });

  it('unwraps DuckDuckGo redirect URLs to the destination page', async () => {
    const executeInPage = vi.fn().mockResolvedValue({
      error: null,
      result: [
        {
          index: 0,
          title: 'Acme pricing',
          url: 'https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpricing',
          snippet: 'Compare plans and pricing for Acme.',
          selector: 'main > div.result > a',
          source: 'search',
        },
      ],
    });

    const analysis = new BrowserPageAnalysis({
      resolveEntry: () => ({
        id: 'tab_1',
        view: {} as any,
        info: {
          id: 'tab_1',
          navigation: {
            url: 'https://duckduckgo.com/?q=acme',
            title: 'acme at DuckDuckGo',
          },
        } as any,
      }),
      getTabs: () => [],
      createTab: vi.fn(),
      activateTab: vi.fn(),
      executeInPage,
      captureTabSnapshot: vi.fn(),
      activeTabId: () => 'tab_1',
    });

    const results = await analysis.extractSearchResults('tab_1', 4);

    expect(results).toEqual([
      expect.objectContaining({
        index: 0,
        url: 'https://example.com/pricing',
      }),
    ]);
  });
});
