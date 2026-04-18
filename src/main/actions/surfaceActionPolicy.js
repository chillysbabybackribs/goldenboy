"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACTION_CONCURRENCY_POLICY = void 0;
exports.ACTION_CONCURRENCY_POLICY = {
    // Browser — navigation actions serialize, replace queued same-kind
    'browser.navigate': { mode: 'serialize', replacesSameKind: true },
    'browser.back': { mode: 'serialize', replacesSameKind: true },
    'browser.forward': { mode: 'serialize', replacesSameKind: true },
    'browser.reload': { mode: 'serialize', replacesSameKind: true },
    // Browser — stop bypasses and cancels everything queued
    'browser.stop': { mode: 'bypass', clearsQueue: true },
    // Browser — tab actions serialize through same queue, no replacement
    'browser.create-tab': { mode: 'serialize' },
    'browser.close-tab': { mode: 'serialize' },
    'browser.activate-tab': { mode: 'serialize' },
    'browser.split-tab': { mode: 'serialize', replacesSameKind: true },
    'browser.clear-split-view': { mode: 'serialize', replacesSameKind: true },
    'browser.click': { mode: 'serialize' },
    'browser.type': { mode: 'serialize' },
    'browser.dismiss-foreground-ui': { mode: 'serialize', replacesSameKind: true },
    'browser.return-to-primary-surface': { mode: 'serialize', replacesSameKind: true },
    'browser.click-ranked-action': { mode: 'serialize' },
    'browser.wait-for-overlay-state': { mode: 'serialize', replacesSameKind: true },
    'browser.open-search-results-tabs': { mode: 'serialize', replacesSameKind: true },
    // Terminal — execute serializes, replace queued same-kind
    'terminal.execute': { mode: 'serialize', replacesSameKind: true },
    // Terminal — write bypasses, requires a running action to receive input
    'terminal.write': { mode: 'bypass', requiresActiveAction: true },
    // Terminal — interrupt bypasses and cancels everything queued
    'terminal.interrupt': { mode: 'bypass', clearsQueue: true },
    // Terminal — restart bypasses and cancels everything queued
    'terminal.restart': { mode: 'bypass', clearsQueue: true },
};
//# sourceMappingURL=surfaceActionPolicy.js.map