# Determinism E2E Harness

Replaces the two manual smoke tests documented in `MEMORY.md` with an automated
Electron-backed harness that exercises the `DeterministicKernel` + all 6 pins
against live Chromium.

## Running

```bash
npm run build:main
npm run test:e2e:determinism
```

On Linux CI (no display server):

```bash
E2E_DISPLAY=headless npm run test:e2e:determinism
```

This wraps the command in `xvfb-run`.

## What it checks

| Case | Pin(s) exercised | Assertion |
|---|---|---|
| A | `seedAndClock`, `userAgent` | Two full reloads of the same page produce an identical `Math.random` sequence, identical `Date.now()`, and the pinned `navigator.userAgent`. |
| B | `visual` (disableAnimations) **survives navigation** | Enter kernel on a non-animated page, then navigate to an animated page; animation-duration is still `0s` and the preload-injected style tag is present. Regression for the old `insertCSS`-only implementation. |
| C | `networkBlocklist` (CDP `Fetch.enable`) | A `fetch()` to `/tracker-resource*` fails inside a tab entered with that pattern, and the same URL succeeds in a control tab with no blocklist. |
| D | `networkBlocklist` is **per-tab** | Two concurrent tabs sharing a session, each with a different blocklist pattern, only block their own pattern. Regression for the old session-scoped `webRequest.onBeforeRequest` implementation. |

## Architecture

- `harness.js` — Electron main-process entry. Starts a localhost HTTP fixture
  server, instantiates a minimal tab registry (Electron `WebContentsView`
  children of a hidden `BrowserWindow`), wires the adapter + kernel + pins, and
  runs each case. Writes a JSON report to `GOLDENBOY_E2E_REPORT`.
- `run.js` — Node wrapper. Spawns Electron (optionally under `xvfb-run`),
  enforces a wall-clock timeout, parses the JSON report, prints a summary, and
  exits with the harness's result code.
- `fixtures/` — local HTML served by the harness. Kept minimal; no external
  network dependencies.

The adapter (`createElectronKernelCapabilities`) only reads
`getTabWebContents` and `getTabSession` from the browser-service-shaped
dependency, so the harness casts a small `TabRegistry` into that slot instead
of standing up the full `BrowserService`. That keeps the harness fast and
isolates kernel behaviour from unrelated browser machinery.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | All cases passed. |
| 1 | One or more cases failed (see console + report). |
| 2 | Harness failed to start / crashed / timed out. |

## Notes

- `reduceMotion: true` is implemented by `localeTimezonePin` via CDP
  `Emulation.setEmulatedMedia` (media feature flip). `visualPin` only reacts
  to `disableAnimations` (hard CSS override). Setting `reduceMotion` alone
  is intentionally a no-op in `visualPin`.
- `networkBlocklistPin` attaches per-tab via CDP `Fetch.enable`. The adapter
  installs a no-op `webRequest.onErrorOccurred` sentinel on each tab's
  session to work around [electron/electron#50678](https://github.com/electron/electron/issues/50678)
  (ERR_FAILED on main-frame navigation when CDP interception is active
  without any WebRequest listener).
