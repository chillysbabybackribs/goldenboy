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
        el.click();
        return { clicked: true };
      })()
    `, tabId);
    if (error) return { clicked: false, error };
    const r = result as { clicked?: boolean; reason?: string } | null;
    return { clicked: r?.clicked ?? false, error: r?.reason ?? null };
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
        el.focus();
        el.value = ${safeText};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { typed: true };
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
}
