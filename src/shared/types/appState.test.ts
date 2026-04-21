import { describe, expect, it } from 'vitest';
import { createDefaultAppState } from './appState';
import { GEMINI_PROVIDER_ID, HAIKU_PROVIDER_ID, PRIMARY_PROVIDER_ID } from './model';

describe('createDefaultAppState', () => {
  it('includes runtime slots for codex, haiku, and gemini', () => {
    const state = createDefaultAppState();

    expect(Object.keys(state.providers).sort()).toEqual([
      GEMINI_PROVIDER_ID,
      HAIKU_PROVIDER_ID,
      PRIMARY_PROVIDER_ID,
    ].sort());
    expect(state.providers[GEMINI_PROVIDER_ID]).toMatchObject({
      id: GEMINI_PROVIDER_ID,
      status: 'unavailable',
      activeTaskId: null,
    });
  });
});
