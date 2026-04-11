type ExecuteInPage = (
  expression: string,
  tabId?: string,
) => Promise<{ result: unknown; error: string | null }>;

export type ContentResult = {
  url: string;
  title: string;
  content: string;
  tier: 'semantic' | 'readability';
};

export type StrippedElement = {
  id: string;
  role: string;
  text: string;
  selector: string;
  href: string | null;
};

export type ElementResult = {
  url: string;
  elements: StrippedElement[];
  forms: unknown[];
};

/* ── Noise selectors removed in both tiers ── */

const NOISE_SELECTORS = [
  'nav', 'header', 'footer', 'aside', 'script', 'style', 'noscript', 'svg', 'canvas', 'iframe',
  '[role="banner"]', '[role="navigation"]', '[role="complementary"]', '[role="contentinfo"]',
  '[aria-hidden="true"]',
  '[class*="cookie"]', '[id*="cookie"]', '[class*="consent"]',
  '[class*="ad-"]', '[class*="advert"]', '[id*="google_ads"]', 'ins.adsbygoogle',
  '[class*="share"]', '[class*="social"]',
  '[class*="newsletter"]', '[class*="subscribe"]',
  '[class*="modal"]', '[class*="popup"]', '[class*="overlay"]',
  '#comments', '.comments', '#disqus_thread', '[class*="comment"]',
  '[class*="related"]', '[class*="recommended"]', '[class*="you-may"]',
  '[class*="sidebar"]', '[class*="menu"]',
].join(',');

/* ── Tier 1: Semantic extraction script ── */

const SEMANTIC_SCRIPT = `(() => {
  try {
    const NOISE = ${JSON.stringify(NOISE_SELECTORS)};
    const clone = document.cloneNode(true);
    clone.querySelectorAll(NOISE).forEach(el => el.remove());

    const MAIN_SEL = 'main, article, [role="main"], #content, #main-content, .main-content, .post-content, .entry-content';
    const container = clone.querySelector(MAIN_SEL) || clone.body || clone.documentElement;

    const sections = [];
    const headings = container.querySelectorAll('h1, h2, h3, h4');

    if (headings.length > 0) {
      for (const heading of headings) {
        const headingText = (heading.textContent || '').trim();
        const parts = [];
        let sibling = heading.nextElementSibling;
        while (sibling && !/^H[1-4]$/i.test(sibling.tagName)) {
          const t = (sibling.textContent || '').trim();
          if (t) parts.push(t);
          sibling = sibling.nextElementSibling;
        }
        sections.push({ heading: headingText, text: parts.join('\\n') });
      }
    } else {
      const paras = container.querySelectorAll('p, li, blockquote, pre');
      const texts = [];
      for (const p of paras) {
        const t = (p.textContent || '').trim();
        if (t.length > 20) texts.push(t);
      }
      if (texts.length > 0) {
        sections.push({ heading: '', text: texts.join('\\n') });
      }
    }

    const links = [];
    const anchors = container.querySelectorAll('a[href]');
    let linkCount = 0;
    for (const a of anchors) {
      if (linkCount >= 20) break;
      const text = (a.textContent || '').trim();
      if (text.length > 3) {
        links.push({ text: text.slice(0, 80), url: a.href || a.getAttribute('href') });
        linkCount++;
      }
    }

    const mainHeading = (document.querySelector('h1')?.textContent || '').trim();

    return {
      tier: 'semantic',
      title: document.title,
      url: location.href,
      mainHeading,
      sections,
      links,
    };
  } catch (e) {
    return { tier: 'semantic', title: document.title, url: location.href, mainHeading: '', sections: [], links: [] };
  }
})()`;

/* ── Tier 2: Readability fallback script ── */

const READABILITY_SCRIPT = `(() => {
  try {
    const NOISE = ${JSON.stringify(NOISE_SELECTORS)};
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll(NOISE).forEach(el => el.remove());
    let text = (clone.innerText || clone.textContent || '').trim();
    text = text.replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, 16000);
    return {
      tier: 'readability',
      title: document.title,
      url: location.href,
      text,
    };
  } catch (e) {
    return { tier: 'readability', title: '', url: '', text: '' };
  }
})()`;

/* ── Elements extraction script ── */

const ELEMENTS_SCRIPT = `(() => {
  try {
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

    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };

    const actionableSelector = 'a[href], button, input, textarea, select, [role="button"], [role="link"], [tabindex]';
    const allEls = Array.from(document.querySelectorAll(actionableSelector));
    const visibleEls = allEls.filter(el => {
      try { return isVisible(el); } catch (_) { return false; }
    }).slice(0, 60);

    const elements = visibleEls.map((el, i) => {
      const tagName = el.tagName.toLowerCase();
      const type = tagName === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : '';
      return {
        id: 'act_' + i,
        role: el.getAttribute('role') || '',
        tagName,
        text: ((el.innerText || el.textContent || '').trim()).slice(0, 80),
        selector: cssPath(el),
        href: el.getAttribute('href'),
        visible: true,
        inputType: type,
      };
    });

    const forms = Array.from(document.forms).slice(0, 10).map((form, fi) => {
      const fields = Array.from(form.elements)
        .filter(el => el instanceof HTMLElement)
        .slice(0, 20)
        .map((el) => {
          const label = (
            el.getAttribute('aria-label')
            || (el.labels && el.labels[0] && el.labels[0].innerText)
            || el.getAttribute('placeholder')
            || el.getAttribute('name')
            || ''
          ).trim();
          return { label, name: el.getAttribute('name') || '' };
        });

      const submitLabels = Array.from(form.querySelectorAll('button, input[type="submit"]'))
        .map(el => (el instanceof HTMLInputElement ? el.value : el.textContent || '').trim())
        .filter(Boolean)
        .slice(0, 3);

      const purpose = submitLabels[0]
        || (fields.find(f => /email|password|username|search/i.test(f.label)) || {}).label
        || 'unknown';

      return { fields, submitLabels, purpose };
    });

    return { elements, forms };
  } catch (e) {
    return { elements: [], forms: [] };
  }
})()`;

/* ── Minimum content length for semantic tier to be accepted ── */

const SEMANTIC_MIN_CHARS = 200;

/* ── PageExtractor class ── */

export class PageExtractor {
  constructor(private readonly executeInPage: ExecuteInPage) {}

  /**
   * Two-tier content extraction: semantic first, readability fallback if
   * the semantic tier produces fewer than 200 characters of markdown.
   */
  async extractContent(tabId: string): Promise<ContentResult> {
    // Tier 1: semantic
    const semanticResult = await this.executeInPage(SEMANTIC_SCRIPT, tabId);

    if (!semanticResult.error && semanticResult.result && typeof semanticResult.result === 'object') {
      const raw = semanticResult.result as any;
      if (raw.tier === 'semantic') {
        const markdown = this.buildMarkdown(raw);
        if (markdown.length >= SEMANTIC_MIN_CHARS) {
          return {
            url: raw.url || '',
            title: raw.title || '',
            content: markdown,
            tier: 'semantic',
          };
        }
      }
    }

    // Tier 2: readability fallback
    return this.readabilityFallback(tabId);
  }

  /**
   * Extract actionable elements and forms, stripping noise fields for disk storage.
   */
  async extractElements(tabId: string): Promise<ElementResult> {
    const { result, error } = await this.executeInPage(ELEMENTS_SCRIPT, tabId);

    if (error || !result || typeof result !== 'object') {
      return { url: '', elements: [], forms: [] };
    }

    const raw = result as any;
    const rawElements: any[] = Array.isArray(raw.elements) ? raw.elements : [];
    const rawForms: any[] = Array.isArray(raw.forms) ? raw.forms : [];

    // Strip to essential fields
    const elements: StrippedElement[] = rawElements.map((el) => ({
      id: el.id,
      role: el.role,
      text: el.text,
      selector: el.selector,
      href: el.href ?? null,
    }));

    return {
      url: raw.url || '',
      elements,
      forms: rawForms,
    };
  }

  /* ── Private helpers ── */

  private buildMarkdown(semantic: {
    mainHeading?: string;
    sections?: { heading: string; text: string }[];
    links?: { text: string; url: string }[];
  }): string {
    const parts: string[] = [];

    if (semantic.mainHeading) {
      parts.push(`# ${semantic.mainHeading}`);
      parts.push('');
    }

    if (Array.isArray(semantic.sections)) {
      for (const section of semantic.sections) {
        if (section.heading) {
          parts.push(`## ${section.heading}`);
          parts.push('');
        }
        if (section.text) {
          parts.push(section.text);
          parts.push('');
        }
      }
    }

    if (Array.isArray(semantic.links) && semantic.links.length > 0) {
      parts.push('## Links');
      parts.push('');
      for (const link of semantic.links) {
        parts.push(`- [${link.text}](${link.url})`);
      }
      parts.push('');
    }

    return parts.join('\n').trim();
  }

  private async readabilityFallback(tabId: string): Promise<ContentResult> {
    const { result, error } = await this.executeInPage(READABILITY_SCRIPT, tabId);

    if (error || !result || typeof result !== 'object') {
      return { url: '', title: '', content: '', tier: 'readability' };
    }

    const raw = result as any;
    return {
      url: raw.url || '',
      title: raw.title || '',
      content: raw.text || '',
      tier: 'readability',
    };
  }
}
