import type { CdpEventHandler, CdpHandle, KernelCapabilities } from '../kernelCapabilities';
import type { BrowserService } from '../../BrowserService';

export interface ElectronKernelCapabilitiesDeps {
  browserService: BrowserService;
}

export function createElectronKernelCapabilities(deps: ElectronKernelCapabilitiesDeps): KernelCapabilities {
  const { browserService } = deps;

  const cdpCache = new Map<string, CdpHandle>();
  const previousUserAgents = new Map<string, string>();
  // Tracks sessions that have the Electron-regression webRequest sentinel
  // installed. See `ensureWebRequestSentinel` below for context.
  const sentinelSessions = new WeakSet<Electron.Session>();

  function requireWebContents(tabId: string): Electron.WebContents {
    const wc = browserService.getTabWebContents(tabId);
    if (!wc) throw new Error(`determinism: no webContents for tab ${tabId}`);
    return wc;
  }

  /**
   * Workaround for electron/electron#50678: since Electron v41 (Dec 2025
   * Chromium bump), attaching `webContents.debugger` and enabling CDP
   * interception (Fetch/Network) can cause intermittent ERR_FAILED on
   * main-frame navigations when no WebRequest listener is registered. The
   * DevTools URL loader creates a header client, but with no WebRequest
   * listeners the connection is silently dropped. Installing any no-op
   * WebRequest listener on the session keeps the pipe alive.
   */
  function ensureWebRequestSentinel(session: Electron.Session): void {
    if (sentinelSessions.has(session)) return;
    try {
      session.webRequest.onErrorOccurred(() => { /* sentinel — intentionally empty */ });
      sentinelSessions.add(session);
    } catch { /* ignore; adapter remains usable without the sentinel */ }
  }

  async function attachCdp(tabId: string): Promise<CdpHandle> {
    const cached = cdpCache.get(tabId);
    if (cached) return cached;

    const wc = requireWebContents(tabId);
    ensureWebRequestSentinel(wc.session);
    if (!wc.debugger.isAttached()) {
      wc.debugger.attach('1.3');
    }

    // Dispatch CDP events to per-method handler sets. Register the listener
    // BEFORE enabling any CDP domain so we don't drop early events.
    const listeners = new Map<string, Set<CdpEventHandler>>();
    const onMessage = (_event: unknown, method: string, params: unknown) => {
      const handlers = listeners.get(method);
      if (!handlers || handlers.size === 0) return;
      const payload = (params ?? {}) as Record<string, unknown>;
      for (const h of handlers) {
        try {
          const result = h(payload);
          if (result && typeof (result as Promise<unknown>).catch === 'function') {
            (result as Promise<unknown>).catch(() => { /* handler already owns its errors */ });
          }
        } catch { /* ignore */ }
      }
    };
    wc.debugger.on('message', onMessage);

    await wc.debugger.sendCommand('Page.enable');
    await wc.debugger.sendCommand('Runtime.enable');

    const handle: CdpHandle = {
      send: (method, params) => wc.debugger.sendCommand(method, params ?? {}),
      on: (event, handler) => {
        let set = listeners.get(event);
        if (!set) { set = new Set(); listeners.set(event, set); }
        set.add(handler);
      },
      off: (event, handler) => {
        const set = listeners.get(event);
        if (!set) return;
        set.delete(handler);
        if (set.size === 0) listeners.delete(event);
      },
      detach: async () => {
        try { wc.debugger.removeListener('message', onMessage); } catch { /* ignore */ }
        listeners.clear();
        try { if (wc.debugger.isAttached()) wc.debugger.detach(); } catch { /* ignore */ }
        cdpCache.delete(tabId);
      },
    };
    cdpCache.set(tabId, handle);
    return handle;
  }

  return {
    attachCdp,

    async setUserAgent(tabId, userAgent) {
      const wc = requireWebContents(tabId);
      const previous = wc.getUserAgent();
      previousUserAgents.set(tabId, previous);
      wc.setUserAgent(userAgent);
      return previous;
    },

    async restoreUserAgent(tabId, previous) {
      const wc = requireWebContents(tabId);
      wc.setUserAgent(previous);
      previousUserAgents.delete(tabId);
    },

    async insertCss(tabId, css) {
      const wc = requireWebContents(tabId);
      return wc.insertCSS(css);
    },

    async removeInsertedCss(tabId, cssKey) {
      const wc = requireWebContents(tabId);
      await wc.removeInsertedCSS(cssKey);
    },

    async setViewport(tabId, viewport) {
      const cdp = await attachCdp(tabId);
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.deviceScaleFactor,
        mobile: false,
      });
    },

    async clearViewport(tabId) {
      const cdp = await attachCdp(tabId);
      await cdp.send('Emulation.clearDeviceMetricsOverride', {});
    },

    isTabAlive(tabId) {
      return browserService.getTabWebContents(tabId) !== null;
    },
  };
}
