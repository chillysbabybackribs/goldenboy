import { describe, expect, it } from 'vitest';
import { createDefaultAppState } from './appState';
import { PRIMARY_PROVIDER_ID } from './model';

describe('createDefaultAppState', () => {
  it('includes a runtime slot for the primary codex provider', () => {
    const state = createDefaultAppState();

    expect(Object.keys(state.providers)).toEqual([PRIMARY_PROVIDER_ID]);
    expect(state.providers[PRIMARY_PROVIDER_ID]).toMatchObject({
      id: PRIMARY_PROVIDER_ID,
      status: 'unavailable',
      activeTaskId: null,
    });
  });
});
