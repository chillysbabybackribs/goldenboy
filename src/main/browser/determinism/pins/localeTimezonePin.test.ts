import { describe, expect, it, vi } from 'vitest';
import { localeTimezonePin } from './localeTimezonePin';
import type { PinContext } from '../DeterministicKernel';
import { resolveConfig } from '../kernelTypes';

describe('localeTimezonePin', () => {
  it('sends Emulation.setLocaleOverride + setTimezoneOverride + setEmulatedMedia, and reverts all three', async () => {
    const send = vi.fn(async () => ({}));
    const detach = vi.fn(async () => {});
    const attach = vi.fn(async () => ({ send, detach }));
    const ctx: PinContext = {
      tabId: 'tab_1',
      config: resolveConfig({ locale: 'fr-FR', timezone: 'Europe/Paris', reduceMotion: true }),
      capabilities: {
        attachCdp: attach,
        setUserAgent: vi.fn(),
        restoreUserAgent: vi.fn(),
        insertCss: vi.fn(),
        removeInsertedCss: vi.fn(),
        setViewport: vi.fn(),
        clearViewport: vi.fn(),
        registerRequestBlocker: vi.fn(),
        isTabAlive: vi.fn(() => true),
      } as PinContext['capabilities'],
    };

    const handle = await localeTimezonePin.apply(ctx);
    const methodsCalled = send.mock.calls.map(c => c[0]);
    expect(methodsCalled).toContain('Emulation.setLocaleOverride');
    expect(methodsCalled).toContain('Emulation.setTimezoneOverride');
    expect(methodsCalled).toContain('Emulation.setEmulatedMedia');

    await handle.revert();
    const revertMethods = send.mock.calls.slice(3).map(c => c[0]);
    expect(revertMethods).toEqual([
      'Emulation.setLocaleOverride',
      'Emulation.setTimezoneOverride',
      'Emulation.setEmulatedMedia',
    ]);
    expect(send.mock.calls[3][1]).toEqual({ locale: '' });
    expect(send.mock.calls[4][1]).toEqual({ timezoneId: '' });
    expect(send.mock.calls[5][1]).toEqual({ features: [] });
  });

  it('skips setEmulatedMedia when reduceMotion is false', async () => {
    const send = vi.fn(async () => ({}));
    const attach = vi.fn(async () => ({ send, detach: vi.fn(async () => {}) }));
    const ctx: PinContext = {
      tabId: 'tab_1',
      config: resolveConfig({ reduceMotion: false }),
      capabilities: {
        attachCdp: attach,
        setUserAgent: vi.fn(),
        restoreUserAgent: vi.fn(),
        insertCss: vi.fn(),
        removeInsertedCss: vi.fn(),
        setViewport: vi.fn(),
        clearViewport: vi.fn(),
        registerRequestBlocker: vi.fn(),
        isTabAlive: vi.fn(() => true),
      } as PinContext['capabilities'],
    };

    await localeTimezonePin.apply(ctx);
    const methods = send.mock.calls.map(c => c[0]);
    expect(methods).not.toContain('Emulation.setEmulatedMedia');
  });
});
