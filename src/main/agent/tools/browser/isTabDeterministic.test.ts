import { describe, expect, it } from 'vitest';
import { isTabDeterministic } from './isTabDeterministic';

describe('isTabDeterministic', () => {
  it('returns false when no kernel is provided (singleton not yet created)', () => {
    expect(isTabDeterministic('tab_1', null)).toBe(false);
  });

  it('returns false when tabId is missing', () => {
    const kernel = { isDeterministic: () => true };
    expect(isTabDeterministic(null, kernel)).toBe(false);
    expect(isTabDeterministic(undefined, kernel)).toBe(false);
    expect(isTabDeterministic('', kernel)).toBe(false);
  });

  it('delegates to the kernel and returns its verdict', () => {
    const calls: string[] = [];
    const kernel = {
      isDeterministic: (tabId: string) => {
        calls.push(tabId);
        return tabId === 'tab_pinned';
      },
    };
    expect(isTabDeterministic('tab_pinned', kernel)).toBe(true);
    expect(isTabDeterministic('tab_free', kernel)).toBe(false);
    expect(calls).toEqual(['tab_pinned', 'tab_free']);
  });
});
