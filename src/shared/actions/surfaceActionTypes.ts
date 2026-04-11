// ═══════════════════════════════════════════════════════════════════════════
// Surface Action Type System — Typed contracts for orchestrated control
// ═══════════════════════════════════════════════════════════════════════════

import { SurfaceRole } from '../types/windowRoles';

// ─── Targets ──────────────────────────────────────────────────────────────

export type SurfaceTarget = SurfaceRole; // 'browser' | 'terminal'

// ─── Lifecycle ────────────────────────────────────────────────────────────

export type SurfaceActionStatus = 'queued' | 'running' | 'completed' | 'failed';

// ─── Action Kinds ─────────────────────────────────────────────────────────

export type BrowserActionKind =
  | 'browser.navigate'
  | 'browser.back'
  | 'browser.forward'
  | 'browser.reload'
  | 'browser.stop'
  | 'browser.create-tab'
  | 'browser.close-tab'
  | 'browser.activate-tab'
  | 'browser.click'
  | 'browser.type'
  | 'browser.dismiss-foreground-ui'
  | 'browser.return-to-primary-surface'
  | 'browser.click-ranked-action'
  | 'browser.wait-for-overlay-state'
  | 'browser.open-search-results-tabs';

export type TerminalActionKind =
  | 'terminal.execute'
  | 'terminal.write'
  | 'terminal.restart'
  | 'terminal.interrupt';

export type SurfaceActionKind = BrowserActionKind | TerminalActionKind;

// ─── Action Origin ────────────────────────────────────────────────────────

export type SurfaceActionOrigin = 'command-center' | 'system' | 'model';

// ─── Typed Payloads ───────────────────────────────────────────────────────

export type BrowserNavigatePayload = { url: string };
export type BrowserCreateTabPayload = { url?: string };
export type BrowserCloseTabPayload = { tabId: string };
export type BrowserActivateTabPayload = { tabId: string };
export type BrowserEmptyPayload = Record<string, never>;
export type BrowserClickPayload = { selector: string; tabId?: string };
export type BrowserTypePayload = { selector: string; text: string; tabId?: string };
export type BrowserSemanticTargetPayload = { tabId?: string };
export type BrowserClickRankedActionPayload = { tabId?: string; index?: number; actionId?: string; preferDismiss?: boolean };
export type BrowserWaitForOverlayPayload = { tabId?: string; state: 'open' | 'closed'; timeoutMs?: number };
export type BrowserOpenSearchResultsTabsPayload = { tabId?: string; indices?: number[]; limit?: number; activateFirst?: boolean };

export type TerminalExecutePayload = { command: string };
export type TerminalWritePayload = { input: string };
export type TerminalEmptyPayload = Record<string, never>;

export type SurfaceActionPayloadMap = {
  'browser.navigate': BrowserNavigatePayload;
  'browser.back': BrowserEmptyPayload;
  'browser.forward': BrowserEmptyPayload;
  'browser.reload': BrowserEmptyPayload;
  'browser.stop': BrowserEmptyPayload;
  'browser.create-tab': BrowserCreateTabPayload;
  'browser.close-tab': BrowserCloseTabPayload;
  'browser.activate-tab': BrowserActivateTabPayload;
  'browser.click': BrowserClickPayload;
  'browser.type': BrowserTypePayload;
  'browser.dismiss-foreground-ui': BrowserSemanticTargetPayload;
  'browser.return-to-primary-surface': BrowserSemanticTargetPayload;
  'browser.click-ranked-action': BrowserClickRankedActionPayload;
  'browser.wait-for-overlay-state': BrowserWaitForOverlayPayload;
  'browser.open-search-results-tabs': BrowserOpenSearchResultsTabsPayload;
  'terminal.execute': TerminalExecutePayload;
  'terminal.write': TerminalWritePayload;
  'terminal.restart': TerminalEmptyPayload;
  'terminal.interrupt': TerminalEmptyPayload;
};

// ─── Core Action Model ───────────────────────────────────────────────────

export type SurfaceAction<K extends SurfaceActionKind = SurfaceActionKind> = {
  id: string;
  target: SurfaceTarget;
  kind: K;
  status: SurfaceActionStatus;
  origin: SurfaceActionOrigin;
  payload: SurfaceActionPayloadMap[K];
  createdAt: number;
  updatedAt: number;
  taskId: string | null;
};

// ─── Action Record (for state/display — no raw output) ───────────────────

export type SurfaceActionRecord = {
  id: string;
  target: SurfaceTarget;
  kind: SurfaceActionKind;
  status: SurfaceActionStatus;
  origin: SurfaceActionOrigin;
  payloadSummary: string;
  resultSummary: string | null;
  resultData: Record<string, unknown> | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  taskId: string | null;
};

// ─── Action Input (renderer submits this) ─────────────────────────────────

export type SurfaceActionInput<K extends SurfaceActionKind = SurfaceActionKind> = {
  target: SurfaceTarget;
  kind: K;
  payload: SurfaceActionPayloadMap[K];
  taskId?: string | null;
  origin?: SurfaceActionOrigin;
};

// ─── Helpers ──────────────────────────────────────────────────────────────

export function targetForKind(kind: SurfaceActionKind): SurfaceTarget {
  return kind.startsWith('browser.') ? 'browser' : 'terminal';
}

export function summarizePayload(kind: SurfaceActionKind, payload: Record<string, unknown>): string {
  switch (kind) {
    case 'browser.navigate': return `Navigate to ${(payload as BrowserNavigatePayload).url}`;
    case 'browser.back': return 'Go back';
    case 'browser.forward': return 'Go forward';
    case 'browser.reload': return 'Reload page';
    case 'browser.stop': return 'Stop loading';
    case 'browser.create-tab': {
      const url = (payload as BrowserCreateTabPayload).url;
      return url ? `Open tab: ${url}` : 'Open new tab';
    }
    case 'browser.close-tab': return `Close tab ${(payload as BrowserCloseTabPayload).tabId}`;
    case 'browser.activate-tab': return `Switch to tab ${(payload as BrowserActivateTabPayload).tabId}`;
    case 'browser.click': return `Click: ${(payload as BrowserClickPayload).selector}`;
    case 'browser.type': return `Type in: ${(payload as BrowserTypePayload).selector}`;
    case 'browser.dismiss-foreground-ui': return 'Dismiss foreground UI';
    case 'browser.return-to-primary-surface': return 'Return to primary surface';
    case 'browser.click-ranked-action': {
      const p = payload as BrowserClickRankedActionPayload;
      if (p.actionId) return `Click ranked action ${p.actionId}`;
      if (typeof p.index === 'number') return `Click ranked action #${p.index}`;
      return 'Click top ranked action';
    }
    case 'browser.wait-for-overlay-state': {
      const p = payload as BrowserWaitForOverlayPayload;
      return `Wait for overlay ${p.state}`;
    }
    case 'browser.open-search-results-tabs': {
      const p = payload as BrowserOpenSearchResultsTabsPayload;
      if (Array.isArray(p.indices) && p.indices.length > 0) return `Open search results ${p.indices.join(', ')}`;
      if (typeof p.limit === 'number') return `Open top ${p.limit} search results`;
      return 'Open search results in tabs';
    }
    case 'terminal.execute': return `Execute: ${(payload as TerminalExecutePayload).command}`;
    case 'terminal.write': return `Write: ${(payload as TerminalWritePayload).input}`;
    case 'terminal.restart': return 'Restart terminal';
    case 'terminal.interrupt': return 'Send interrupt (Ctrl+C)';
    default: return kind;
  }
}

export const BROWSER_ACTION_KINDS: BrowserActionKind[] = [
  'browser.navigate', 'browser.back', 'browser.forward', 'browser.reload', 'browser.stop',
  'browser.create-tab', 'browser.close-tab', 'browser.activate-tab',
  'browser.click', 'browser.type',
  'browser.dismiss-foreground-ui', 'browser.return-to-primary-surface',
  'browser.click-ranked-action', 'browser.wait-for-overlay-state',
  'browser.open-search-results-tabs',
];

export const TERMINAL_ACTION_KINDS: TerminalActionKind[] = [
  'terminal.execute', 'terminal.write', 'terminal.restart', 'terminal.interrupt',
];

export const ALL_ACTION_KINDS: SurfaceActionKind[] = [
  ...BROWSER_ACTION_KINDS,
  ...TERMINAL_ACTION_KINDS,
];
