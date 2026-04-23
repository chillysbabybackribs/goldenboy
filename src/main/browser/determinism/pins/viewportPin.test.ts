import { describe, expect, it, vi } from 'vitest';
import { viewportPin } from './viewportPin';
import type { PinContext } from '../DeterministicKernel';
import { resolveConfig } from '../kernelTypes';

function makeCtx(): {
  ctx: PinContext;
  setViewport: ReturnType<typeof vi.fn>;
  clearViewport: ReturnType<typeof vi.fn>;
  cdpSend: ReturnType<typeof vi.fn>;
} {
  const setViewport = vi.fn(async () => {});
  const clearViewport = vi.fn(async () => {});
  const cdpSend = vi.fn(async () => ({}));
  const ctx: PinContext = {
    tabId: 'tab_1',
    config: resolveConfig({ viewport: { width: 1024, height: 768, deviceScaleFactor: 2 } }),
    capabilities: {
      attachCdp: vi.fn(async () => ({ send: cdpSend, detach: vi.fn(async () => {}) })),
      setUserAgent: vi.fn(),
      restoreUserAgent: vi.fn(),
      insertCss: vi.fn(),
      removeInsertedCss: vi.fn(),
      setViewport,
      clearViewport,
      registerRequestBlocker: vi.fn(),
      isTabAlive: vi.fn(() => true),
    } as PinContext['capabilities'],
  };
  return { ctx, setViewport, clearViewport, cdpSend };
}

describe('viewportPin', () => {
  it('applies the configured viewport and reverts by clearing', async () => {
    const { ctx, setViewport, clearViewport } = makeCtx();
    const handle = await viewportPin.apply(ctx);
    expect(setViewport).toHaveBeenCalledWith('tab_1', { width: 1024, height: 768, deviceScaleFactor: 2 });
    await handle.revert();
    expect(clearViewport).toHaveBeenCalledWith('tab_1');
  });
});
