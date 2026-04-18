"use strict";
// ═══════════════════════════════════════════════════════════════════════════
// Surface Action Type System — Typed contracts for orchestrated control
// ═══════════════════════════════════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_ACTION_KINDS = exports.TERMINAL_ACTION_KINDS = exports.BROWSER_ACTION_KINDS = void 0;
exports.targetForKind = targetForKind;
exports.summarizePayload = summarizePayload;
// ─── Helpers ──────────────────────────────────────────────────────────────
function targetForKind(kind) {
    return kind.startsWith('browser.') ? 'browser' : 'terminal';
}
function summarizePayload(kind, payload) {
    switch (kind) {
        case 'browser.navigate': return `Navigate to ${payload.url}`;
        case 'browser.back': return 'Go back';
        case 'browser.forward': return 'Go forward';
        case 'browser.reload': return 'Reload page';
        case 'browser.stop': return 'Stop loading';
        case 'browser.create-tab': {
            const url = payload.url;
            const insertAfterTabId = payload.insertAfterTabId;
            if (insertAfterTabId) {
                return url ? `Open tab: ${url} (after ${insertAfterTabId.slice(-8)})` : `Open new tab after ${insertAfterTabId.slice(-8)}`;
            }
            return url ? `Open tab: ${url}` : 'Open new tab';
        }
        case 'browser.close-tab': return `Close tab ${payload.tabId}`;
        case 'browser.activate-tab': return `Switch to tab ${payload.tabId}`;
        case 'browser.split-tab': {
            const tabId = payload.tabId;
            return tabId ? `Split tab ${tabId}` : 'Split active tab';
        }
        case 'browser.clear-split-view': return 'Clear split view';
        case 'browser.click': return `Click: ${payload.selector}`;
        case 'browser.type': return `Type in: ${payload.selector}`;
        case 'browser.dismiss-foreground-ui': return 'Dismiss foreground UI';
        case 'browser.return-to-primary-surface': return 'Return to primary surface';
        case 'browser.click-ranked-action': {
            const p = payload;
            if (p.actionId)
                return `Click ranked action ${p.actionId}`;
            if (typeof p.index === 'number')
                return `Click ranked action #${p.index}`;
            return 'Click top ranked action';
        }
        case 'browser.wait-for-overlay-state': {
            const p = payload;
            return `Wait for overlay ${p.state}`;
        }
        case 'browser.open-search-results-tabs': {
            const p = payload;
            if (Array.isArray(p.indices) && p.indices.length > 0)
                return `Open search results ${p.indices.join(', ')}`;
            if (typeof p.limit === 'number')
                return `Open top ${p.limit} search results`;
            return 'Open search results in tabs';
        }
        case 'terminal.execute': return `Execute: ${payload.command}`;
        case 'terminal.write': return `Write: ${payload.input}`;
        case 'terminal.restart': return 'Restart terminal';
        case 'terminal.interrupt': return 'Send interrupt (Ctrl+C)';
        default: return kind;
    }
}
exports.BROWSER_ACTION_KINDS = [
    'browser.navigate', 'browser.back', 'browser.forward', 'browser.reload', 'browser.stop',
    'browser.create-tab', 'browser.close-tab', 'browser.activate-tab',
    'browser.split-tab', 'browser.clear-split-view',
    'browser.click', 'browser.type',
    'browser.dismiss-foreground-ui', 'browser.return-to-primary-surface',
    'browser.click-ranked-action', 'browser.wait-for-overlay-state',
    'browser.open-search-results-tabs',
];
exports.TERMINAL_ACTION_KINDS = [
    'terminal.execute', 'terminal.write', 'terminal.restart', 'terminal.interrupt',
];
exports.ALL_ACTION_KINDS = [
    ...exports.BROWSER_ACTION_KINDS,
    ...exports.TERMINAL_ACTION_KINDS,
];
//# sourceMappingURL=surfaceActionTypes.js.map