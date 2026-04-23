# Browser Deterministic Kernel — Design Spec

**Date:** 2026-04-23
**Status:** Draft — awaiting user review
**Scope:** L3 layer only (the kernel). Primitives (L4) and tool collapse (L5) are explicitly deferred to future specs.
**Validation target:** hardening `browser.open_tab` so a new tab enters a pinned deterministic world before the tool returns.

## Overview

Goldenboy owns its Chromium (via Electron `WebContentsView`). That gives it capabilities no out-of-process automation framework has: isolated worlds, direct CDP attach, session/webRequest control, preload injection, and parallel hidden tabs. Today we use almost none of these for determinism.

The deterministic kernel is a thin composition layer (L3) that turns those raw capabilities into a single contract: **"a tab entered into deterministic mode has a pinned world until it is exited or closed."** Every downstream tool can assume that contract without re-implementing the pins.

The kernel does not replace existing browser tools, primitives, or workflows. It sits under them.

## Goals

- One entrypoint (`kernel.enter`) atomically configures all v1 pins on a target tab.
- One exit point (`kernel.exit`) reverts every pin and leaves the tab clean.
- Idempotent: calling `enter` twice with the same config is a no-op; calling `enter` with a different config replaces the pins.
- Survives page navigation: pins outlive redirects and client-side nav.
- Observable: any tool can query `kernel.isDeterministic(tabId)` and `kernel.getState(tabId)`.
- Zero impact on non-deterministic tabs: tabs that never call `enter` behave exactly as today.

## Non-goals (for v1)

- HAR replay or full network stubbing (use `Fetch.enable` + a stub store in a later spec).
- A11y-tree extraction as a primitive (belongs to L4 `observe`).
- CPU throttling, geolocation, device emulation beyond viewport.
- Partition-scoped determinism (Approach 2 from the brainstorm). The kernel is per-tab in v1; partition-scoping is a reachable future extension.
- Collapsing the existing 33 browser tools into primitives (L4/L5 work).
- Middleware style — all pins are explicit via `enter`/`exit`.

## Architecture — Approach 1: per-tab imperative kernel

```
┌────────────────────────────────────────────────────────────────────┐
│ browser.open_tab / browser.*  (L5 agent tools)                     │
│   opts.deterministic? ──► kernel.enter(newTabId, config)           │
└────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│ DeterministicKernel (L3)                                           │
│   enter(tabId, config)   ─► apply pin plan in order                │
│   exit(tabId)            ─► run each pin's revert handle           │
│   getState / isDeterministic                                       │
│   Map<tabId, DeterministicTabState>                                │
└────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│ L2 capability adapters (new, thin)                                 │
│   cdpAdapter (webContents.debugger)                                │
│   preloadAdapter (Page.addScriptToEvaluateOnNewDocument)           │
│   webRequestAdapter (session.webRequest)                           │
│   cssAdapter (insertCSS)                                           │
│   sessionAdapter (session.setUserAgent)                            │
└────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
     Electron webContents / session (L1, unchanged)
```

The kernel has **no knowledge of Electron**. It talks to a `KernelCapabilities` interface that the adapters satisfy. This mirrors the dependency-injection pattern already used in `openTabDeterministic`, and keeps the kernel unit-testable with fakes.

### Data shapes

```ts
export type DeterminismConfig = {
  seed?: number;                    // default: stable hash of runId if provided, else 1
  clock?: 'frozen' | number;        // default: 'frozen' at enter-time wallclock
  viewport?: { width: number; height: number; deviceScaleFactor?: number };
  locale?: string;                  // default: 'en-US'
  timezone?: string;                // default: 'UTC'
  userAgent?: string;               // default: leave as-is
  disableAnimations?: boolean;      // default: true
  reduceMotion?: boolean;           // default: true
  blockNetworkPatterns?: string[];  // default: [] — simple wildcard patterns (`*` only), e.g. `https://*.doubleclick.net/*`
};

export type DeterministicTabState = {
  tabId: string;
  config: Required<DeterminismConfig>;
  enteredAt: number;
  pinHandles: PinHandle[];          // each pin records how to revert itself
};

export type KernelResult = {
  tabId: string;
  pinsApplied: string[];            // human-readable list of applied pins
};
```

### Public API

```ts
export interface DeterministicKernel {
  enter(tabId: string, config?: DeterminismConfig): Promise<KernelResult>;
  exit(tabId: string): Promise<void>;
  getState(tabId: string): DeterministicTabState | null;
  isDeterministic(tabId: string): boolean;
}
```

### Pin plan (ordered — each is a small, independent unit)

Each pin is a `{ apply, revert }` pair. The kernel runs them in order inside `enter`. If any `apply` throws, the kernel runs every already-applied `revert` in reverse order before re-throwing, so a partial failure leaves no residue.

| # | Pin | Mechanism | Reverts by |
|---|---|---|---|
| 1 | `userAgent` | `session.setUserAgent(ua)` | restore previous UA |
| 2 | `viewport` | `webContents.setSize` + CDP `Emulation.setDeviceMetricsOverride` | `Emulation.clearDeviceMetricsOverride` |
| 3 | `locale` | CDP `Emulation.setLocaleOverride` | `Emulation.setLocaleOverride("")` |
| 4 | `timezone` | CDP `Emulation.setTimezoneOverride` | `Emulation.setTimezoneOverride("")` |
| 5 | `reduceMotion` | CDP `Emulation.setEmulatedMedia({ features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })` | `setEmulatedMedia({ features: [] })` |
| 6 | `disableAnimations` | `webContents.insertCSS("* { animation-duration: 0s !important; transition-duration: 0s !important; }")` | `webContents.removeInsertedCSS(key)` |
| 7 | `seed` + `clock` | CDP `Page.addScriptToEvaluateOnNewDocument` injecting mulberry32-seeded `Math.random` and frozen/offset `Date`/`performance.now` | `Page.removeScriptToEvaluateOnNewDocument(id)` + page reload |
| 8 | `blockNetworkPatterns` | `session.webRequest.onBeforeRequest` handler matching each glob | unregister handler |

Pins #2–5 and #7 require a live CDP attach. Attaching happens once at the start of `enter` and is recorded as pin #0 so `exit` always detaches.

### Pin #7 — the preload script (most novel piece)

Injected via CDP `Page.addScriptToEvaluateOnNewDocument` at document-start. The script must run in the **page's main world** (not an isolated world), because overriding `Math.random` and `Date` is only visible to page code if it happens in the same global. To defend against the page re-assigning these, the override uses `Object.defineProperty` with `configurable: false, writable: false`. The script body (embedded as a template):

```js
(() => {
  const SEED = __SEED__;
  const CLOCK_BASE = __CLOCK_BASE__;
  const CLOCK_MODE = "__CLOCK_MODE__"; // 'frozen' | 'offset'
  const ENTER_PERF = performance.now();

  let s = SEED >>> 0;
  const rand = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Object.defineProperty(Math, 'random', { value: rand, writable: false, configurable: false });

  const nowFrozen  = () => CLOCK_BASE;
  const nowOffset  = () => CLOCK_BASE + (performance.now() - ENTER_PERF);
  const now = CLOCK_MODE === 'frozen' ? nowFrozen : nowOffset;

  const OriginalDate = Date;
  function PatchedDate(...args) {
    if (!(this instanceof PatchedDate)) return new OriginalDate(now()).toString();
    if (args.length === 0) return new OriginalDate(now());
    return new OriginalDate(...args);
  }
  PatchedDate.now = now;
  PatchedDate.parse = OriginalDate.parse;
  PatchedDate.UTC = OriginalDate.UTC;
  PatchedDate.prototype = OriginalDate.prototype;
  Object.defineProperty(globalThis, 'Date', { value: PatchedDate });
})();
```

The kernel owns the string templating. Placeholders are substituted before `addScriptToEvaluateOnNewDocument` is called. This script survives every navigation within the tab until the registration is removed.

### Tab-close cleanup

The kernel subscribes to `BrowserService`'s existing tab-close event (or equivalent) once at construction. When a deterministic tab closes, the kernel silently removes its registry entry without running `revert` (the tab is gone). This prevents zombie state.

### Error semantics

- `enter` throws with a typed `KernelError` listing which pin failed and what was rolled back. The tab is guaranteed to be in a clean "no determinism" state on throw.
- `exit` is best-effort per pin: each `revert` is wrapped in try/catch; errors are collected and returned as a `KernelExitReport`. The registry entry is always removed at the end.
- If the tab has already closed, `exit` is a no-op.

## Integration with `browser.open_tab`

Minimal, additive. The existing `openTabDeterministic(input, service)` function gains one optional input field:

```ts
export type OpenTabInput = {
  url?: string;
  reuseExisting?: boolean;
  deterministic?: DeterminismConfig | true; // NEW
};
```

In the tool wrapper (`tools/browser/index.ts`), if `deterministic` is provided:

1. Open/reuse the tab (existing logic).
2. Call `kernel.enter(result.tabId, typeof deterministic === 'object' ? deterministic : {})`.
3. Postcondition expands: verify `kernel.isDeterministic(result.tabId) === true` before returning.
4. Response payload gains `deterministic: { config, pinsApplied }`.

If `deterministic` is omitted, behavior is unchanged. The kernel is **strictly opt-in**.

## File layout

```
src/main/browser/determinism/
  DeterministicKernel.ts             (the kernel itself, dep-injected capabilities)
  DeterministicKernel.test.ts        (unit tests with fake capabilities)
  kernelCapabilities.ts              (KernelCapabilities interface)
  pins/
    userAgentPin.ts
    viewportPin.ts
    localeTimezonePin.ts
    reduceMotionPin.ts
    disableAnimationsPin.ts
    seedAndClockPin.ts               (owns the preload script template)
    networkBlocklistPin.ts
  adapters/
    electronKernelCapabilities.ts    (wraps webContents + session + debugger)
```

`DeterministicKernel.ts` has no Electron imports. Every pin is a pure `{ apply, revert }` pair taking a `KernelCapabilities` handle. The Electron adapter is the only file that knows about `webContents`, `session`, or CDP.

## Test plan

### Unit tests (vitest, no Electron)

- Kernel happy path: `enter` applies all pins in order, `exit` reverts in reverse order.
- Idempotent `enter`: calling twice with same config is a no-op; calling with different config replaces.
- Partial failure rollback: if pin #4 throws, pins #1–3 are reverted, kernel throws, registry entry not created.
- Tab close: simulated tab-close event removes registry entry without calling reverts.
- `isDeterministic` / `getState`: correct values before, during, and after `enter`/`exit`.
- `exit` on unknown tab is a no-op.
- `exit` collects per-pin revert errors into `KernelExitReport`.

Each pin also has its own unit test against a fake `KernelCapabilities` that records calls — purely testing "does pin X call capability Y with args Z?".

### Integration test (vitest, no Electron)

- `openTabDeterministic` with `deterministic: true` calls the kernel exactly once with the new tabId.
- Postcondition failure if `isDeterministic` returns false after `enter` (simulated via a fake kernel).

### Manual verification (Electron, dev loop)

- `browser.open_tab { url: 'https://example.com/', deterministic: true }` then evaluate in the tab:
  - `Math.random()` twice → identical in both runs with the same seed
  - `new Date()` → returns the pinned clock
  - `navigator.userAgent` → matches configured UA
  - Animations visibly absent
  - A URL matching the blocklist returns `net::ERR_BLOCKED_BY_CLIENT`

## Implementation plan (ordered, small PRs)

1. `KernelCapabilities` interface + `electronKernelCapabilities` adapter skeleton (no pins yet; just CDP attach/detach, `insertCSS`, `webRequest` hooks, `setUserAgent`).
2. `DeterministicKernel` class with registry + `enter`/`exit`/`getState`/`isDeterministic` + rollback semantics. Tests with a fake `KernelCapabilities`.
3. Pins #1 (userAgent), #6 (disableAnimations), #8 (networkBlocklist) — the no-CDP pins. Unit-tested.
4. Pins #2 (viewport), #3 (locale), #4 (timezone), #5 (reduceMotion) — CDP-based pins. Unit-tested.
5. Pin #7 (seed + clock preload script). Unit-tested against a fake preload adapter; script body tested in isolation (pure JS unit test evaluating the rand/clock expressions).
6. `openTabDeterministic` gains `deterministic` input; wire it into the tool in `tools/browser/index.ts`. Integration test with fake kernel.
7. Manual smoke test in dev. Add a short section to `skills/browser-operation/SKILL.md` once validated.

Each step is shippable independently. Steps 3–5 can be done in parallel.

## Open questions

- **Default config**: should `deterministic: true` (with no config) pin every pin with default values, or only the cheap subset (UA, animations, viewport)? Current spec says all pins. Revisit if the defaults prove too aggressive in real use.
- **CDP attach reuse**: if the user already has `webContents.debugger` attached for other instrumentation, we must `isAttached()` first. The adapter handles this with a reference count.
- **Session-level `setUserAgent`**: setting UA on a shared session affects other tabs. The adapter must set it at the `webContents.setUserAgent` level (per-tab), not the session level, to avoid leakage. Confirmed feasible on current Electron.

## Future work (explicitly out of scope)

- Partition-scoped determinism (one partition per run, clean-room sessions) — Approach 2 from the brainstorm.
- L4 primitives (`observe / act / extract / wait`) that assume a deterministic tab.
- Migrating existing 33 browser tools to accept a `deterministic` flag that enters the kernel before acting.
- HAR replay via `Fetch.enable` + stub store.
- Cross-run action cache built on top of deterministic checkpoints.
