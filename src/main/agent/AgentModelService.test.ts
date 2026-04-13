import { describe, expect, it } from 'vitest';
import {
  buildStartupStatusMessages,
  shouldPrimeResearchBrowserSurface,
} from './startupProgress';

describe('AgentModelService startup progress', () => {
  it('emits fast-path startup statuses for research tasks', () => {
    expect(buildStartupStatusMessages({
      taskKind: 'research',
      browserSurfaceReady: true,
    })).toEqual([
      'Starting task...',
      'Routing web search for fast browser-first execution.',
      'Opening a dedicated search tab while the first tool call is prepared.',
    ]);

    expect(buildStartupStatusMessages({
      taskKind: 'research',
      browserSurfaceReady: false,
    })).toEqual([
      'Starting task...',
      'Routing web search for fast browser-first execution.',
      'Browser search will open on the first tool call.',
    ]);
  });

  it('keeps browser automation startup lightweight', () => {
    expect(buildStartupStatusMessages({
      taskKind: 'browser-automation',
      browserSurfaceReady: true,
    })).toEqual([
      'Starting task...',
      'Preparing the browser workflow.',
    ]);
  });

  it('only primes the browser surface for research tasks with a live browser window', () => {
    expect(shouldPrimeResearchBrowserSurface('research', true)).toBe(true);
    expect(shouldPrimeResearchBrowserSurface('research', false)).toBe(false);
    expect(shouldPrimeResearchBrowserSurface('browser-automation', true)).toBe(false);
    expect(shouldPrimeResearchBrowserSurface('implementation', true)).toBe(false);
  });
});
