import { generateId } from '../../shared/utils/ids';

type TabEntry = {
  id: string;
};

type ResolveEntry = (tabId?: string) => TabEntry | undefined;

type VisualMaskRecord = {
  id: string;
  selector: string;
  blurPx: number;
  createdAt: number;
  tabId: string;
  matchCount: number;
};

type Deps = {
  resolveEntry: ResolveEntry;
  executeInPage: (expression: string, tabId?: string) => Promise<{ result: unknown; error: string | null }>;
};

type RenderResult = {
  ok: boolean;
  masks: Array<{ id: string; selector: string; blurPx: number; matchCount: number }>;
  error?: string;
};

type SelectorAtPointResult = {
  ok: boolean;
  selector?: string;
  label?: string | null;
  error?: string;
};

const STYLE_ID = 'goldenboy-visual-mask-style';

export class BrowserVisualMaskManager {
  private readonly deps: Deps;
  private readonly masksByTab = new Map<string, VisualMaskRecord[]>();

  constructor(deps: Deps) {
    this.deps = deps;
  }

  async applyMask(input: {
    selector: string;
    blurPx?: number;
    tabId?: string;
  }): Promise<{
    success: boolean;
    mask: VisualMaskRecord | null;
    matchedCount: number;
    error: string | null;
  }> {
    const entry = this.deps.resolveEntry(input.tabId);
    if (!entry) return { success: false, mask: null, matchedCount: 0, error: 'No active tab' };

    const selector = input.selector.trim();
    if (!selector) return { success: false, mask: null, matchedCount: 0, error: 'Selector is required' };

    const blurPx = this.normalizeBlurPx(input.blurPx);
    const mask: VisualMaskRecord = {
      id: generateId('vmask'),
      selector,
      blurPx,
      createdAt: Date.now(),
      tabId: entry.id,
      matchCount: 0,
    };

    const current = this.masksByTab.get(entry.id) ?? [];
    current.push(mask);
    this.masksByTab.set(entry.id, current);

    const render = await this.renderMasks(entry.id, current);
    if (!render.ok) {
      this.masksByTab.set(entry.id, current.filter(item => item.id !== mask.id));
      return {
        success: false,
        mask: null,
        matchedCount: 0,
        error: render.error || 'Failed to apply visual mask',
      };
    }

    this.mergeRenderedCounts(entry.id, render.masks);
    const stored = (this.masksByTab.get(entry.id) ?? []).find(item => item.id === mask.id) ?? null;
    return {
      success: true,
      mask: stored,
      matchedCount: stored?.matchCount ?? 0,
      error: null,
    };
  }

  async applyMaskAtPoint(input: {
    x: number;
    y: number;
    blurPx?: number;
    tabId?: string;
  }): Promise<{
    success: boolean;
    mask: VisualMaskRecord | null;
    matchedCount: number;
    selector: string | null;
    label: string | null;
    error: string | null;
  }> {
    const entry = this.deps.resolveEntry(input.tabId);
    if (!entry) {
      return { success: false, mask: null, matchedCount: 0, selector: null, label: null, error: 'No active tab' };
    }

    const resolved = await this.resolveSelectorAtPoint(entry.id, input.x, input.y);
    if (!resolved.ok || !resolved.selector) {
      return {
        success: false,
        mask: null,
        matchedCount: 0,
        selector: null,
        label: resolved.label ?? null,
        error: resolved.error || 'Could not resolve element at pointer',
      };
    }

    const applied = await this.applyMask({
      selector: resolved.selector,
      blurPx: input.blurPx,
      tabId: entry.id,
    });

    return {
      ...applied,
      selector: resolved.selector,
      label: resolved.label ?? null,
    };
  }

  async clearMasks(input: {
    tabId?: string;
    maskId?: string;
    selector?: string;
    all?: boolean;
  }): Promise<{
    success: boolean;
    clearedCount: number;
    remainingCount: number;
    error: string | null;
  }> {
    const entry = this.deps.resolveEntry(input.tabId);
    if (!entry) return { success: false, clearedCount: 0, remainingCount: 0, error: 'No active tab' };

    const current = this.masksByTab.get(entry.id) ?? [];
    if (current.length === 0) {
      await this.renderMasks(entry.id, []);
      return { success: true, clearedCount: 0, remainingCount: 0, error: null };
    }

    let remaining: VisualMaskRecord[];
    if (input.all) {
      remaining = [];
    } else if (input.maskId) {
      remaining = current.filter(item => item.id !== input.maskId);
    } else if (input.selector) {
      remaining = current.filter(item => item.selector !== input.selector);
    } else {
      remaining = current.slice(0, -1);
    }

    const clearedCount = current.length - remaining.length;
    this.masksByTab.set(entry.id, remaining);
    const render = await this.renderMasks(entry.id, remaining);
    if (!render.ok) {
      this.masksByTab.set(entry.id, current);
      return {
        success: false,
        clearedCount: 0,
        remainingCount: current.length,
        error: render.error || 'Failed to clear visual masks',
      };
    }

    this.mergeRenderedCounts(entry.id, render.masks);
    if (remaining.length === 0) {
      this.masksByTab.delete(entry.id);
    }
    return {
      success: true,
      clearedCount,
      remainingCount: remaining.length,
      error: null,
    };
  }

  listMasks(tabId?: string): VisualMaskRecord[] {
    const entry = this.deps.resolveEntry(tabId);
    if (!entry) return [];
    return (this.masksByTab.get(entry.id) ?? []).map(mask => ({ ...mask }));
  }

  async reapplyMasks(tabId?: string): Promise<void> {
    const entry = this.deps.resolveEntry(tabId);
    if (!entry) return;
    const current = this.masksByTab.get(entry.id) ?? [];
    const render = await this.renderMasks(entry.id, current);
    if (!render.ok) return;
    this.mergeRenderedCounts(entry.id, render.masks);
  }

  removeTab(tabId: string): void {
    this.masksByTab.delete(tabId);
  }

  private normalizeBlurPx(value: number | undefined): number {
    if (!Number.isFinite(value)) return 7;
    return Math.max(1, Math.min(24, Math.round(value as number)));
  }

  private mergeRenderedCounts(
    tabId: string,
    rendered: Array<{ id: string; selector: string; blurPx: number; matchCount: number }>,
  ): void {
    const current = this.masksByTab.get(tabId) ?? [];
    const next = current.map((mask) => {
      const applied = rendered.find(item => item.id === mask.id);
      return applied ? { ...mask, matchCount: applied.matchCount } : { ...mask, matchCount: 0 };
    });
    if (next.length > 0) {
      this.masksByTab.set(tabId, next);
    }
  }

  private async resolveSelectorAtPoint(tabId: string, x: number, y: number): Promise<SelectorAtPointResult> {
    const point = {
      x: Math.max(1, Math.round(x)),
      y: Math.max(1, Math.round(y)),
    };
    const { result, error } = await this.deps.executeInPage(
      `(() => {
        const x = ${JSON.stringify(point.x)};
        const y = ${JSON.stringify(point.y)};
        const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
        const cssEscape = (value) => {
          if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value));
          return String(value).replace(/([ #;?%&,.+*~\\':"!^$[\\]()=>|\\/@])/g, '\\\\$1');
        };
        const selectorFor = (el) => {
          if (!(el instanceof Element)) return '';
          if (el.id) return '#' + cssEscape(el.id);
          const attrName = el.hasAttribute('data-testid') ? 'data-testid' : (el.hasAttribute('data-test') ? 'data-test' : null);
          if (attrName) return '[' + attrName + '="' + cssEscape(el.getAttribute(attrName) || '') + '"]';
          const parts = [];
          let node = el;
          while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 8) {
            let part = node.tagName.toLowerCase();
            const classNames = Array.from(node.classList || []).filter(Boolean).slice(0, 2);
            if (classNames.length > 0) {
              part += classNames.map(name => '.' + cssEscape(name)).join('');
            }
            const parent = node.parentElement;
            if (parent) {
              const siblings = Array.from(parent.children).filter(child => child.tagName === node.tagName);
              if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
            }
            parts.unshift(part);
            if (node.id || attrName) break;
            node = parent;
          }
          return parts.join(' > ');
        };

        let target = document.elementFromPoint(x, y);
        if (target instanceof Text) target = target.parentElement;
        if (!(target instanceof HTMLElement)) {
          return { ok: false, error: 'No blur target under pointer', label: null };
        }
        const selector = selectorFor(target);
        if (!selector) {
          return { ok: false, error: 'Could not derive selector for target', label: clean(target.innerText || target.textContent || '') || target.tagName.toLowerCase() };
        }
        return {
          ok: true,
          selector,
          label: clean(target.getAttribute('aria-label') || target.innerText || target.textContent || '') || target.tagName.toLowerCase(),
        };
      })()`,
      tabId,
    );

    if (error) return { ok: false, error };
    const data = result as SelectorAtPointResult | null;
    if (!data || data.ok !== true || typeof data.selector !== 'string') {
      return {
        ok: false,
        label: data?.label ?? null,
        error: data?.error || 'Could not resolve element at pointer',
      };
    }
    return {
      ok: true,
      selector: data.selector,
      label: data.label ?? null,
    };
  }

  private async renderMasks(tabId: string, masks: VisualMaskRecord[]): Promise<RenderResult> {
    const safeMasks = masks.map(mask => ({
      id: mask.id,
      selector: mask.selector,
      blurPx: mask.blurPx,
    }));
    const { result, error } = await this.deps.executeInPage(
      `(() => {
        const masks = ${JSON.stringify(safeMasks)};
        const styleId = ${JSON.stringify(STYLE_ID)};
        let style = document.getElementById(styleId);
        if (!style) {
          style = document.createElement('style');
          style.id = styleId;
          style.textContent = \`
            .gb-visual-mask-target {
              filter: blur(var(--gb-visual-mask-blur, 7px)) !important;
              transition: filter 160ms ease;
              user-select: none !important;
            }
          \`;
          document.head.appendChild(style);
        }

        document.querySelectorAll('[data-gb-visual-mask-target="true"]').forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          node.classList.remove('gb-visual-mask-target');
          node.removeAttribute('data-gb-visual-mask-target');
          node.removeAttribute('data-gb-visual-mask-ids');
          node.style.removeProperty('--gb-visual-mask-blur');
        });

        const applied = [];
        for (const mask of masks) {
          let matchCount = 0;
          let nodes = [];
          try {
            nodes = Array.from(document.querySelectorAll(mask.selector));
          } catch (selectorError) {
            return {
              ok: false,
              error: selectorError instanceof Error ? selectorError.message : 'Invalid selector',
              masks: applied,
            };
          }
          for (const node of nodes) {
            if (!(node instanceof HTMLElement)) continue;
            const currentBlur = parseInt(node.style.getPropertyValue('--gb-visual-mask-blur') || '0', 10) || 0;
            node.classList.add('gb-visual-mask-target');
            node.setAttribute('data-gb-visual-mask-target', 'true');
            const ids = new Set((node.getAttribute('data-gb-visual-mask-ids') || '').split(',').filter(Boolean));
            ids.add(mask.id);
            node.setAttribute('data-gb-visual-mask-ids', Array.from(ids).join(','));
            node.style.setProperty('--gb-visual-mask-blur', Math.max(currentBlur, mask.blurPx) + 'px');
            matchCount += 1;
          }
          applied.push({
            id: mask.id,
            selector: mask.selector,
            blurPx: mask.blurPx,
            matchCount,
          });
        }

        return { ok: true, masks: applied };
      })()`,
      tabId,
    );

    if (error) return { ok: false, masks: [], error };
    const data = result as RenderResult | null;
    if (!data || data.ok !== true) {
      return {
        ok: false,
        masks: [],
        error: data?.error || 'Failed to render visual masks',
      };
    }
    return data;
  }
}
