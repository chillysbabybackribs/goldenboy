import { describe, expect, it, vi } from 'vitest';
import { visualPin } from './visualPin';
import type { PinContext } from '../DeterministicKernel';
import { resolveConfig } from '../kernelTypes';

function makeCtx(overrides: Partial<import('../kernelTypes').DeterminismConfig> = {}): PinContext {
  const insertCss = vi.fn(async () => 'css-123');
  const removeInsertedCss = vi.fn(async () => {});
  return {
    tabId: 'tab_1',
    config: resolveConfig(overrides),
    capabilities: {
      attachCdp: vi.fn(),
      setUserAgent: vi.fn(),
      restoreUserAgent: vi.fn(),
      insertCss,
      removeInsertedCss,
      setViewport: vi.fn(),
      clearViewport: vi.fn(),
      registerRequestBlocker: vi.fn(),
      isTabAlive: vi.fn(() => true),
    } as PinContext['capabilities'],
  };
}

describe('visualPin', () => {
  it('injects zero-duration CSS when disableAnimations is true and reverts with the returned key', async () => {
    const ctx = makeCtx({ disableAnimations: true, reduceMotion: false });
    const handle = await visualPin.apply(ctx);
    const css = (ctx.capabilities.insertCss as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(css).toMatch(/animation-duration:\s*0s/);
    expect(css).toMatch(/transition-duration:\s*0s/);
    await handle.revert();
    expect(ctx.capabilities.removeInsertedCss).toHaveBeenCalledWith('tab_1', 'css-123');
  });

  it('does not inject CSS when both disableAnimations and reduceMotion are false', async () => {
    const ctx = makeCtx({ disableAnimations: false, reduceMotion: false });
    const handle = await visualPin.apply(ctx);
    expect(ctx.capabilities.insertCss).not.toHaveBeenCalled();
    await handle.revert();
    expect(ctx.capabilities.removeInsertedCss).not.toHaveBeenCalled();
  });
});
