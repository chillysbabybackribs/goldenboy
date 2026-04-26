import { describe, expect, it, vi } from 'vitest';
import { ANIMATIONS_OFF_CSS, buildVisualPreloadScript, visualPin } from './visualPin';
import type { PinContext } from '../DeterministicKernel';
import { resolveConfig } from '../kernelTypes';

function makeCtx(overrides: Partial<import('../kernelTypes').DeterminismConfig> = {}): {
  ctx: PinContext;
  cdpSend: ReturnType<typeof vi.fn>;
  insertCss: ReturnType<typeof vi.fn>;
  removeInsertedCss: ReturnType<typeof vi.fn>;
} {
  const cdpSend = vi.fn(async (method: string) => {
    if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: 'script-42' };
    return {};
  });
  const insertCss = vi.fn(async () => 'css-123');
  const removeInsertedCss = vi.fn(async () => {});
  const attachCdp = vi.fn(async () => ({
    send: cdpSend,
    on: vi.fn(),
    off: vi.fn(),
    detach: vi.fn(async () => {}),
  }));
  return {
    ctx: {
      tabId: 'tab_1',
      config: resolveConfig(overrides),
      capabilities: {
        attachCdp,
        setUserAgent: vi.fn(),
        restoreUserAgent: vi.fn(),
        insertCss,
        removeInsertedCss,
        setViewport: vi.fn(),
        clearViewport: vi.fn(),
        isTabAlive: vi.fn(() => true),
      } as PinContext['capabilities'],
    },
    cdpSend,
    insertCss,
    removeInsertedCss,
  };
}

describe('visualPin', () => {
  it('injects zero-duration CSS via preload + current-document insertCSS when disableAnimations is true', async () => {
    const { ctx, cdpSend, insertCss, removeInsertedCss } = makeCtx({
      disableAnimations: true,
      reduceMotion: false,
    });

    const handle = await visualPin.apply(ctx);

    const preloadCall = cdpSend.mock.calls.find(c => c[0] === 'Page.addScriptToEvaluateOnNewDocument');
    expect(preloadCall).toBeTruthy();
    const preloadSource = (preloadCall![1] as { source: string }).source;
    expect(preloadSource).toContain('animation-duration: 0s');
    expect(preloadSource).toContain('transition-duration: 0s');
    expect(preloadSource).toContain('__goldenboy_determinism_visual__');

    expect(insertCss).toHaveBeenCalledWith('tab_1', ANIMATIONS_OFF_CSS);

    await handle.revert();
    expect(cdpSend).toHaveBeenCalledWith('Page.removeScriptToEvaluateOnNewDocument', { identifier: 'script-42' });
    expect(removeInsertedCss).toHaveBeenCalledWith('tab_1', 'css-123');
  });

  it('is a no-op when disableAnimations is false (reduceMotion is handled by localeTimezonePin)', async () => {
    const { ctx, cdpSend, insertCss, removeInsertedCss } = makeCtx({
      disableAnimations: false,
      reduceMotion: true,
    });

    const handle = await visualPin.apply(ctx);

    expect(cdpSend).not.toHaveBeenCalled();
    expect(insertCss).not.toHaveBeenCalled();
    await handle.revert();
    expect(removeInsertedCss).not.toHaveBeenCalled();
  });

  it('is a no-op when both flags are false', async () => {
    const { ctx, cdpSend, insertCss } = makeCtx({ disableAnimations: false, reduceMotion: false });
    const handle = await visualPin.apply(ctx);
    expect(cdpSend).not.toHaveBeenCalled();
    expect(insertCss).not.toHaveBeenCalled();
    await handle.revert();
  });

  it('preload script is idempotent (skips re-injection if the style tag already exists)', () => {
    const src = buildVisualPreloadScript('body { color: red; }');
    expect(src).toContain("document.getElementById(");
    expect(src).toContain('__goldenboy_determinism_visual__');
  });

  it('revert tolerates insertCss having failed (e.g. no current document) without throwing', async () => {
    const cdpSend = vi.fn(async (method: string) => {
      if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: 'script-x' };
      return {};
    });
    const insertCss = vi.fn(async () => { throw new Error('no current document'); });
    const removeInsertedCss = vi.fn(async () => {});
    const ctx: PinContext = {
      tabId: 'tab_1',
      config: resolveConfig({ disableAnimations: true }),
      capabilities: {
        attachCdp: vi.fn(async () => ({ send: cdpSend, on: vi.fn(), off: vi.fn(), detach: vi.fn() })),
        setUserAgent: vi.fn(),
        restoreUserAgent: vi.fn(),
        insertCss,
        removeInsertedCss,
        setViewport: vi.fn(),
        clearViewport: vi.fn(),
        isTabAlive: vi.fn(() => true),
      } as PinContext['capabilities'],
    };

    const handle = await visualPin.apply(ctx);
    await expect(handle.revert()).resolves.not.toThrow();
    expect(removeInsertedCss).not.toHaveBeenCalled();
  });
});
