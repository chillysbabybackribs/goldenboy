/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Deterministic Kernel E2E harness (Electron main-process entry).
 *
 * Runs against a real hidden BrowserWindow + WebContentsView surface, exercises
 * the DeterministicKernel + pins + adapter against live Chromium, and writes a
 * JSON report to the path given by `GOLDENBOY_E2E_REPORT`.
 *
 * Prerequisite: `npm run build:main` (we require compiled output from dist/main).
 *
 * This harness deliberately does NOT boot the real BrowserService — the adapter
 * only needs getTabWebContents / getTabSession, so we build a minimal tab
 * registry and cast it into the adapter. That keeps the harness fast and
 * isolates kernel behaviour from the rest of the app.
 *
 * Cases:
 *   A. seedAndClock + userAgent — identical Math.random sequence across reloads,
 *      frozen Date, exact navigator.userAgent.
 *   B. visual (disableAnimations) survives navigation — enter kernel on a blank
 *      page, then navigate to an animated page, and confirm animation-duration
 *      is still 0s. Regression for the old `insertCSS`-only implementation that
 *      was dropped on the first post-enter navigation.
 *   C. networkBlocklist — fetch to blocked pattern fails; fetch to unblocked
 *      pattern succeeds (two sequential tabs, same URL, proves the block is
 *      active only when the kernel's blocklist includes it).
 *   D. networkBlocklist is per-tab — two concurrent tabs sharing a session
 *      with divergent blocklists each see only their own patterns blocked.
 *      Regression for the old session-scoped `webRequest` implementation.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { app, BrowserWindow, WebContentsView, session } = require('electron');

const DIST_ROOT = path.resolve(__dirname, '..', '..', '..', 'dist', 'main', 'main');
const REPORT_PATH = process.env.GOLDENBOY_E2E_REPORT;
const VERBOSE = process.env.GOLDENBOY_E2E_VERBOSE === '1';

function log(...args) { if (VERBOSE) console.error('[harness]', ...args); }

if (!REPORT_PATH) {
  console.error('[harness] GOLDENBOY_E2E_REPORT not set');
  process.exit(2);
}

function requireFromDist(relPath) {
  const full = path.join(DIST_ROOT, relPath);
  if (!fs.existsSync(full)) {
    throw new Error(
      `Compiled file not found: ${full}\n` +
      'Did you run `npm run build:main` before the harness?',
    );
  }
  return require(full);
}

const { DeterministicKernel } = requireFromDist('browser/determinism/DeterministicKernel.js');
const { createElectronKernelCapabilities } = requireFromDist(
  'browser/determinism/adapters/electronKernelCapabilities.js',
);
const { userAgentPin } = requireFromDist('browser/determinism/pins/userAgentPin.js');
const { visualPin } = requireFromDist('browser/determinism/pins/visualPin.js');
const { viewportPin } = requireFromDist('browser/determinism/pins/viewportPin.js');
const { localeTimezonePin } = requireFromDist('browser/determinism/pins/localeTimezonePin.js');
const { seedAndClockPin } = requireFromDist('browser/determinism/pins/seedAndClockPin.js');
const { networkBlocklistPin } = requireFromDist('browser/determinism/pins/networkBlocklistPin.js');

// ─── Fixture server ─────────────────────────────────────────────────────────

const FIXTURE_DIR = path.join(__dirname, 'fixtures');

function startFixtureServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        if (url.pathname === '/tracker-resource') {
          res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
          res.end('ok');
          return;
        }
        const safe = path.normalize(url.pathname).replace(/^[/\\]+/, '');
        const file = path.join(FIXTURE_DIR, safe);
        if (!file.startsWith(FIXTURE_DIR) || !fs.existsSync(file)) {
          res.writeHead(404); res.end('not found'); return;
        }
        const ext = path.extname(file);
        const ct = ext === '.html' ? 'text/html; charset=utf-8' : 'application/octet-stream';
        res.writeHead(200, { 'content-type': ct, 'cache-control': 'no-store' });
        fs.createReadStream(file).pipe(res);
      } catch (err) {
        res.writeHead(500); res.end(String(err));
      }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
  });
}

// ─── Minimal tab registry ───────────────────────────────────────────────────

class TabRegistry {
  constructor(hostWindow, partition) {
    this.hostWindow = hostWindow;
    this.partition = partition;
    this.tabs = new Map();
    this.seq = 0;
  }

  async createTab(warmupUrl) {
    const id = `tab_${++this.seq}`;
    const view = new WebContentsView({
      webPreferences: {
        session: session.fromPartition(this.partition),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    view.setBackgroundColor('#ffffff');
    this.hostWindow.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 800, height: 600 });
    this.tabs.set(id, view);
    // Warm up the renderer (spawn the renderer process + run `dom-ready` so
    // `webContents.insertCSS` and `debugger.attach` do not hang when the
    // kernel enters). about:blank is too lightweight — some CDP/insertCSS
    // commands deadlock against it — so callers pass a real HTML URL.
    const target = warmupUrl || 'about:blank';
    await new Promise((resolve, reject) => {
      const wc = view.webContents;
      const onReady = () => { wc.removeListener('dom-ready', onReady); resolve(); };
      wc.once('dom-ready', onReady);
      wc.loadURL(target).catch(reject);
    });
    return id;
  }

  destroy(tabId) {
    const view = this.tabs.get(tabId);
    if (!view) return;
    try { this.hostWindow.contentView.removeChildView(view); } catch { /* ignore */ }
    try { view.webContents.close(); } catch { /* ignore */ }
    this.tabs.delete(tabId);
  }

  destroyAll() {
    for (const id of [...this.tabs.keys()]) this.destroy(id);
  }

  getTabWebContents(tabId) {
    const view = this.tabs.get(tabId);
    return view ? view.webContents : null;
  }

  getTabSession(tabId) {
    const view = this.tabs.get(tabId);
    return view ? view.webContents.session : null;
  }
}

// ─── Assertion helpers ──────────────────────────────────────────────────────

function assertEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  expected: ${e}\n  actual:   ${a}`);
}

function assertTrue(cond, message) {
  if (!cond) throw new Error(message);
}

function waitForLoad(webContents, url) {
  return new Promise((resolve, reject) => {
    const onFail = (_e, errorCode, errorDescription, validatedURL) => {
      if (validatedURL === url || !validatedURL) {
        webContents.removeListener('did-fail-load', onFail);
        webContents.removeListener('did-finish-load', onDone);
        reject(new Error(`did-fail-load: ${errorCode} ${errorDescription}`));
      }
    };
    const onDone = () => {
      webContents.removeListener('did-fail-load', onFail);
      webContents.removeListener('did-finish-load', onDone);
      resolve();
    };
    webContents.on('did-fail-load', onFail);
    webContents.on('did-finish-load', onDone);
    webContents.loadURL(url).catch(reject);
  });
}

async function evalInPage(webContents, expr) {
  try {
    return await webContents.executeJavaScript(expr, true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log('evalInPage error', msg);
    throw err;
  }
}

// ─── Cases ──────────────────────────────────────────────────────────────────

async function runCaseA(registry, kernel, baseUrl) {
  log('A: creating tab');
  const tabId = await registry.createTab(`${baseUrl}/basic.html`);
  const wc = registry.getTabWebContents(tabId);
  log('A: tab created, entering kernel');
  await kernel.enter(tabId, {
    seed: 42,
    clock: 'frozen',
    userAgent: 'goldenboy-determinism/1.0',
  });
  log('A: kernel entered');

  async function observe(label) {
    log(`A: ${label} loadURL`);
    await waitForLoad(wc, `${baseUrl}/basic.html`);
    log(`A: ${label} loaded, evaluating`);
    const raw = await evalInPage(wc, `
      JSON.stringify({
        r1: Math.random(),
        r2: Math.random(),
        r3: Math.random(),
        dnow: Date.now(),
        diso: new Date().toISOString(),
        ua: navigator.userAgent
      })
    `);
    log(`A: ${label} evaluated`);
    return raw;
  }

  const run1 = JSON.parse(await observe('run1'));
  const run2 = JSON.parse(await observe('run2'));

  assertEqual(run1, run2, 'seeded Math.random / frozen Date / UA should be identical across reloads');
  assertTrue(run1.r1 !== run1.r2 && run1.r2 !== run1.r3, 'Math.random should produce distinct values within a run');
  assertEqual(run1.ua, 'goldenboy-determinism/1.0', 'navigator.userAgent should match pinned UA');
  assertTrue(Number.isFinite(run1.dnow), 'Date.now() should be a finite number');
  assertEqual(run1.dnow, run2.dnow, 'Date.now() should be identical across reloads (frozen)');

  await kernel.exit(tabId);
  registry.destroy(tabId);
  return {
    name: 'A. seedAndClock + userAgent',
    run1,
    run2,
  };
}

async function runCaseB(registry, kernel, baseUrl) {
  // Regression test for the old `insertCSS`-only visual pin:
  //   1. Warm up on a non-animated page (basic.html).
  //   2. Enter kernel with disableAnimations: true. The old implementation
  //      would call webContents.insertCSS on basic.html.
  //   3. Navigate to anim.html. The insertCSS-injected style was document-
  //      scoped, so the navigation would drop it and the animation would
  //      still be at its original 2s duration.
  //   4. Assert animation-duration is '0s' — proves the new preload-script
  //      path (Page.addScriptToEvaluateOnNewDocument) survives navigation.
  const tabId = await registry.createTab(`${baseUrl}/basic.html`);
  const wc = registry.getTabWebContents(tabId);
  await kernel.enter(tabId, { disableAnimations: true });

  // Post-enter navigation — previously the failing path for visualPin.
  await waitForLoad(wc, `${baseUrl}/anim.html`);

  const computed = JSON.parse(await evalInPage(wc, `
    (() => {
      const el = document.getElementById('el');
      if (!el) return JSON.stringify({ error: 'element-missing', url: location.href, title: document.title });
      const cs = getComputedStyle(el);
      return JSON.stringify({
        animationDuration: cs.animationDuration,
        animationDelay: cs.animationDelay,
        transitionDuration: cs.transitionDuration,
        styleTagPresent: !!document.getElementById('__goldenboy_determinism_visual__'),
      });
    })()
  `));

  assertTrue(computed.styleTagPresent, 'preload-injected style tag should be present after navigation');
  assertEqual(computed.animationDuration, '0s', 'animation-duration should be 0s under disableAnimations (post-nav)');
  assertEqual(computed.transitionDuration, '0s', 'transition-duration should be 0s under disableAnimations (post-nav)');

  await kernel.exit(tabId);
  registry.destroy(tabId);
  return { name: 'B. visual survives navigation', computed };
}

async function runCaseC(registry, kernel, baseUrl) {
  // Blocked tab
  const blockedTabId = await registry.createTab(`${baseUrl}/basic.html`);
  const blockedWc = registry.getTabWebContents(blockedTabId);
  await kernel.enter(blockedTabId, {
    blockNetworkPatterns: [`${baseUrl}/tracker-resource*`],
  });
  const blockedUrl = `${baseUrl}/tracker.html?tracker=${encodeURIComponent(`${baseUrl}/tracker-resource?run=blocked`)}`;
  await waitForLoad(blockedWc, blockedUrl);
  await evalInPage(blockedWc, `new Promise(r => {
    const chk = () => window.__trackerProbe && window.__trackerProbe.done ? r(true) : setTimeout(chk, 25);
    chk();
  })`);
  const blockedProbe = JSON.parse(await evalInPage(blockedWc, 'JSON.stringify(window.__trackerProbe)'));

  assertTrue(
    blockedProbe.done === true && (blockedProbe.error || blockedProbe.ok === false),
    `blocked fetch should fail or be non-ok, got: ${JSON.stringify(blockedProbe)}`,
  );
  await kernel.exit(blockedTabId);
  registry.destroy(blockedTabId);

  // Control tab — same URL pattern, no blocklist.
  const controlTabId = await registry.createTab(`${baseUrl}/basic.html`);
  const controlWc = registry.getTabWebContents(controlTabId);
  await kernel.enter(controlTabId, {});
  const controlUrl = `${baseUrl}/tracker.html?tracker=${encodeURIComponent(`${baseUrl}/tracker-resource?run=control`)}`;
  await waitForLoad(controlWc, controlUrl);
  await evalInPage(controlWc, `new Promise(r => {
    const chk = () => window.__trackerProbe && window.__trackerProbe.done ? r(true) : setTimeout(chk, 25);
    chk();
  })`);
  const controlProbe = JSON.parse(await evalInPage(controlWc, 'JSON.stringify(window.__trackerProbe)'));

  assertTrue(
    controlProbe.done === true && controlProbe.ok === true && controlProbe.status === 200,
    `control fetch should succeed, got: ${JSON.stringify(controlProbe)}`,
  );
  await kernel.exit(controlTabId);
  registry.destroy(controlTabId);

  return { name: 'C. networkBlocklist', blockedProbe, controlProbe };
}

async function runCaseD(registry, kernel, baseUrl) {
  // Regression for the old session-scoped blocklist: two tabs sharing a
  // session, each with a DIFFERENT blocklist pattern. Each tab must only
  // block its own pattern — the union-leak is what `Fetch.enable` fixes.
  const tabX = await registry.createTab(`${baseUrl}/basic.html`);
  const tabY = await registry.createTab(`${baseUrl}/basic.html`);
  const wcX = registry.getTabWebContents(tabX);
  const wcY = registry.getTabWebContents(tabY);

  await kernel.enter(tabX, { blockNetworkPatterns: [`${baseUrl}/tracker-resource?role=x*`] });
  await kernel.enter(tabY, { blockNetworkPatterns: [`${baseUrl}/tracker-resource?role=y*`] });

  async function probe(wc, role) {
    const url = `${baseUrl}/tracker.html?tracker=${encodeURIComponent(`${baseUrl}/tracker-resource?role=${role}`)}`;
    await waitForLoad(wc, url);
    await evalInPage(wc, `new Promise(r => {
      const chk = () => window.__trackerProbe && window.__trackerProbe.done ? r(true) : setTimeout(chk, 25);
      chk();
    })`);
    return JSON.parse(await evalInPage(wc, 'JSON.stringify(window.__trackerProbe)'));
  }

  // Tab X blocks role=x; fetching role=y from tab X must succeed.
  const xFetchesX = await probe(wcX, 'x');
  const xFetchesY = await probe(wcX, 'y');
  // Tab Y blocks role=y; fetching role=x from tab Y must succeed.
  const yFetchesY = await probe(wcY, 'y');
  const yFetchesX = await probe(wcY, 'x');

  assertTrue(
    xFetchesX.done && (xFetchesX.error || xFetchesX.ok === false),
    `X fetching role=x should be blocked by X's blocklist, got: ${JSON.stringify(xFetchesX)}`,
  );
  assertTrue(
    xFetchesY.done && xFetchesY.ok === true,
    `X fetching role=y should succeed (X does not block y), got: ${JSON.stringify(xFetchesY)}`,
  );
  assertTrue(
    yFetchesY.done && (yFetchesY.error || yFetchesY.ok === false),
    `Y fetching role=y should be blocked by Y's blocklist, got: ${JSON.stringify(yFetchesY)}`,
  );
  assertTrue(
    yFetchesX.done && yFetchesX.ok === true,
    `Y fetching role=x should succeed (Y does not block x), got: ${JSON.stringify(yFetchesX)}`,
  );

  await kernel.exit(tabX);
  await kernel.exit(tabY);
  registry.destroy(tabX);
  registry.destroy(tabY);

  return {
    name: 'D. networkBlocklist is per-tab',
    xFetchesX, xFetchesY, yFetchesY, yFetchesX,
  };
}

// ─── Orchestration ──────────────────────────────────────────────────────────

async function main() {
  log('starting fixture server');
  const { server, port } = await startFixtureServer();
  const baseUrl = `http://127.0.0.1:${port}`;
  log('fixture server listening on', baseUrl);

  log('creating hidden BrowserWindow');
  const hostWindow = new BrowserWindow({
    show: false,
    width: 900,
    height: 700,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  log('BrowserWindow created');

  const partition = `goldenboy-e2e-${Date.now()}`;
  const registry = new TabRegistry(hostWindow, partition);

  const rawCaps = createElectronKernelCapabilities({ browserService: registry });
  const caps = new Proxy(rawCaps, {
    get(target, prop) {
      const original = target[prop];
      if (typeof original !== 'function') return original;
      return async function wrapped(...args) {
        log(`cap.${String(prop)} start`, args[0]);
        try {
          const out = await original.apply(target, args);
          log(`cap.${String(prop)} ok`);
          if (prop === 'attachCdp' && out && typeof out.send === 'function') {
            const wrappedHandle = {
              ...out,
              send: async (method, params) => {
                log(`  cdp.send ${method} start`);
                const r = await out.send(method, params);
                log(`  cdp.send ${method} ok`);
                return r;
              },
            };
            return wrappedHandle;
          }
          return out;
        } catch (err) {
          log(`cap.${String(prop)} ERR`, err && err.message);
          throw err;
        }
      };
    },
  });

  const kernel = new DeterministicKernel({
    capabilities: caps,
    pins: [userAgentPin, visualPin, viewportPin, localeTimezonePin, seedAndClockPin, networkBlocklistPin],
  });

  const report = {
    ok: false,
    cases: [],
    failures: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
    baseUrl,
  };

  const cases = [
    ['A', () => runCaseA(registry, kernel, baseUrl)],
    ['B', () => runCaseB(registry, kernel, baseUrl)],
    ['C', () => runCaseC(registry, kernel, baseUrl)],
    ['D', () => runCaseD(registry, kernel, baseUrl)],
  ];

  for (const [label, fn] of cases) {
    const startedAt = Date.now();
    log(`→ case ${label} starting`);
    try {
      const detail = await fn();
      const durationMs = Date.now() - startedAt;
      log(`✓ case ${label} pass (${durationMs}ms)`);
      report.cases.push({ label, status: 'pass', durationMs, detail });
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const message = err instanceof Error ? err.stack || err.message : String(err);
      log(`✗ case ${label} fail (${durationMs}ms):`, message.split('\n')[0]);
      report.cases.push({ label, status: 'fail', durationMs, error: message });
      report.failures.push({ label, message });
    }
  }

  report.ok = report.failures.length === 0;
  report.finishedAt = new Date().toISOString();

  try { registry.destroyAll(); } catch { /* ignore */ }
  try { hostWindow.destroy(); } catch { /* ignore */ }
  await new Promise((r) => server.close(() => r()));

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  app.exit(report.ok ? 0 : 1);
}

app.whenReady().then(() => {
  main().catch((err) => {
    try {
      const report = {
        ok: false,
        cases: [],
        failures: [{ label: 'harness', message: err instanceof Error ? err.stack || err.message : String(err) }],
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      };
      fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    } catch { /* ignore */ }
    app.exit(2);
  });
});

app.on('window-all-closed', () => { /* no-op; we manage exit via app.exit */ });
