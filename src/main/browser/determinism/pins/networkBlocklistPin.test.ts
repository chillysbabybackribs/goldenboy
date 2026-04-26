import { describe, expect, it, vi } from 'vitest';
import { globPatternToRegex, networkBlocklistPin } from './networkBlocklistPin';
import type { PinContext } from '../DeterministicKernel';
import type { CdpEventHandler } from '../kernelCapabilities';
import { resolveConfig } from '../kernelTypes';

type FakeCdp = {
  send: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
  handlers: Map<string, Set<CdpEventHandler>>;
  emit: (method: string, params: Record<string, unknown>) => Promise<void>;
};

function makeCtx(patterns: string[]): { ctx: PinContext; cdp: FakeCdp } {
  const handlers = new Map<string, Set<CdpEventHandler>>();
  const on = vi.fn((event: string, handler: CdpEventHandler) => {
    let set = handlers.get(event);
    if (!set) { set = new Set(); handlers.set(event, set); }
    set.add(handler);
  });
  const off = vi.fn((event: string, handler: CdpEventHandler) => {
    handlers.get(event)?.delete(handler);
  });
  const send = vi.fn(async () => ({}));
  const detach = vi.fn(async () => {});
  const cdp: FakeCdp = {
    send,
    on,
    off,
    detach,
    handlers,
    emit: async (event, params) => {
      const set = handlers.get(event);
      if (!set) return;
      for (const h of [...set]) {
        await h(params);
      }
    },
  };

  const ctx: PinContext = {
    tabId: 'tab_1',
    config: resolveConfig({ blockNetworkPatterns: patterns }),
    capabilities: {
      attachCdp: vi.fn(async () => cdp),
      setUserAgent: vi.fn(),
      restoreUserAgent: vi.fn(),
      insertCss: vi.fn(),
      removeInsertedCss: vi.fn(),
      setViewport: vi.fn(),
      clearViewport: vi.fn(),
      isTabAlive: vi.fn(() => true),
    } as PinContext['capabilities'],
  };

  return { ctx, cdp };
}

describe('networkBlocklistPin', () => {
  it('enables Fetch interception and registers a Fetch.requestPaused handler', async () => {
    const { ctx, cdp } = makeCtx(['https://*.doubleclick.net/*']);

    await networkBlocklistPin.apply(ctx);

    expect(cdp.on).toHaveBeenCalledWith('Fetch.requestPaused', expect.any(Function));
    expect(cdp.send).toHaveBeenCalledWith('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  });

  it('fails requests matching any blocklist pattern with BlockedByClient', async () => {
    const { ctx, cdp } = makeCtx(['https://*.doubleclick.net/*']);
    await networkBlocklistPin.apply(ctx);

    cdp.send.mockClear();
    await cdp.emit('Fetch.requestPaused', {
      requestId: 'req-1',
      request: { url: 'https://ads.doubleclick.net/beacon' },
    });

    expect(cdp.send).toHaveBeenCalledWith('Fetch.failRequest', {
      requestId: 'req-1',
      errorReason: 'BlockedByClient',
    });
  });

  it('continues requests that do not match any pattern', async () => {
    const { ctx, cdp } = makeCtx(['https://*.doubleclick.net/*']);
    await networkBlocklistPin.apply(ctx);

    cdp.send.mockClear();
    await cdp.emit('Fetch.requestPaused', {
      requestId: 'req-2',
      request: { url: 'https://example.com/' },
    });

    expect(cdp.send).toHaveBeenCalledWith('Fetch.continueRequest', { requestId: 'req-2' });
  });

  it('revert removes the handler and disables Fetch', async () => {
    const { ctx, cdp } = makeCtx(['https://ga.jspm.io/*']);
    const handle = await networkBlocklistPin.apply(ctx);

    await handle.revert();

    expect(cdp.off).toHaveBeenCalledWith('Fetch.requestPaused', expect.any(Function));
    expect(cdp.send).toHaveBeenCalledWith('Fetch.disable', {});
  });

  it('does not attach or enable Fetch when the blocklist is empty', async () => {
    const { ctx, cdp } = makeCtx([]);
    await networkBlocklistPin.apply(ctx);
    expect(cdp.on).not.toHaveBeenCalled();
    expect(cdp.send).not.toHaveBeenCalled();
  });

  it('tolerates Fetch.continueRequest errors (e.g. request already resolved)', async () => {
    const { ctx, cdp } = makeCtx(['https://blocked.example/*']);
    await networkBlocklistPin.apply(ctx);

    cdp.send.mockImplementation(async (method: string) => {
      if (method === 'Fetch.continueRequest') throw new Error('request already handled');
      return {};
    });

    await expect(
      cdp.emit('Fetch.requestPaused', { requestId: 'req-3', request: { url: 'https://ok.example/' } }),
    ).resolves.not.toThrow();
  });

  it('globPatternToRegex anchors full match and escapes regex metacharacters', () => {
    const re = globPatternToRegex('https://*.foo.com/path?x=1');
    expect(re.test('https://a.foo.com/path?x=1')).toBe(true);
    expect(re.test('https://a.foo.com/path?x=1&y=2')).toBe(false);
    expect(re.test('http://a.foo.com/path?x=1')).toBe(false);
  });
});
