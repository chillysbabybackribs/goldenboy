import { describe, expect, it, vi } from 'vitest';
import { userAgentPin } from './userAgentPin';
import type { PinContext } from '../DeterministicKernel';
import { resolveConfig } from '../kernelTypes';

function makeCtx(overrides: Partial<PinContext['capabilities']> = {}, userAgent: string | null = 'test-ua'): PinContext {
  const config = resolveConfig({ userAgent: userAgent ?? undefined });
  return {
    tabId: 'tab_1',
    config,
    capabilities: {
      attachCdp: vi.fn(),
      setUserAgent: vi.fn(async () => 'prev-ua'),
      restoreUserAgent: vi.fn(async () => {}),
      insertCss: vi.fn(),
      removeInsertedCss: vi.fn(),
      setViewport: vi.fn(),
      clearViewport: vi.fn(),
      isTabAlive: vi.fn(() => true),
      ...overrides,
    } as PinContext['capabilities'],
  };
}

describe('userAgentPin', () => {
  it('applies the configured user agent and reverts to the previous one', async () => {
    const ctx = makeCtx({}, 'goldenboy-ua');
    const handle = await userAgentPin.apply(ctx);
    expect(ctx.capabilities.setUserAgent).toHaveBeenCalledWith('tab_1', 'goldenboy-ua');
    await handle.revert();
    expect(ctx.capabilities.restoreUserAgent).toHaveBeenCalledWith('tab_1', 'prev-ua');
  });

  it('is a no-op when userAgent is null in config', async () => {
    const ctx = makeCtx({}, null);
    const handle = await userAgentPin.apply(ctx);
    expect(ctx.capabilities.setUserAgent).not.toHaveBeenCalled();
    await handle.revert();
    expect(ctx.capabilities.restoreUserAgent).not.toHaveBeenCalled();
  });
});
