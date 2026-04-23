import type { Pin } from '../DeterministicKernel';

/**
 * Compile a glob-ish URL pattern (only `*` is meaningful; everything else is
 * regex-escaped) into a full-match regex. Used for per-tab request
 * interception via CDP `Fetch.enable`.
 */
export function globPatternToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/**
 * Per-tab network blocklist. Uses CDP `Fetch.enable` on the tab's debugger
 * session so that (unlike session-scoped `webRequest.onBeforeRequest`) two
 * deterministic tabs sharing an Electron session can have independent
 * blocklists without clobbering each other.
 */
export const networkBlocklistPin: Pin = {
  name: 'networkBlocklist',
  async apply({ tabId, config, capabilities }) {
    if (config.blockNetworkPatterns.length === 0) {
      return { name: 'networkBlocklist', revert: () => Promise.resolve() };
    }

    const cdp = await capabilities.attachCdp(tabId);
    const regexes = config.blockNetworkPatterns.map(globPatternToRegex);

    const handleRequestPaused = async (params: Record<string, unknown>) => {
      const requestId = params.requestId as string | undefined;
      if (typeof requestId !== 'string') return;
      const request = params.request as { url?: string } | undefined;
      const url = request?.url ?? '';
      const blocked = regexes.some(r => r.test(url));
      try {
        if (blocked) {
          await cdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
        } else {
          await cdp.send('Fetch.continueRequest', { requestId });
        }
      } catch {
        // The request may have been cancelled by the renderer, the tab may
        // have been destroyed, or Fetch may have been disabled mid-flight.
        // Swallow — the CDP fetch contract tolerates best-effort responses.
      }
    };

    cdp.on('Fetch.requestPaused', handleRequestPaused);
    // Pause every request at the Request stage so we can decide per-URL in
    // the handler. Electron's CDP implementation does not reliably honour
    // scoped `patterns` for main-frame navigation — requests that wouldn't
    // match get stuck indefinitely — so we intercept everything and route
    // non-matching URLs through `Fetch.continueRequest` in the handler.
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });

    return {
      name: 'networkBlocklist',
      revert: async () => {
        cdp.off('Fetch.requestPaused', handleRequestPaused);
        try {
          await cdp.send('Fetch.disable', {});
        } catch { /* ignore */ }
      },
    };
  },
};
