// ═══════════════════════════════════════════════════════════════════════════
// BrowserPageInteraction — DOM query, click, type, and metadata extraction
// ═══════════════════════════════════════════════════════════════════════════

import type { WebContentsView } from 'electron';

type TabEntry = {
  id: string;
  view: WebContentsView;
};

type ResolveEntry = (tabId?: string) => TabEntry | undefined;

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
  ): Promise<{ clicked: boolean; error: string | null }> {
    const safeSelector = JSON.stringify(selector);
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
        const opts = { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy };

        try {
          el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, buttons: 1 }));
          el.dispatchEvent(new MouseEvent('mousedown', { ...opts, button: 0, buttons: 1 }));
          el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, buttons: 0 }));
          el.dispatchEvent(new MouseEvent('mouseup', { ...opts, button: 0, buttons: 0 }));
        } catch {
          // Ignore PointerEvent unsupported environments.
        }

        el.focus();
        el.click();
        return { clicked: true, selector: ${safeSelector} };
      })()
    `, tabId);
    if (error) return { clicked: false, error };
    const r = result as { clicked?: boolean; reason?: string } | null;
    return { clicked: r?.clicked ?? false, error: r?.reason ?? null };
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
      entry.view.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(box.from.x), y: Math.round(box.from.y) });
      await this.delay(30);
      entry.view.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(box.from.x), y: Math.round(box.from.y), button: 'left', clickCount: 1 });
      await this.delay(80);
      for (let i = 1; i <= steps; i++) {
        const ratio = i / steps;
        const x = box.from.x + ((box.to.x - box.from.x) * ratio);
        const y = box.from.y + ((box.to.y - box.from.y) * ratio);
        entry.view.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y), button: 'left' });
        await this.delay(12);
      }
      entry.view.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(box.to.x), y: Math.round(box.to.y), button: 'left', clickCount: 1 });
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
}
