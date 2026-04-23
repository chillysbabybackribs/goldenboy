import { describe, expect, it, vi } from 'vitest';

import {
  DeterministicTabService,
  DeterministicTabSnapshot,
  OpenTabPostconditionError,
  openTabDeterministic,
} from './openTabDeterministic';

/**
 * Minimal fake tab service. Mirrors only the surface `openTabDeterministic`
 * depends on so the test stays focused on the determinism contract.
 */
function createFakeTabService(initial: DeterministicTabSnapshot[] = []): DeterministicTabService & {
  tabs: DeterministicTabSnapshot[];
  activeTabId: string | null;
  nextId: number;
} {
  const state = {
    tabs: [...initial],
    activeTabId: initial[0]?.id ?? null,
    nextId: initial.length + 1,
  };
  return {
    ...state,
    get tabs() { return state.tabs; },
    get activeTabId() { return state.activeTabId; },
    get nextId() { return state.nextId; },
    createTab: vi.fn((url?: string) => {
      const id = `tab_${state.nextId++}`;
      state.tabs.push({ id, url: url ?? 'about:blank' });
      state.activeTabId = id;
      return { id };
    }),
    activateTab: vi.fn((tabId: string) => {
      state.activeTabId = tabId;
    }),
    getTabs: () => state.tabs,
    getActiveTabId: () => state.activeTabId,
  };
}

describe('openTabDeterministic', () => {
  it('creates a new tab, verifies it is present and active, and returns structured result', async () => {
    const service = createFakeTabService([{ id: 'tab_1', url: 'about:blank' }]);

    const result = await openTabDeterministic({ url: 'https://example.com/' }, service);

    expect(result).toEqual({
      tabId: 'tab_2',
      url: 'https://example.com/',
      reused: false,
      tabCount: 2,
    });
    expect(service.createTab).toHaveBeenCalledWith('https://example.com/');
    expect(service.getActiveTabId()).toBe('tab_2');
  });

  it('creates a blank tab when no url is supplied', async () => {
    const service = createFakeTabService();

    const result = await openTabDeterministic({}, service);

    expect(result.reused).toBe(false);
    expect(result.tabId).toBe('tab_1');
    expect(result.url).toBe('about:blank');
    expect(service.createTab).toHaveBeenCalledWith(undefined);
  });

  it('reuses an existing tab with the same canonical url instead of creating a duplicate', async () => {
    const service = createFakeTabService([
      { id: 'tab_1', url: 'about:blank' },
      { id: 'tab_2', url: 'https://example.com/' },
    ]);

    const result = await openTabDeterministic(
      { url: 'https://example.com', reuseExisting: true },
      service,
    );

    expect(result).toEqual({
      tabId: 'tab_2',
      url: 'https://example.com/',
      reused: true,
      tabCount: 2,
    });
    expect(service.createTab).not.toHaveBeenCalled();
    expect(service.activateTab).toHaveBeenCalledWith('tab_2');
    expect(service.getActiveTabId()).toBe('tab_2');
  });

  it('still creates a new tab when reuseExisting is true but no matching url is open', async () => {
    const service = createFakeTabService([{ id: 'tab_1', url: 'about:blank' }]);

    const result = await openTabDeterministic(
      { url: 'https://example.com/', reuseExisting: true },
      service,
    );

    expect(result.reused).toBe(false);
    expect(result.tabId).toBe('tab_2');
    expect(service.createTab).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty url string at the precondition stage', async () => {
    const service = createFakeTabService();

    await expect(openTabDeterministic({ url: '   ' }, service)).rejects.toThrow(TypeError);
    expect(service.createTab).not.toHaveBeenCalled();
  });

  it('throws OpenTabPostconditionError when the created tab is not present in the tab list', async () => {
    const service: DeterministicTabService = {
      createTab: vi.fn(() => ({ id: 'ghost_tab' })),
      activateTab: vi.fn(),
      getTabs: () => [{ id: 'tab_1', url: 'about:blank' }],
      getActiveTabId: () => 'ghost_tab',
    };

    await expect(openTabDeterministic({ url: 'https://example.com/' }, service))
      .rejects.toThrow(OpenTabPostconditionError);
  });

  it('throws OpenTabPostconditionError when the new tab is not the active tab after creation', async () => {
    const service: DeterministicTabService = {
      createTab: vi.fn(() => ({ id: 'tab_2' })),
      activateTab: vi.fn(),
      getTabs: () => [
        { id: 'tab_1', url: 'about:blank' },
        { id: 'tab_2', url: 'https://example.com/' },
      ],
      getActiveTabId: () => 'tab_1',
    };

    await expect(openTabDeterministic({ url: 'https://example.com/' }, service))
      .rejects.toThrow(/expected active tab tab_2, got tab_1/);
  });

  it('throws OpenTabPostconditionError when createTab returns a blank id', async () => {
    const service: DeterministicTabService = {
      createTab: vi.fn(() => ({ id: '' })),
      activateTab: vi.fn(),
      getTabs: () => [],
      getActiveTabId: () => null,
    };

    await expect(openTabDeterministic({}, service))
      .rejects.toThrow(/createTab did not return a tab id/);
  });
});

describe('openTabDeterministic — kernel integration', () => {
  it('calls kernel.enter with the new tab id when deterministic is true', async () => {
    const service = createFakeTabService([{ id: 'tab_1', url: 'about:blank' }]);
    const enter = vi.fn(async () => ({ tabId: 'tab_2', pinsApplied: ['userAgent'], enteredAt: 1 }));
    const isDeterministic = vi.fn(() => true);

    const result = await openTabDeterministic(
      { url: 'https://example.com/', deterministic: true },
      service,
      { kernel: { enter, isDeterministic } },
    );

    expect(enter).toHaveBeenCalledWith('tab_2', {});
    expect(result.deterministic).toEqual({ pinsApplied: ['userAgent'] });
  });

  it('passes a DeterminismConfig object through to kernel.enter', async () => {
    const service = createFakeTabService();
    const enter = vi.fn(async () => ({ tabId: 'tab_1', pinsApplied: ['userAgent', 'visual'], enteredAt: 1 }));
    const isDeterministic = vi.fn(() => true);

    await openTabDeterministic(
      { url: 'https://example.com/', deterministic: { seed: 99, locale: 'fr-FR' } },
      service,
      { kernel: { enter, isDeterministic } },
    );

    expect(enter).toHaveBeenCalledWith('tab_1', { seed: 99, locale: 'fr-FR' });
  });

  it('throws OpenTabPostconditionError when kernel.isDeterministic returns false after enter', async () => {
    const service = createFakeTabService();
    const enter = vi.fn(async () => ({ tabId: 'tab_1', pinsApplied: [], enteredAt: 1 }));
    const isDeterministic = vi.fn(() => false);

    await expect(openTabDeterministic(
      { url: 'https://example.com/', deterministic: true },
      service,
      { kernel: { enter, isDeterministic } },
    )).rejects.toThrow(/kernel.*not.*deterministic/i);
  });

  it('does not call kernel when deterministic is omitted', async () => {
    const service = createFakeTabService();
    const enter = vi.fn();
    const isDeterministic = vi.fn();

    await openTabDeterministic(
      { url: 'https://example.com/' },
      service,
      { kernel: { enter, isDeterministic } },
    );

    expect(enter).not.toHaveBeenCalled();
    expect(isDeterministic).not.toHaveBeenCalled();
  });
});
