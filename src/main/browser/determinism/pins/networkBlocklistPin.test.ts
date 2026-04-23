import { describe, expect, it, vi } from 'vitest';
import { networkBlocklistPin } from './networkBlocklistPin';
import type { PinContext } from '../DeterministicKernel';
import { resolveConfig } from '../kernelTypes';

function makeCtx(patterns: string[]): PinContext {
  const dispose = vi.fn();
  return {
    tabId: 'tab_1',
    config: resolveConfig({ blockNetworkPatterns: patterns }),
    capabilities: {
      attachCdp: vi.fn(),
      setUserAgent: vi.fn(),
      restoreUserAgent: vi.fn(),
      insertCss: vi.fn(),
      removeInsertedCss: vi.fn(),
      setViewport: vi.fn(),
      clearViewport: vi.fn(),
      registerRequestBlocker: vi.fn(async () => ({ dispose })),
      isTabAlive: vi.fn(() => true),
    } as PinContext['capabilities'],
  };
}

describe('networkBlocklistPin', () => {
  it('registers the blocker with exact patterns and disposes on revert', async () => {
    const ctx = makeCtx(['https://*.doubleclick.net/*', 'https://ga.jspm.io/*']);
    const handle = await networkBlocklistPin.apply(ctx);
    expect(ctx.capabilities.registerRequestBlocker).toHaveBeenCalledWith('tab_1', [
      'https://*.doubleclick.net/*',
      'https://ga.jspm.io/*',
    ]);
    await handle.revert();
    const firstCall = (ctx.capabilities.registerRequestBlocker as ReturnType<typeof vi.fn>).mock.results[0].value;
    const blocker = await firstCall;
    expect(blocker.dispose).toHaveBeenCalled();
  });

  it('does not register a blocker when patterns is empty', async () => {
    const ctx = makeCtx([]);
    await networkBlocklistPin.apply(ctx);
    expect(ctx.capabilities.registerRequestBlocker).not.toHaveBeenCalled();
  });
});
