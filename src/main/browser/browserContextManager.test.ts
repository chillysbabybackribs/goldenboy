import { beforeEach, describe, expect, it, vi } from 'vitest';

const { browserService } = vi.hoisted(() => ({
  browserService: {
    isCreated: vi.fn(() => true),
  },
}));

vi.mock('./BrowserService', () => ({ browserService }));

import { DEFAULT_BROWSER_CONTEXT_ID } from './browserContext';
import { browserContextManager } from './browserContextManager';

describe('browserContextManager', () => {
  beforeEach(() => {
    browserContextManager.resetForTests(browserService as any);
  });

  it('resolves the singleton-backed default context when none is provided', () => {
    const context = browserContextManager.resolveContext();

    expect(context.id).toBe(DEFAULT_BROWSER_CONTEXT_ID);
    expect(context.isDefault).toBe(true);
    expect(context.service).toBe(browserService);
  });

  it('resolves an explicitly created context by id', () => {
    const secondaryService = { isCreated: vi.fn(() => true) } as any;
    browserContextManager.createContext({
      id: 'ctx_test',
      label: 'Test Context',
      service: secondaryService,
    });

    const context = browserContextManager.resolveContext('ctx_test');

    expect(context).toEqual({
      id: 'ctx_test',
      label: 'Test Context',
      isDefault: false,
      service: secondaryService,
    });
  });
});
