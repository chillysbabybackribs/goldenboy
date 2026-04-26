/**
 * Reference example for a deterministic browser tool.
 *
 * Pattern:
 *   1. precondition — validate input and environment up front
 *   2. action       — perform exactly one state change (optionally short-circuit for idempotency)
 *   3. postcondition — verify the observable world matches the intent, throw if not
 *
 * This module deliberately depends on a narrow `TabService` interface (not on
 * `BrowserService` directly) so the behavior can be unit-tested without Electron.
 * When a kernel hook is supplied and `deterministic` is opt-in, the function
 * additionally enters the tab into deterministic mode before returning.
 */

import type { DeterminismConfig, KernelResult } from '../../../browser/determinism/kernelTypes';

export type DeterministicTabSnapshot = {
  id: string;
  url: string;
};

export type DeterministicTabService = {
  createTab: (url?: string) => { id: string };
  activateTab: (tabId: string) => void;
  getTabs: () => DeterministicTabSnapshot[];
  getActiveTabId: () => string | null;
};

export type OpenTabKernelHook = {
  enter: (tabId: string, config: DeterminismConfig) => Promise<KernelResult>;
  isDeterministic: (tabId: string) => boolean;
};

export type OpenTabDependencies = {
  kernel?: OpenTabKernelHook;
};

export type OpenTabInput = {
  url?: string;
  reuseExisting?: boolean;
  deterministic?: DeterminismConfig | true;
};

export type OpenTabResult = {
  tabId: string;
  url: string;
  reused: boolean;
  tabCount: number;
  deterministic?: { pinsApplied: string[] };
};

export class OpenTabPostconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenTabPostconditionError';
  }
}

function canonicalizeUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${parsed.origin}${pathname}${parsed.search}`;
  } catch {
    return raw.trim().replace(/\/+$/, '');
  }
}

export async function openTabDeterministic(
  input: OpenTabInput,
  service: DeterministicTabService,
  deps: OpenTabDependencies = {},
): Promise<OpenTabResult> {
  if (input.url !== undefined && (typeof input.url !== 'string' || input.url.trim() === '')) {
    throw new TypeError('openTabDeterministic: url must be a non-empty string when provided');
  }
  if (input.deterministic !== undefined && !deps.kernel) {
    throw new TypeError('openTabDeterministic: deterministic option requires a kernel hook');
  }

  const normalizedUrl = input.url ? canonicalizeUrl(input.url) : undefined;

  let tabId: string;
  let reused: boolean;
  let url: string;

  if (input.reuseExisting && normalizedUrl) {
    const existing = service.getTabs().find(tab => canonicalizeUrl(tab.url) === normalizedUrl);
    if (existing) {
      service.activateTab(existing.id);
      const afterActivate = service.getActiveTabId();
      if (afterActivate !== existing.id) {
        throw new OpenTabPostconditionError(
          `expected active tab ${existing.id} after reuse, got ${afterActivate ?? 'null'}`,
        );
      }
      tabId = existing.id;
      url = existing.url;
      reused = true;
    } else {
      ({ tabId, url, reused } = createNew());
    }
  } else {
    ({ tabId, url, reused } = createNew());
  }

  const result: OpenTabResult = { tabId, url, reused, tabCount: service.getTabs().length };

  if (input.deterministic !== undefined) {
    const config: DeterminismConfig = input.deterministic === true ? {} : input.deterministic;
    const kernelResult = await deps.kernel!.enter(tabId, config);
    if (!deps.kernel!.isDeterministic(tabId)) {
      throw new OpenTabPostconditionError(
        `kernel reported tab ${tabId} is not deterministic after enter`,
      );
    }
    result.deterministic = { pinsApplied: kernelResult.pinsApplied };
  }

  return result;

  function createNew(): { tabId: string; url: string; reused: boolean } {
    const created = service.createTab(input.url);
    if (!created || typeof created.id !== 'string' || created.id.trim() === '') {
      throw new OpenTabPostconditionError('createTab did not return a tab id');
    }
    const tabs = service.getTabs();
    const match = tabs.find(tab => tab.id === created.id);
    if (!match) {
      throw new OpenTabPostconditionError(
        `created tab ${created.id} not present in tab list (got ${tabs.length} tabs)`,
      );
    }
    const activeId = service.getActiveTabId();
    if (activeId !== created.id) {
      throw new OpenTabPostconditionError(
        `expected active tab ${created.id}, got ${activeId ?? 'null'}`,
      );
    }
    return { tabId: created.id, url: match.url, reused: false };
  }
}
