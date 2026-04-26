import type { Pin } from '../DeterministicKernel';

export const ANIMATIONS_OFF_CSS = `
*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  scroll-behavior: auto !important;
}
`.trim();

const STYLE_TAG_ID = '__goldenboy_determinism_visual__';

/**
 * Builds the document-start preload that injects a deterministic <style> tag on
 * every navigation. `Page.addScriptToEvaluateOnNewDocument` runs at document-
 * start in every new document (top and subframe), which makes the visual pin
 * survive navigations — `webContents.insertCSS` alone is scoped to the current
 * document only and is dropped on the first navigation after kernel entry.
 */
export function buildVisualPreloadScript(css: string): string {
  // Defer injection until `document.head` exists. Injecting into
  // `document.documentElement` at document-start (before `<head>` is parsed)
  // prepends an element to `<html>` which corrupts Chromium's HTML parser
  // state — the body never finishes parsing, title stays empty, etc.
  // Using a MutationObserver keeps the injection one microtask behind
  // the parser creating the head, avoiding the corruption.
  return `(() => {
  var css = ${JSON.stringify(css)};
  var TAG = ${JSON.stringify(STYLE_TAG_ID)};
  function inject(parent) {
    try {
      if (!parent || document.getElementById(TAG)) return;
      var style = document.createElement('style');
      style.id = TAG;
      style.textContent = css;
      parent.appendChild(style);
    } catch (e) { /* ignore */ }
  }
  if (document.head) {
    inject(document.head);
    return;
  }
  try {
    var obs = new MutationObserver(function () {
      if (document.head) {
        obs.disconnect();
        inject(document.head);
      }
    });
    obs.observe(document.documentElement || document, { childList: true, subtree: false });
  } catch (e) { /* observer unavailable; fall through to DOMContentLoaded */ }
  document.addEventListener('DOMContentLoaded', function () { inject(document.head); }, { once: true });
})();`;
}

export const visualPin: Pin = {
  name: 'visual',
  async apply({ tabId, config, capabilities }) {
    // `reduceMotion` is satisfied by `localeTimezonePin` setting the
    // `prefers-reduced-motion: reduce` media feature via `Emulation.setEmulatedMedia`.
    // Pages that don't honour the media query still have no page-wide CSS override
    // here — use `disableAnimations` for a hard override.
    if (!config.disableAnimations) {
      return { name: 'visual', revert: () => Promise.resolve() };
    }

    const cdp = await capabilities.attachCdp(tabId);
    const preload = (await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: buildVisualPreloadScript(ANIMATIONS_OFF_CSS),
    })) as { identifier: string };

    // Apply to the current document too so the effect is immediate — the
    // preload only runs at document-start for NEW documents.
    let currentCssKey: string | null = null;
    try {
      currentCssKey = await capabilities.insertCss(tabId, ANIMATIONS_OFF_CSS);
    } catch {
      // No current document (or about:blank not yet committed) — the preload
      // will still cover every future navigation.
    }

    return {
      name: 'visual',
      revert: async () => {
        try {
          await cdp.send('Page.removeScriptToEvaluateOnNewDocument', {
            identifier: preload.identifier,
          });
        } catch { /* ignore */ }
        if (currentCssKey !== null) {
          try {
            await capabilities.removeInsertedCss(tabId, currentCssKey);
          } catch {
            // Current document may have navigated away; the inserted CSS was
            // already dropped by the renderer. Safe to ignore.
          }
        }
      },
    };
  },
};
