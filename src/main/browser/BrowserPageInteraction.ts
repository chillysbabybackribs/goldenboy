// ═══════════════════════════════════════════════════════════════════════════
// BrowserPageInteraction — DOM query, click, type, and metadata extraction
// ═══════════════════════════════════════════════════════════════════════════

import { BrowserWindow } from 'electron';
import type { WebContentsView } from 'electron';

type TabEntry = {
  id: string;
  view: WebContentsView;
};

type ResolveEntry = (tabId?: string) => TabEntry | undefined;

export type BrowserPointerHitTestResult = {
  ok: boolean;
  error: string | null;
  selector: string;
  x?: number;
  y?: number;
  globalX?: number;
  globalY?: number;
  hitSelector?: string | null;
  hitTagName?: string | null;
  hitId?: string | null;
  hitText?: string | null;
  targetSelector?: string | null;
  targetTagName?: string | null;
  targetId?: string | null;
  targetText?: string | null;
  intercepted?: boolean;
};

export class BrowserPageInteraction {
  private resolveEntry: ResolveEntry;

  constructor(resolveEntry: ResolveEntry) {
    this.resolveEntry = resolveEntry;
  }

  // ─── Page Text ──────────────────────────────────────────────────────────

  async getPageText(maxLength: number = 8000): Promise<string> {
    const entry = this.resolveEntry();
    if (!entry) return '';
    try {
      const text: string = await entry.view.webContents.executeJavaScript(`
        (function() {
          // Prefer semantic main content containers
          var main = document.querySelector('main, article, [role="main"], #content, #main-content, .main-content');
          if (main && main.innerText && main.innerText.trim().length > 200) {
            return main.innerText;
          }
          // Fallback: body text with boilerplate stripped
          var clone = document.body.cloneNode(true);
          var selectors = ['nav', 'header', 'footer', 'aside', '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', '.sidebar', '.menu', '.cookie-banner'];
          selectors.forEach(function(s) {
            clone.querySelectorAll(s).forEach(function(el) { el.remove(); });
          });
          return clone.innerText || '';
        })()
      `);
      return text.slice(0, maxLength);
    } catch {
      return '(unable to extract page text)';
    }
  }

  // ─── Execute In Page ────────────────────────────────────────────────────

  async executeInPage(
    expression: string,
    tabId?: string,
  ): Promise<{ result: unknown; error: string | null }> {
    const entry = tabId ? this.resolveEntry(tabId) : this.resolveEntry();
    if (!entry) return { result: null, error: 'No active tab' };
    try {
      const result = await entry.view.webContents.executeJavaScript(expression);
      return { result, error: null };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { result: null, error: message };
    }
  }

  // ─── Query Selector ─────────────────────────────────────────────────────

  async querySelectorAll(
    selector: string,
    tabId?: string,
    limit: number = 20,
  ): Promise<Array<{ tag: string; text: string; href: string | null; id: string; classes: string[] }>> {
    const safeSelector = JSON.stringify(selector);
    const { result, error } = await this.executeInPage(`
      (() => {
        const els = Array.from(document.querySelectorAll(${safeSelector})).slice(0, ${Math.floor(limit)});
        return els.map(el => ({
          tag: el.tagName.toLowerCase(),
          text: (el.innerText || el.textContent || '').slice(0, 200),
          href: el.getAttribute('href'),
          id: el.id || '',
          classes: Array.from(el.classList),
        }));
      })()
    `, tabId);
    if (error || !Array.isArray(result)) return [];
    return result;
  }

  // ─── Click Element ──────────────────────────────────────────────────────

  async clickElement(
    selector: string,
    tabId?: string,
  ): Promise<{
    clicked: boolean;
    error: string | null;
    method?: string;
    x?: number;
    y?: number;
    globalX?: number;
    globalY?: number;
    hitTest?: BrowserPointerHitTestResult;
  }> {
    const entry = tabId ? this.resolveEntry(tabId) : this.resolveEntry();
    if (!entry) return { clicked: false, error: 'No active tab' };

    const safeSelector = JSON.stringify(selector);
    const geometry = await entry.view.webContents.executeJavaScript(`
      (() => {
        const el = document.querySelector(${safeSelector});
        if (!el) return { ok: false, reason: 'Element not found' };
        if (!(el instanceof HTMLElement)) {
          return { ok: false, reason: 'Element is not an HTMLElement' };
        }
        if ((el).disabled) return { ok: false, reason: 'Element is disabled' };
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return { ok: false, reason: 'Element has no visible box' };
        return {
          ok: true,
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      })()
    `);
    const point = geometry as { ok?: boolean; reason?: string; x?: number; y?: number } | null;
    if (!point?.ok || typeof point.x !== 'number' || typeof point.y !== 'number') {
      return { clicked: false, error: point?.reason || 'Could not resolve click geometry' };
    }

    const x = Math.max(1, Math.round(point.x));
    const y = Math.max(1, Math.round(point.y));
    const globalPoint = this.toGlobalPoint(entry, x, y);
    const hitTest = await this.hitTestElement(selector, tabId);
    if (hitTest.intercepted) {
      return {
        clicked: false,
        error: `Pointer intercepted by ${hitTest.hitSelector || hitTest.hitTagName || 'unknown element'}`,
        method: 'preflight-hit-test',
        x,
        y,
        globalX: globalPoint.x,
        globalY: globalPoint.y,
        hitTest,
      };
    }

    try {
      const nativePoint = {
        x,
        y,
        globalX: globalPoint.x,
        globalY: globalPoint.y,
      };
      entry.view.webContents.sendInputEvent({ type: 'mouseMove', ...nativePoint });
      await this.delay(20);
      entry.view.webContents.sendInputEvent({ type: 'mouseDown', ...nativePoint, button: 'left', clickCount: 1 });
      await this.delay(35);
      entry.view.webContents.sendInputEvent({ type: 'mouseUp', ...nativePoint, button: 'left', clickCount: 1 });
      await this.delay(60);
      return {
        clicked: true,
        error: null,
        method: 'native-input',
        x,
        y,
        globalX: globalPoint.x,
        globalY: globalPoint.y,
        hitTest,
      };
    } catch {
      // DOM fallback below covers test and degraded environments.
    }

    const { result, error } = await this.executeInPage(`
      (() => {
        const el = document.querySelector(${safeSelector});
        if (!el) return { clicked: false, reason: 'Element not found' };
        if (!(el instanceof HTMLElement)) {
          return { clicked: false, reason: 'Element is not an HTMLElement' };
        }
        if ((el).disabled) return { clicked: false, reason: 'Element is disabled' };

        const rect = el.getBoundingClientRect();
        const cx = Math.max(0, rect.left + Math.min(rect.width / 2, Math.max(1, rect.width - 1)));
        const cy = Math.max(0, rect.top + Math.min(rect.height / 2, Math.max(1, rect.height - 1)));
        const sx = Math.max(1, Math.round((window.screenX || 0) + cx));
        const sy = Math.max(1, Math.round((window.screenY || 0) + cy));
        const opts = { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy, screenX: sx, screenY: sy };

        try {
          el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, buttons: 1 }));
          el.dispatchEvent(new MouseEvent('mousedown', { ...opts, button: 0, buttons: 1 }));
          el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, buttons: 0 }));
          el.dispatchEvent(new MouseEvent('mouseup', { ...opts, button: 0, buttons: 0 }));
        } catch {
          // Ignore PointerEvent unsupported environments.
        }

        el.focus();
        el.dispatchEvent(new MouseEvent('click', { ...opts, button: 0, buttons: 0, detail: 1 }));
        return { clicked: true, selector: ${safeSelector}, x: cx, y: cy };
      })()
    `, tabId);
    if (error) return { clicked: false, error };
    const r = result as { clicked?: boolean; reason?: string; x?: number; y?: number } | null;
    return {
      clicked: r?.clicked ?? false,
      error: r?.reason ?? null,
      method: 'dom-mouse-events',
      x: r?.x,
      y: r?.y,
    };
  }

  async hitTestElement(
    selector: string,
    tabId?: string,
  ): Promise<BrowserPointerHitTestResult> {
    const entry = tabId ? this.resolveEntry(tabId) : this.resolveEntry();
    if (!entry) {
      return { ok: false, error: 'No active tab', selector };
    }

    const safeSelector = JSON.stringify(selector);
    const { result, error } = await this.executeInPage(`
      (() => {
        const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
        const cssEscape = (value) => {
          if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value));
          return String(value).replace(/([ #;?%&,.+*~\\':"!^$[\\]()=>|\\/@])/g, '\\\\$1');
        };
        const selectorFor = (el) => {
          if (!(el instanceof Element)) return '';
          if (el.id) return '#' + cssEscape(el.id);
          const dataTest = el.getAttribute('data-test') || el.getAttribute('data-testid');
          if (dataTest) return '[' + (el.hasAttribute('data-test') ? 'data-test' : 'data-testid') + '="' + cssEscape(dataTest) + '"]';
          const parts = [];
          let node = el;
          while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
            let part = node.tagName.toLowerCase();
            const parent = node.parentElement;
            if (parent) {
              const siblings = Array.from(parent.children).filter(child => child.tagName === node.tagName);
              if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
            }
            parts.unshift(part);
            node = parent;
          }
          return parts.join(' > ');
        };
        const summarize = (el) => {
          if (!(el instanceof Element)) return {
            selector: null,
            tagName: null,
            id: null,
            text: null,
          };
          return {
            selector: selectorFor(el),
            tagName: el.tagName.toLowerCase(),
            id: el.id || null,
            text: clean(el.getAttribute('aria-label') || el.textContent || '').slice(0, 120) || null,
          };
        };

        const target = document.querySelector(${safeSelector});
        if (!target) return { ok: false, reason: 'Element not found' };
        if (!(target instanceof HTMLElement)) return { ok: false, reason: 'Element is not an HTMLElement' };
        target.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = target.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return { ok: false, reason: 'Element has no visible box' };
        const x = Math.max(1, Math.round(rect.left + rect.width / 2));
        const y = Math.max(1, Math.round(rect.top + rect.height / 2));
        const hit = document.elementFromPoint(x, y);
        const intercepted = !!hit && hit !== target && !target.contains(hit);
        const targetSummary = summarize(target);
        const hitSummary = summarize(hit);
        return {
          ok: true,
          x,
          y,
          intercepted,
          targetSelector: targetSummary.selector,
          targetTagName: targetSummary.tagName,
          targetId: targetSummary.id,
          targetText: targetSummary.text,
          hitSelector: hitSummary.selector,
          hitTagName: hitSummary.tagName,
          hitId: hitSummary.id,
          hitText: hitSummary.text,
        };
      })()
    `, tabId);

    if (error) return { ok: false, error, selector };
    const raw = (result || {}) as Record<string, unknown>;
    if (raw.ok !== true) {
      return {
        ok: false,
        error: typeof raw.reason === 'string' ? raw.reason : 'Hit test failed',
        selector,
      };
    }
    const x = typeof raw.x === 'number' ? raw.x : undefined;
    const y = typeof raw.y === 'number' ? raw.y : undefined;
    const globalPoint = typeof x === 'number' && typeof y === 'number'
      ? this.toGlobalPoint(entry, x, y)
      : null;
    return {
      ok: true,
      error: null,
      selector,
      x,
      y,
      globalX: globalPoint?.x,
      globalY: globalPoint?.y,
      intercepted: raw.intercepted === true,
      hitSelector: typeof raw.hitSelector === 'string' ? raw.hitSelector : null,
      hitTagName: typeof raw.hitTagName === 'string' ? raw.hitTagName : null,
      hitId: typeof raw.hitId === 'string' ? raw.hitId : null,
      hitText: typeof raw.hitText === 'string' ? raw.hitText : null,
      targetSelector: typeof raw.targetSelector === 'string' ? raw.targetSelector : null,
      targetTagName: typeof raw.targetTagName === 'string' ? raw.targetTagName : null,
      targetId: typeof raw.targetId === 'string' ? raw.targetId : null,
      targetText: typeof raw.targetText === 'string' ? raw.targetText : null,
    };
  }

  // ─── Hover Element ───────────────────────────────────────────────────────

  async hoverElement(
    selector: string,
    tabId?: string,
  ): Promise<{
    hovered: boolean;
    error: string | null;
    method?: string;
    selector?: string;
    x?: number;
    y?: number;
    globalX?: number;
    globalY?: number;
    hitTest?: BrowserPointerHitTestResult;
  }> {
    const entry = tabId ? this.resolveEntry(tabId) : this.resolveEntry();
    if (!entry) return { hovered: false, error: 'No active tab' };

    const hitTest = await this.hitTestElement(selector, tabId);
    if (!hitTest.ok || typeof hitTest.x !== 'number' || typeof hitTest.y !== 'number') {
      return { hovered: false, error: hitTest.error || 'Could not resolve hover target', hitTest };
    }
    if (hitTest.intercepted) {
      return {
        hovered: false,
        error: `Pointer intercepted by ${hitTest.hitSelector || hitTest.hitTagName || 'unknown element'}`,
        method: 'preflight-hit-test',
        selector,
        x: hitTest.x,
        y: hitTest.y,
        globalX: hitTest.globalX,
        globalY: hitTest.globalY,
        hitTest,
      };
    }

    const x = Math.max(1, Math.round(hitTest.x));
    const y = Math.max(1, Math.round(hitTest.y));
    const globalPoint = this.toGlobalPoint(entry, x, y);
    try {
      entry.view.webContents.sendInputEvent({
        type: 'mouseMove',
        x,
        y,
        globalX: globalPoint.x,
        globalY: globalPoint.y,
      });
      await this.delay(120);
      return {
        hovered: true,
        error: null,
        method: 'native-input',
        selector,
        x,
        y,
        globalX: globalPoint.x,
        globalY: globalPoint.y,
        hitTest,
      };
    } catch {
      // DOM fallback below covers test and degraded environments.
    }

    const safeSelector = JSON.stringify(selector);
    const { result, error } = await this.executeInPage(`
      (() => {
        const el = document.querySelector(${safeSelector});
        if (!el) return { hovered: false, reason: 'Element not found' };
        if (!(el instanceof Element)) return { hovered: false, reason: 'Element is not an Element' };
        const rect = el.getBoundingClientRect();
        const x = Math.max(1, Math.round(rect.left + rect.width / 2));
        const y = Math.max(1, Math.round(rect.top + rect.height / 2));
        const opts = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, screenX: Math.max(1, x), screenY: Math.max(1, y), button: 0, buttons: 0 };
        try {
          el.dispatchEvent(new PointerEvent('pointerover', { ...opts, pointerId: 1, isPrimary: true, pointerType: 'mouse' }));
          el.dispatchEvent(new PointerEvent('pointerenter', { ...opts, pointerId: 1, isPrimary: true, pointerType: 'mouse' }));
        } catch {}
        el.dispatchEvent(new MouseEvent('mouseover', opts));
        el.dispatchEvent(new MouseEvent('mouseenter', opts));
        el.dispatchEvent(new MouseEvent('mousemove', opts));
        return { hovered: true, x, y };
      })()
    `, tabId);

    if (error) return { hovered: false, error, hitTest };
    const r = result as { hovered?: boolean; reason?: string; x?: number; y?: number } | null;
    return {
      hovered: r?.hovered ?? false,
      error: r?.reason ?? null,
      method: 'dom-hover-events',
      selector,
      x: r?.x,
      y: r?.y,
      hitTest,
    };
  }

  // ─── Drag Element ────────────────────────────────────────────────────────

  async dragElement(
    sourceSelector: string,
    targetSelector: string,
    tabId?: string,
  ): Promise<{
    dragged: boolean;
    error: string | null;
    sourceSelector?: string;
    targetSelector?: string;
    method?: string;
    from?: { x: number; y: number };
    to?: { x: number; y: number };
    globalFrom?: { x: number; y: number };
    globalTo?: { x: number; y: number };
  }> {
    const entry = tabId ? this.resolveEntry(tabId) : this.resolveEntry();
    if (!entry) return { dragged: false, error: 'No active tab' };

    const safeSourceSelector = JSON.stringify(sourceSelector);
    const safeTargetSelector = JSON.stringify(targetSelector);
    const geometry = await entry.view.webContents.executeJavaScript(`
      (() => {
        const source = document.querySelector(${safeSourceSelector});
        const target = document.querySelector(${safeTargetSelector});
        if (!source) return { ok: false, reason: 'Source element not found' };
        if (!target) return { ok: false, reason: 'Target element not found' };
        if (!(source instanceof Element) || !(target instanceof Element)) {
          return { ok: false, reason: 'Source or target is not an Element' };
        }
        source.scrollIntoView({ block: 'center', inline: 'center' });
        target.scrollIntoView({ block: 'center', inline: 'center' });
        const sourceRect = source.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        if (sourceRect.width <= 0 || sourceRect.height <= 0) return { ok: false, reason: 'Source element has no visible box' };
        if (targetRect.width <= 0 || targetRect.height <= 0) return { ok: false, reason: 'Target element has no visible box' };
        return {
          ok: true,
          from: { x: sourceRect.left + sourceRect.width / 2, y: sourceRect.top + sourceRect.height / 2 },
          to: { x: targetRect.left + targetRect.width / 2, y: targetRect.top + targetRect.height / 2 },
        };
      })()
    `);

    const box = geometry as {
      ok?: boolean;
      reason?: string;
      from?: { x: number; y: number };
      to?: { x: number; y: number };
    } | null;
    if (!box?.ok || !box.from || !box.to) {
      return { dragged: false, error: box?.reason || 'Could not resolve drag geometry' };
    }

    try {
      const steps = 16;
      const start = {
        x: Math.round(box.from.x),
        y: Math.round(box.from.y),
      };
      const startGlobal = this.toGlobalPoint(entry, start.x, start.y);
      entry.view.webContents.sendInputEvent({ type: 'mouseMove', ...start, globalX: startGlobal.x, globalY: startGlobal.y });
      await this.delay(30);
      entry.view.webContents.sendInputEvent({ type: 'mouseDown', ...start, globalX: startGlobal.x, globalY: startGlobal.y, button: 'left', clickCount: 1 });
      await this.delay(80);
      for (let i = 1; i <= steps; i++) {
        const ratio = i / steps;
        const x = box.from.x + ((box.to.x - box.from.x) * ratio);
        const y = box.from.y + ((box.to.y - box.from.y) * ratio);
        const point = { x: Math.round(x), y: Math.round(y) };
        const globalPoint = this.toGlobalPoint(entry, point.x, point.y);
        entry.view.webContents.sendInputEvent({ type: 'mouseMove', ...point, globalX: globalPoint.x, globalY: globalPoint.y, button: 'left' });
        await this.delay(12);
      }
      const end = {
        x: Math.round(box.to.x),
        y: Math.round(box.to.y),
      };
      const endGlobal = this.toGlobalPoint(entry, end.x, end.y);
      entry.view.webContents.sendInputEvent({ type: 'mouseUp', ...end, globalX: endGlobal.x, globalY: endGlobal.y, button: 'left', clickCount: 1 });
      await this.delay(80);
    } catch {
      // DOM event fallback below covers environments where native input is unavailable.
    }

    const { result, error } = await this.executeInPage(`
      (() => {
        const source = document.querySelector(${safeSourceSelector});
        const target = document.querySelector(${safeTargetSelector});
        if (!source) return { dragged: false, reason: 'Source element not found' };
        if (!target) return { dragged: false, reason: 'Target element not found' };
        if (!(source instanceof Element) || !(target instanceof Element)) {
          return { dragged: false, reason: 'Source or target is not an Element' };
        }

        const rectOf = (el) => el.getBoundingClientRect();
        const sourceRect = rectOf(source);
        const targetRect = rectOf(target);
        const from = { x: sourceRect.left + sourceRect.width / 2, y: sourceRect.top + sourceRect.height / 2 };
        const to = { x: targetRect.left + targetRect.width / 2, y: targetRect.top + targetRect.height / 2 };
        const dataTransfer = typeof DataTransfer === 'function'
          ? new DataTransfer()
          : {
              data: {},
              dropEffect: 'move',
              effectAllowed: 'all',
              files: [],
              items: [],
              types: [],
              clearData() { this.data = {}; this.types = []; },
              getData(type) { return this.data[type] || ''; },
              setData(type, value) { this.data[type] = String(value); if (!this.types.includes(type)) this.types.push(type); },
              setDragImage() {},
            };
        const fire = (el, type, point, extra = {}) => {
          const common = { bubbles: true, cancelable: true, composed: true, clientX: point.x, clientY: point.y, button: 0, buttons: type.endsWith('up') ? 0 : 1, ...extra };
          let event;
          if (type.startsWith('drag') || type === 'drop') {
            try {
              event = new DragEvent(type, { ...common, dataTransfer });
            } catch {
              event = new MouseEvent(type, common);
              Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
            }
          } else if (type.startsWith('pointer')) {
            try {
              event = new PointerEvent(type, { ...common, pointerId: 1, isPrimary: true, pointerType: 'mouse' });
            } catch {
              event = new MouseEvent(type.replace('pointer', 'mouse'), common);
            }
          } else {
            event = new MouseEvent(type, common);
          }
          return el.dispatchEvent(event);
        };

        source.dispatchEvent(new Event('focus', { bubbles: true }));
        fire(source, 'pointerdown', from);
        fire(source, 'mousedown', from);
        fire(source, 'dragstart', from);
        fire(source, 'drag', from);
        fire(target, 'pointermove', to);
        fire(target, 'mousemove', to);
        fire(target, 'dragenter', to);
        fire(target, 'dragover', to);
        fire(target, 'drop', to);
        fire(source, 'dragend', to);
        fire(target, 'mouseup', to, { buttons: 0 });
        fire(target, 'pointerup', to, { buttons: 0 });

        return { dragged: true, sourceSelector: ${safeSourceSelector}, targetSelector: ${safeTargetSelector}, from, to };
      })()
    `, tabId);

    if (error) return { dragged: false, error };
    const r = result as {
      dragged?: boolean;
      reason?: string;
      from?: { x: number; y: number };
      to?: { x: number; y: number };
    } | null;
    return {
      dragged: r?.dragged ?? false,
      error: r?.reason ?? null,
      sourceSelector,
      targetSelector,
      method: 'native-input+dom-events',
      from: r?.from || box.from,
      to: r?.to || box.to,
      globalFrom: this.toGlobalPoint(entry, Math.round(box.from.x), Math.round(box.from.y)),
      globalTo: this.toGlobalPoint(entry, Math.round(box.to.x), Math.round(box.to.y)),
    };
  }

  // ─── Type In Element ────────────────────────────────────────────────────

  async typeInElement(
    selector: string,
    text: string,
    tabId?: string,
  ): Promise<{ typed: boolean; error: string | null }> {
    const safeSelector = JSON.stringify(selector);
    const safeText = JSON.stringify(text);
    const { result, error } = await this.executeInPage(`
      (() => {
        const el = document.querySelector(${safeSelector});
        if (!el) return { typed: false, reason: 'Element not found' };
        if (!(el instanceof HTMLElement)) return { typed: false, reason: 'Element is not an HTMLElement' };
        if ((el).disabled) return { typed: false, reason: 'Element is disabled' };

        const value = ${safeText};
        const setNativeValue = (node, next) => {
          const proto = node instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : node instanceof HTMLSelectElement
              ? HTMLSelectElement.prototype
              : HTMLInputElement.prototype;
          const desc = Object.getOwnPropertyDescriptor(proto, 'value');
          if (desc && typeof desc.set === 'function') {
            desc.set.call(node, next);
            return true;
          }
          node.value = next;
          return true;
        };

        const fireInput = (node, data) => {
          const common = { bubbles: true, cancelable: true, composed: true };
          try {
            node.dispatchEvent(new InputEvent('beforeinput', { ...common, inputType: 'insertText', data }));
          } catch {}
          try {
            node.dispatchEvent(new InputEvent('input', { ...common, inputType: 'insertText', data }));
          } catch {
            node.dispatchEvent(new Event('input', { bubbles: true }));
          }
          node.dispatchEvent(new Event('change', { bubbles: true }));
        };

        el.focus();
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
          setNativeValue(el, value);
          fireInput(el, value);
          el.blur();
          return { typed: true, value: el.value };
        }

        if (el.isContentEditable) {
          el.textContent = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.blur();
          return { typed: true, value: el.textContent || '' };
        }

        return { typed: false, reason: 'Element is not typeable' };
      })()
    `, tabId);
    if (error) return { typed: false, error };
    const r = result as { typed?: boolean; reason?: string } | null;
    return { typed: r?.typed ?? false, error: r?.reason ?? null };
  }

  // ─── Page Metadata ──────────────────────────────────────────────────────

  async getPageMetadata(tabId?: string): Promise<Record<string, unknown>> {
    const { result, error } = await this.executeInPage(`
      (() => ({
        title: document.title,
        url: location.href,
        description: document.querySelector('meta[name="description"]')?.content || '',
        h1: Array.from(document.querySelectorAll('h1')).map(el => el.innerText).slice(0, 5),
        links: document.querySelectorAll('a[href]').length,
        inputs: document.querySelectorAll('input, textarea, select').length,
        forms: document.querySelectorAll('form').length,
        images: document.querySelectorAll('img').length,
      }))()
    `, tabId);
    if (error) return { error };
    return (result as Record<string, unknown>) || {};
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private toGlobalPoint(entry: TabEntry, x: number, y: number): { x: number; y: number } {
    const viewBounds = entry.view.getBounds();
    const windowBounds = BrowserWindow.fromWebContents(entry.view.webContents)?.getBounds();
    return {
      x: Math.max(1, Math.round((windowBounds?.x || 0) + viewBounds.x + x)),
      y: Math.max(1, Math.round((windowBounds?.y || 0) + viewBounds.y + y)),
    };
  }
}
