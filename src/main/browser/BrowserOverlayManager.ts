// ═══════════════════════════════════════════════════════════════════════════
// BrowserOverlayManager — Foreground UI dismiss, overlay wait, ranked
// click, and primary surface restoration
// ═══════════════════════════════════════════════════════════════════════════

import type { WebContentsView } from 'electron';
import type {
  BrowserActionableElement,
  BrowserSnapshot,
} from '../../shared/types/browserIntelligence';
import type { TabInfo } from '../../shared/types/browser';

type TabEntry = {
  id: string;
  view: WebContentsView;
  info: TabInfo;
};

type ResolveEntry = (tabId?: string) => TabEntry | undefined;

type Deps = {
  resolveEntry: ResolveEntry;
  captureTabSnapshot: (tabId?: string) => Promise<BrowserSnapshot>;
  executeInPage: (expression: string, tabId?: string) => Promise<{ result: unknown; error: string | null }>;
  clickElement: (selector: string, tabId?: string) => Promise<{ clicked: boolean; error: string | null }>;
  rankActionableElements: (
    snapshot: BrowserSnapshot,
    options?: { preferDismiss?: boolean },
  ) => Array<BrowserActionableElement & { rankScore: number; rankReason: string }>;
};

export class BrowserOverlayManager {
  private deps: Deps;

  constructor(deps: Deps) {
    this.deps = deps;
  }

  // ─── Click Ranked Action ────────────────────────────────────────────────

  async clickRankedAction(input: {
    tabId?: string;
    index?: number;
    actionId?: string;
    preferDismiss?: boolean;
  }): Promise<{
    success: boolean;
    clickedAction: (BrowserActionableElement & { rankScore?: number; rankReason?: string }) | null;
    error: string | null;
  }> {
    const entry = this.deps.resolveEntry(input.tabId);
    if (!entry) return { success: false, clickedAction: null, error: 'No active tab' };

    const snapshot = await this.deps.captureTabSnapshot(entry.id);
    const ranked = this.deps.rankActionableElements(snapshot, { preferDismiss: input.preferDismiss });
    const selected = input.actionId
      ? ranked.find(item => item.id === input.actionId) || null
      : ranked[Math.max(0, input.index ?? 0)] || null;

    if (!selected) return { success: false, clickedAction: null, error: 'No ranked action available' };

    const result = await this.deps.clickElement(selected.ref.selector, entry.id);
    return {
      success: result.clicked,
      clickedAction: selected,
      error: result.error,
    };
  }

  // ─── Wait For Overlay State ─────────────────────────────────────────────

  async waitForOverlayState(
    state: 'open' | 'closed',
    timeoutMs: number = 3000,
    tabId?: string,
  ): Promise<{
    success: boolean;
    state: 'open' | 'closed';
    observed: boolean;
    foregroundUiType: BrowserSnapshot['viewport']['foregroundUiType'];
    foregroundUiLabel: string;
    error: string | null;
  }> {
    const entry = this.deps.resolveEntry(tabId);
    if (!entry) {
      return {
        success: false,
        state,
        observed: false,
        foregroundUiType: 'none',
        foregroundUiLabel: '',
        error: 'No active tab',
      };
    }

    const start = Date.now();
    while (Date.now() - start <= timeoutMs) {
      const snapshot = await this.deps.captureTabSnapshot(entry.id);
      const observed = snapshot.viewport.modalPresent;
      if ((state === 'open' && observed) || (state === 'closed' && !observed)) {
        return {
          success: true,
          state,
          observed,
          foregroundUiType: snapshot.viewport.foregroundUiType,
          foregroundUiLabel: snapshot.viewport.foregroundUiLabel,
          error: null,
        };
      }
      await new Promise(resolve => setTimeout(resolve, 120));
    }

    const snapshot = await this.deps.captureTabSnapshot(entry.id);
    return {
      success: false,
      state,
      observed: snapshot.viewport.modalPresent,
      foregroundUiType: snapshot.viewport.foregroundUiType,
      foregroundUiLabel: snapshot.viewport.foregroundUiLabel,
      error: `Overlay did not become ${state} within ${timeoutMs}ms`,
    };
  }

  // ─── Dismiss Foreground UI ──────────────────────────────────────────────

  async dismissForegroundUI(tabId?: string): Promise<{
    success: boolean;
    method: string | null;
    target: string | null;
    targetSelector: string | null;
    beforeModalPresent: boolean;
    afterModalPresent: boolean;
    beforeForegroundUiType: BrowserSnapshot['viewport']['foregroundUiType'];
    beforeForegroundUiLabel: string;
    afterForegroundUiType: BrowserSnapshot['viewport']['foregroundUiType'];
    afterForegroundUiLabel: string;
    error: string | null;
  }> {
    const entry = this.deps.resolveEntry(tabId);
    if (!entry) {
      return {
        success: false,
        method: null,
        target: null,
        targetSelector: null,
        beforeModalPresent: false,
        afterModalPresent: false,
        beforeForegroundUiType: 'none',
        beforeForegroundUiLabel: '',
        afterForegroundUiType: 'none',
        afterForegroundUiLabel: '',
        error: 'No active tab',
      };
    }

    const before = await this.deps.captureTabSnapshot(entry.id);
    if (before.viewport.foregroundUiType === 'none' || before.viewport.foregroundUiConfidence < 0.7) {
      return {
        success: false,
        method: null,
        target: null,
        targetSelector: null,
        beforeModalPresent: before.viewport.modalPresent,
        afterModalPresent: before.viewport.modalPresent,
        beforeForegroundUiType: before.viewport.foregroundUiType,
        beforeForegroundUiLabel: before.viewport.foregroundUiLabel,
        afterForegroundUiType: before.viewport.foregroundUiType,
        afterForegroundUiLabel: before.viewport.foregroundUiLabel,
        error: 'No safe foreground UI target identified',
      };
    }
    const { result, error } = await this.deps.executeInPage(`
      (() => {
        const foregroundSelector = ${JSON.stringify(before.viewport.foregroundUiSelector)};
        const foregroundLabel = ${JSON.stringify(before.viewport.foregroundUiLabel)};
        const isVisible = (el) => {
          if (!(el instanceof HTMLElement)) return false;
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const cssPath = (el) => {
          if (!(el instanceof Element)) return '';
          const parts = [];
          let node = el;
          while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
            let selector = node.tagName.toLowerCase();
            if (node.id) {
              selector += '#' + CSS.escape(node.id);
              parts.unshift(selector);
              break;
            }
            const className = typeof node.className === 'string'
              ? node.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2).map(c => '.' + CSS.escape(c)).join('')
              : '';
            selector += className;
            const parent = node.parentElement;
            if (parent) {
              const siblings = Array.from(parent.children).filter(child => child.tagName === node.tagName);
              if (siblings.length > 1) {
                selector += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
              }
            }
            parts.unshift(selector);
            node = parent;
          }
          return parts.join(' > ');
        };
        const candidates = Array.from(document.querySelectorAll('button, [role="button"], [tabindex]'))
          .filter(isVisible);
        const labelFor = (el) => ((el.innerText || el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '')).trim();
        const dismissRe = /\\b(close|dismiss|cancel|done|got it|not now|skip|back|hide|x)\\b/i;
        const overlayToggleRe = /\\b(notification|notifications|activity|inbox|messages|menu)\\b/i;
        const foregroundRoot = foregroundSelector ? document.querySelector(foregroundSelector) : null;
        const insideForeground = (el) => !!(foregroundRoot && el instanceof Element && foregroundRoot.contains(el));
        const foregroundId = foregroundRoot instanceof Element ? foregroundRoot.id : '';
        const normalizedForegroundLabel = (foregroundLabel || '').toLowerCase();
        const isSafeControl = (el) => {
          if (!(el instanceof HTMLElement)) return false;
          if (el instanceof HTMLAnchorElement && el.hasAttribute('href')) return false;
          if (el.getAttribute('role') === 'link') return false;
          return true;
        };

        const foregroundCandidates = candidates.filter(el => insideForeground(el) && isSafeControl(el));
        const backgroundCandidates = candidates.filter(el => !insideForeground(el) && isSafeControl(el));
        const triggerCandidate = backgroundCandidates.find((el) => {
          const controls = el.getAttribute('aria-controls') || el.getAttribute('aria-owns') || '';
          const label = labelFor(el).toLowerCase();
          if (el.getAttribute('aria-expanded') !== 'true') return false;
          if (foregroundId && controls === foregroundId) return true;
          if (normalizedForegroundLabel && label && normalizedForegroundLabel.includes(label)) return true;
          return overlayToggleRe.test(label);
        });

        if (triggerCandidate) {
          triggerCandidate.click();
          return {
            method: 'click-foreground-trigger',
            target: labelFor(triggerCandidate) || triggerCandidate.tagName.toLowerCase(),
            selector: cssPath(triggerCandidate),
          };
        }

        const dismissCandidate = foregroundCandidates.find(el => dismissRe.test(labelFor(el)))
          || backgroundCandidates.find(el => dismissRe.test(labelFor(el)));
        if (dismissCandidate) {
          dismissCandidate.click();
          return {
            method: 'click-dismiss-candidate',
            target: labelFor(dismissCandidate) || dismissCandidate.tagName.toLowerCase(),
            selector: cssPath(dismissCandidate),
          };
        }

        const expandedToggle = backgroundCandidates.find(el => el.getAttribute('aria-expanded') === 'true')
          || backgroundCandidates.find(el => overlayToggleRe.test(labelFor(el)))
          || foregroundCandidates.find(el => el.getAttribute('aria-expanded') === 'true');
        if (expandedToggle) {
          expandedToggle.click();
          return {
            method: 'click-overlay-toggle',
            target: labelFor(expandedToggle) || expandedToggle.tagName.toLowerCase(),
            selector: cssPath(expandedToggle),
          };
        }

        return { method: 'no-safe-dismiss-target', target: foregroundLabel || 'unknown', selector: foregroundSelector || '' };
      })()
    `, entry.id);

    if (error) {
      return {
        success: false,
        method: null,
        target: null,
        targetSelector: null,
        beforeModalPresent: before.viewport.modalPresent,
        afterModalPresent: before.viewport.modalPresent,
        beforeForegroundUiType: before.viewport.foregroundUiType,
        beforeForegroundUiLabel: before.viewport.foregroundUiLabel,
        afterForegroundUiType: before.viewport.foregroundUiType,
        afterForegroundUiLabel: before.viewport.foregroundUiLabel,
        error,
      };
    }

    await new Promise(resolve => setTimeout(resolve, 180));
    const after = await this.deps.captureTabSnapshot(entry.id);
    const action = (result as { method?: string; target?: string; selector?: string } | null) || null;
    const exactForegroundCleared = before.viewport.foregroundUiSelector
      ? before.viewport.foregroundUiSelector !== after.viewport.foregroundUiSelector
      : before.viewport.modalPresent !== after.viewport.modalPresent;
    const actionSucceeded = action?.method !== 'no-safe-dismiss-target';
    return {
      success: actionSucceeded && (exactForegroundCleared || !after.viewport.modalPresent),
      method: action?.method || null,
      target: action?.target || null,
      targetSelector: action?.selector || null,
      beforeModalPresent: before.viewport.modalPresent,
      afterModalPresent: after.viewport.modalPresent,
      beforeForegroundUiType: before.viewport.foregroundUiType,
      beforeForegroundUiLabel: before.viewport.foregroundUiLabel,
      afterForegroundUiType: after.viewport.foregroundUiType,
      afterForegroundUiLabel: after.viewport.foregroundUiLabel,
      error: actionSucceeded ? null : 'No safe dismiss control available',
    };
  }

  // ─── Return To Primary Surface ──────────────────────────────────────────

  async returnToPrimarySurface(tabId?: string): Promise<{
    success: boolean;
    restored: boolean;
    steps: string[];
    error: string | null;
  }> {
    const entry = this.deps.resolveEntry(tabId);
    if (!entry) return { success: false, restored: false, steps: [], error: 'No active tab' };

    const steps: string[] = [];
    const before = await this.deps.captureTabSnapshot(entry.id);
    if (!before.viewport.modalPresent && before.viewport.isPrimarySurface) {
      return { success: true, restored: true, steps: ['primary-surface-already-clear'], error: null };
    }

    let dismissed = {
      success: false,
      method: null as string | null,
      error: null as string | null,
    };
    let closed = {
      success: false,
      error: null as string | null,
    };

    if (before.viewport.modalPresent) {
      const dismissResult = await this.dismissForegroundUI(entry.id);
      dismissed = {
        success: dismissResult.success,
        method: dismissResult.method,
        error: dismissResult.error,
      };
      steps.push(dismissResult.method || 'dismiss-attempt');
      const closeResult = await this.waitForOverlayState('closed', 2500, entry.id);
      closed = {
        success: closeResult.success,
        error: closeResult.error,
      };
    } else if (!before.viewport.isPrimarySurface) {
      const { result, error } = await this.deps.executeInPage(`
        (() => {
          const isVisible = (el) => {
            if (!(el instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          };
          const labelFor = (el) => ((el.innerText || el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '')).replace(/\\s+/g, ' ').trim();
          const safeControls = Array.from(document.querySelectorAll('button, [role="button"], [tabindex]'))
            .filter(el => el instanceof HTMLElement && isVisible(el));
          const primaryTrigger = safeControls.find((el) => /\\b(for you|home|back to feed|close|activity|notifications|inbox)\\b/i.test(labelFor(el)));
          if (primaryTrigger) {
            primaryTrigger.click();
            return { method: 'click-primary-surface-control', target: labelFor(primaryTrigger) || primaryTrigger.tagName.toLowerCase() };
          }
          return { method: 'no-primary-surface-control', target: '' };
        })()
      `, entry.id);
      const action = (result as { method?: string; target?: string } | null) || null;
      steps.push(action?.method || 'primary-surface-attempt');
      dismissed = {
        success: action?.method === 'click-primary-surface-control',
        method: action?.method || null,
        error: error || (action?.method === 'no-primary-surface-control' ? 'No safe primary-surface control available' : null),
      };
    }

    const after = await this.deps.captureTabSnapshot(entry.id);
    const exactForegroundCleared = before.viewport.foregroundUiSelector
      ? before.viewport.foregroundUiSelector !== after.viewport.foregroundUiSelector
      : before.viewport.modalPresent !== after.viewport.modalPresent;
    const activeSurfaceChanged = before.viewport.activeSurfaceSelector
      ? before.viewport.activeSurfaceSelector !== after.viewport.activeSurfaceSelector
      : before.viewport.activeSurfaceType !== after.viewport.activeSurfaceType
          || before.viewport.activeSurfaceLabel !== after.viewport.activeSurfaceLabel;
    if (before.viewport.modalPresent) {
      steps.push(
        closed.success
          ? 'overlay-closed'
          : `overlay-still-open:${after.viewport.foregroundUiType}:${after.viewport.foregroundUiLabel || 'unknown'}`,
      );
    } else {
      steps.push(
        after.viewport.isPrimarySurface
          ? 'primary-surface-restored'
          : `active-surface:${after.viewport.activeSurfaceType}:${after.viewport.activeSurfaceLabel || 'unknown'}`,
      );
    }

    return {
      success: closed.success || dismissed.success || exactForegroundCleared || activeSurfaceChanged || after.viewport.isPrimarySurface,
      restored: closed.success || exactForegroundCleared || after.viewport.isPrimarySurface,
      steps,
      error: (closed.success || exactForegroundCleared || after.viewport.isPrimarySurface)
        ? null
        : (dismissed.error || closed.error || 'Primary surface was not restored'),
    };
  }
}
