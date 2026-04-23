import type { Pin } from '../DeterministicKernel';
import type { ClockSpec } from '../kernelTypes';

export interface PreloadScriptOptions {
  seed: number;
  clock: 'frozen' | 'offset';
  clockBase: number;
}

/**
 * Builds the preload script body that's injected via
 * `Page.addScriptToEvaluateOnNewDocument` at document-start. The script runs
 * in the page's main world before any page script, and patches:
 *   - `Math.random` with a seeded mulberry32 PRNG
 *   - `Date` with a patched constructor + `Date.now` + `Date.prototype.getTime`
 *     that return either the frozen `clockBase` or an offset that advances
 *     monotonically via `performance.now()` relative to enter-time.
 *
 * Notes on how this stays robust:
 *  - Uses `Object.defineProperty` so page scripts can't simply reassign.
 *  - Provides a pure-JS fallback for `Math.imul` because the unit test
 *    sandbox spreads `{...Math}` (which drops non-enumerable built-ins).
 *  - Mutates the live `Date` constructor (Date.now, Date.prototype.getTime)
 *    IN ADDITION to replacing `globalThis.Date`, so closures that captured
 *    `Date` before the global swap still see deterministic behavior.
 */
export function buildDeterministicPreloadScript(opts: PreloadScriptOptions): string {
  const { seed, clock, clockBase } = opts;
  return `
(() => {
  // Patches Math.random and Date for deterministic behavior.
  const SEED = ${seed >>> 0};
  const CLOCK_BASE = ${clockBase};
  const CLOCK_MODE = ${JSON.stringify(clock)};
  const ENTER_PERF = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
    ? performance.now()
    : 0;

  const imul = (Math && typeof Math.imul === 'function') ? Math.imul : function(a, b) {
    const aLo = a & 0xffff, aHi = (a >>> 16) & 0xffff;
    const bLo = b & 0xffff, bHi = (b >>> 16) & 0xffff;
    return ((aLo * bLo) + (((aHi * bLo + aLo * bHi) << 16) >>> 0)) >>> 0;
  };

  let s = SEED >>> 0;
  const rand = function() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = imul(t ^ (t >>> 15), t | 1);
    t ^= t + imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try {
    Object.defineProperty(Math, 'random', { value: rand, writable: false, configurable: false });
  } catch (e) {
    try { Math.random = rand; } catch (e2) { /* ignore */ }
  }

  const nowFn = (CLOCK_MODE === 'frozen')
    ? function() { return CLOCK_BASE; }
    : function() {
        const p = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
          ? performance.now() : 0;
        return CLOCK_BASE + (p - ENTER_PERF);
      };

  const OriginalDate = Date;
  function PatchedDate() {
    const args = arguments;
    if (!(this instanceof PatchedDate)) {
      return new OriginalDate(nowFn()).toString();
    }
    if (args.length === 0) return Reflect.construct(OriginalDate, [nowFn()]);
    return Reflect.construct(OriginalDate, Array.prototype.slice.call(args));
  }
  PatchedDate.now = nowFn;
  PatchedDate.parse = OriginalDate.parse;
  PatchedDate.UTC = OriginalDate.UTC;
  PatchedDate.prototype = OriginalDate.prototype;

  // Belt-and-suspenders: patch the live Date constructor so any closure that
  // captured \`Date\` before our globalThis swap still sees deterministic time.
  try {
    Object.defineProperty(OriginalDate, 'now', { value: nowFn, writable: true, configurable: true });
  } catch (e) { /* ignore */ }
  try {
    Object.defineProperty(OriginalDate.prototype, 'getTime', {
      value: function() { return nowFn(); },
      writable: true,
      configurable: true,
    });
  } catch (e) { /* ignore */ }
  try {
    Object.defineProperty(OriginalDate.prototype, 'valueOf', {
      value: function() { return nowFn(); },
      writable: true,
      configurable: true,
    });
  } catch (e) { /* ignore */ }

  try {
    Object.defineProperty(globalThis, 'Date', { value: PatchedDate, writable: true, configurable: true });
  } catch (e) {
    try { globalThis.Date = PatchedDate; } catch (e2) { /* ignore */ }
  }
})();
`.trim();
}

function resolveClockBase(
  clock: ClockSpec,
  now: () => number,
): { base: number; mode: 'frozen' | 'offset' } {
  if (clock === 'frozen') return { base: now(), mode: 'frozen' };
  return { base: clock, mode: 'offset' };
}

export const seedAndClockPin: Pin = {
  name: 'seedAndClock',
  async apply({ tabId, config, capabilities }) {
    const cdp = await capabilities.attachCdp(tabId);
    const { base, mode } = resolveClockBase(config.clock, Date.now);
    const source = buildDeterministicPreloadScript({
      seed: config.seed,
      clock: mode,
      clockBase: base,
    });
    const result = (await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source })) as {
      identifier: string;
    };
    return {
      name: 'seedAndClock',
      revert: async () => {
        await cdp.send('Page.removeScriptToEvaluateOnNewDocument', {
          identifier: result.identifier,
        });
      },
    };
  },
};
