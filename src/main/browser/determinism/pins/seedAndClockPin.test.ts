import { describe, expect, it, vi } from 'vitest';
import { seedAndClockPin } from './seedAndClockPin';
import type { PinContext } from '../DeterministicKernel';
import { resolveConfig } from '../kernelTypes';

describe('seedAndClockPin (wiring)', () => {
  it('registers a document-start script and removes it on revert', async () => {
    const send = vi.fn(async (method: string) => {
      if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: 'script_42' };
      return {};
    });
    const ctx: PinContext = {
      tabId: 'tab_1',
      config: resolveConfig({ seed: 12345, clock: 1700000000000 }),
      capabilities: {
        attachCdp: vi.fn(async () => ({ send, detach: vi.fn(async () => {}) })),
        setUserAgent: vi.fn(), restoreUserAgent: vi.fn(),
        insertCss: vi.fn(), removeInsertedCss: vi.fn(),
        setViewport: vi.fn(), clearViewport: vi.fn(),
        registerRequestBlocker: vi.fn(),
        isTabAlive: vi.fn(() => true),
      } as PinContext['capabilities'],
    };

    const handle = await seedAndClockPin.apply(ctx);
    const addCall = send.mock.calls.find(c => c[0] === 'Page.addScriptToEvaluateOnNewDocument');
    expect(addCall).toBeDefined();
    const source = (addCall![1] as { source: string }).source;
    expect(source).toContain('12345');
    expect(source).toContain('1700000000000');
    expect(source).toContain('Math.random');

    await handle.revert();
    const removeCall = send.mock.calls.find(c => c[0] === 'Page.removeScriptToEvaluateOnNewDocument');
    expect(removeCall![1]).toEqual({ identifier: 'script_42' });
  });
});
