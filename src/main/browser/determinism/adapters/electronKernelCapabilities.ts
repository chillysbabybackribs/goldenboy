import type { KernelCapabilities, CdpHandle } from '../kernelCapabilities';
import type { BrowserService } from '../../BrowserService';

export interface ElectronKernelCapabilitiesDeps {
  browserService: BrowserService;
}

export function createElectronKernelCapabilities(deps: ElectronKernelCapabilitiesDeps): KernelCapabilities {
  const { browserService } = deps;

  const cdpCache = new Map<string, CdpHandle>();
  const previousUserAgents = new Map<string, string>();
  const blockerRegistry = new WeakMap<Electron.Session, { entries: Set<{ regexes: RegExp[] }> }>();

  function requireWebContents(tabId: string): Electron.WebContents {
    const wc = browserService.getTabWebContents(tabId);
    if (!wc) throw new Error(`determinism: no webContents for tab ${tabId}`);
    return wc;
  }

  function requireSession(tabId: string): Electron.Session {
    const ses = browserService.getTabSession(tabId);
    if (!ses) throw new Error(`determinism: no session for tab ${tabId}`);
    return ses;
  }

  async function attachCdp(tabId: string): Promise<CdpHandle> {
    const cached = cdpCache.get(tabId);
    if (cached) return cached;

    const wc = requireWebContents(tabId);
    if (!wc.debugger.isAttached()) {
      wc.debugger.attach('1.3');
    }
    await wc.debugger.sendCommand('Page.enable');
    await wc.debugger.sendCommand('Runtime.enable');

    const handle: CdpHandle = {
      send: (method, params) => wc.debugger.sendCommand(method, params ?? {}),
      detach: async () => {
        try { if (wc.debugger.isAttached()) wc.debugger.detach(); } catch { /* ignore */ }
        cdpCache.delete(tabId);
      },
    };
    cdpCache.set(tabId, handle);
    return handle;
  }

  return {
    attachCdp,

    async reloadTab(tabId) {
      const wc = requireWebContents(tabId);
      wc.reload();
    },

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

    async registerRequestBlocker(tabId, patterns) {
      const ses = requireSession(tabId);
      const regexes = patterns.map(globToRegex);
      const entry = { regexes };
      const existing = blockerRegistry.get(ses);
      if (existing) {
        existing.entries.add(entry);
      } else {
        const entries = new Set<{ regexes: RegExp[] }>([entry]);
        ses.webRequest.onBeforeRequest(
          { urls: ['<all_urls>'] },
          (details, callback) => {
            let blocked = false;
            for (const e of entries) {
              if (e.regexes.some(r => r.test(details.url))) { blocked = true; break; }
            }
            callback({ cancel: blocked });
          },
        );
        blockerRegistry.set(ses, { entries });
      }
      return {
        dispose: () => {
          const record = blockerRegistry.get(ses);
          if (!record) return;
          record.entries.delete(entry);
          if (record.entries.size === 0) {
            ses.webRequest.onBeforeRequest(null);
            blockerRegistry.delete(ses);
          }
        },
      };
    },

    isTabAlive(tabId) {
      return browserService.getTabWebContents(tabId) !== null;
    },
  };
}

function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}
