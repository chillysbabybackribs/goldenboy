import { asObject, escapeRegex, includesText } from './WebIntentVM.utils';

type WebIntentHelperPageState = {
  url: string;
  title: string;
  text: string;
  mainHeading?: string;
};

export type WebIntentHelperAdapter = {
  executeInPage: (expression: string, tabId?: string) => Promise<{ result: unknown; error: string | null }>;
  readPageState: (tabId?: string) => Promise<WebIntentHelperPageState>;
};

export type AuthState = {
  hasLoginMarkers: boolean;
  hasAuthMarkers: boolean;
  url: string;
  title: string;
};

export type LoginTargets = {
  usernameSelector: string | null;
  passwordSelector: string | null;
  submitSelector: string | null;
  formSelector: string | null;
};

export type CheckoutInfoTargets = {
  firstNameSelector: string | null;
  lastNameSelector: string | null;
  postalSelector: string | null;
  submitSelector: string | null;
  formSelector: string | null;
};

export async function readAuthState(adapter: WebIntentHelperAdapter, tabId?: string): Promise<AuthState> {
  const probe = await adapter.executeInPage(`
    (() => {
      /* __WEB_INTENT_ASSERT_LOGIN__ */
      const body = (document.body?.innerText || '').toLowerCase();
      const hasPasswordInput = !!document.querySelector('input[type="password"]');
      const hasLoginMarkers = /(log in|sign in|password|forgot password|create account)/i.test(body) && hasPasswordInput;
      const hasAuthMarkers = /(logout|sign out|logged in|signed in|my account|dashboard|welcome|profile|account)/i.test(body);
      return {
        hasLoginMarkers,
        hasAuthMarkers,
        url: location.href,
        title: document.title || '',
      };
    })()
  `, tabId);

  if (!probe.error && probe.result && typeof probe.result === 'object') {
    const raw = probe.result as Record<string, unknown>;
    return {
      hasLoginMarkers: raw.hasLoginMarkers === true,
      hasAuthMarkers: raw.hasAuthMarkers === true,
      url: typeof raw.url === 'string' ? raw.url : '',
      title: typeof raw.title === 'string' ? raw.title : '',
    };
  }

  const page = await adapter.readPageState(tabId);
  return {
    hasLoginMarkers: /(log in|sign in|password)/i.test(page.text),
    hasAuthMarkers: /(logout|sign out|logged in|signed in|my account|dashboard|welcome|profile)/i.test(page.text),
    url: page.url,
    title: page.title,
  };
}

export async function extractStructuredData(
  adapter: WebIntentHelperAdapter,
  tabId?: string,
): Promise<{
  url: string;
  title: string;
  heading: string;
  excerpt: string;
  keyValues: Array<{ key: string; value: string }>;
}> {
  const result = await adapter.executeInPage(`
    (() => {
      /* __WEB_INTENT_EXTRACT__ */
      const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const pairs = [];

      document.querySelectorAll('dl').forEach((list) => {
        const terms = Array.from(list.querySelectorAll('dt'));
        for (const term of terms) {
          const key = clean(term.textContent || '');
          const next = term.nextElementSibling;
          if (!key || !next || next.tagName.toLowerCase() !== 'dd') continue;
          const value = clean(next.textContent || '');
          if (value) pairs.push({ key, value });
        }
      });

      document.querySelectorAll('table').forEach((table) => {
        const rows = Array.from(table.querySelectorAll('tr'));
        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll('th,td'));
          if (cells.length < 2) continue;
          const key = clean(cells[0]?.textContent || '');
          const value = clean(cells[1]?.textContent || '');
          if (key && value) pairs.push({ key, value });
        }
      });

      document.querySelectorAll('[data-label]').forEach((node) => {
        const key = clean(node.getAttribute('data-label') || '');
        const value = clean(node.textContent || '');
        if (key && value) pairs.push({ key, value });
      });

      const heading = clean(document.querySelector('h1')?.textContent || document.title || '');
      const text = clean(document.body?.innerText || '');
      return {
        url: location.href,
        title: clean(document.title || ''),
        heading,
        excerpt: text.slice(0, 500),
        keyValues: pairs.slice(0, 80),
      };
    })()
  `, tabId);

  if (!result.error && result.result && typeof result.result === 'object') {
    const raw = result.result as Record<string, unknown>;
    return {
      url: typeof raw.url === 'string' ? raw.url : '',
      title: typeof raw.title === 'string' ? raw.title : '',
      heading: typeof raw.heading === 'string' ? raw.heading : '',
      excerpt: typeof raw.excerpt === 'string' ? raw.excerpt : '',
      keyValues: Array.isArray(raw.keyValues)
        ? raw.keyValues
          .map((item) => asObject(item))
          .map(item => ({
            key: String(item.key || '').trim(),
            value: String(item.value || '').trim(),
          }))
          .filter(item => item.key && item.value)
        : [],
    };
  }

  const page = await adapter.readPageState(tabId);
  return {
    url: page.url,
    title: page.title,
    heading: page.mainHeading || page.title,
    excerpt: page.text.slice(0, 500),
    keyValues: [],
  };
}

export function selectRequestedFields(
  fields: string[],
  extracted: { keyValues: Array<{ key: string; value: string }>; excerpt: string },
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    const match = extracted.keyValues.find(pair => {
      return includesText(pair.key, field) || includesText(field, pair.key);
    });
    if (match) {
      out[field] = match.value;
      continue;
    }
    const re = new RegExp(`${escapeRegex(field)}\\s*[:\\-]\\s*([^\\n.,;]{1,140})`, 'i');
    const found = extracted.excerpt.match(re);
    if (found?.[1]) out[field] = found[1].trim();
  }
  return out;
}

export async function readCartState(adapter: WebIntentHelperAdapter, tabId?: string): Promise<{ count: number | null; hasRemove: boolean }> {
  const probe = await adapter.executeInPage(`
    (() => {
      const badge = document.querySelector('.shopping_cart_badge,[data-test*="shopping-cart-badge"],[aria-label*="cart"] .badge');
      const badgeText = badge?.textContent?.trim() || '';
      const parsed = Number.parseInt(badgeText, 10);
      const count = Number.isFinite(parsed) ? parsed : null;
      const bodyText = (document.body?.innerText || '').toLowerCase();
      const hasRemove = /\\bremove\\b/.test(bodyText);
      return { count, hasRemove };
    })()
  `, tabId);
  if (!probe.error && probe.result && typeof probe.result === 'object') {
    const raw = probe.result as Record<string, unknown>;
    return {
      count: typeof raw.count === 'number' && Number.isFinite(raw.count) ? raw.count : null,
      hasRemove: raw.hasRemove === true,
    };
  }
  return { count: null, hasRemove: false };
}

export async function resolveHoverTargetFromDom(
  adapter: WebIntentHelperAdapter,
  targetText: string,
  tabId?: string,
): Promise<{ selector: string | null; label: string }> {
  const probe = await adapter.executeInPage(`
    (() => {
      const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
      const isVisible = (el) => {
        if (!(el instanceof Element)) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const semanticHoverNode = el.hasAttribute('data-hover-target');
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && ((rect.width > 0 && rect.height > 0) || semanticHoverNode);
      };
      const escapeCss = (value) => {
        if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value));
        return String(value).replace(/([ #;?%&,.+*~\\':\"!^$[\\]()=>|\\/@])/g, '\\\\$1');
      };
      const cssPath = (el) => {
        if (!(el instanceof Element)) return '';
        if (el.id) return '#' + escapeCss(el.id);
        const dataTest = el.getAttribute('data-test') || el.getAttribute('data-testid');
        if (dataTest) return '[' + (el.hasAttribute('data-test') ? 'data-test' : 'data-testid') + '="' + escapeCss(dataTest) + '"]';
        const parts = [];
        let node = el;
        while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
          let selector = node.tagName.toLowerCase();
          const parent = node.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter(child => child.tagName === node.tagName);
            if (siblings.length > 1) selector += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
          }
          parts.unshift(selector);
          node = parent;
        }
        return parts.join(' > ');
      };
      const labelOf = (el) => clean([
        el.getAttribute('aria-label') || '',
        el.getAttribute('data-label') || '',
        el.getAttribute('data-test') || '',
        el.getAttribute('data-testid') || '',
        el.getAttribute('title') || '',
        el.id || '',
        el.className && typeof el.className === 'string' ? el.className : '',
        el.textContent || '',
      ].join(' '));
      const needle = ${JSON.stringify(targetText)}.toLowerCase();
      const hoverRe = /hover|profile|figure|card|image|avatar|tooltip|menu|caption|user/i;
      const nodes = Array.from(document.querySelectorAll('[data-hover-target],.figure,figure,[class*="hover"],[class*="profile"],[class*="card"],img,a,button,[role="button"],div,section'))
        .filter(isVisible);
      const best = nodes
        .map((el, index) => {
          const label = labelOf(el);
          const lower = label.toLowerCase();
          let score = 0;
          if (needle && lower.includes(needle)) score += 10;
          if (hoverRe.test(label)) score += 5;
          if (el.matches('.figure,figure,[data-hover-target]')) score += 6;
          if (el.querySelector && el.querySelector('.figcaption,[class*="caption"],[role="tooltip"]')) score += 4;
          if (/first|1|one/i.test(needle) && index === 0) score += 3;
          return { el, label, score };
        })
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)[0];
      return {
        selector: best ? cssPath(best.el) : null,
        label: best ? best.label : ${JSON.stringify(targetText)},
      };
    })()
  `, tabId);

  if (!probe.error && probe.result && typeof probe.result === 'object') {
    const raw = probe.result as Record<string, unknown>;
    return {
      selector: typeof raw.selector === 'string' && raw.selector ? raw.selector : null,
      label: typeof raw.label === 'string' && raw.label ? raw.label : targetText,
    };
  }

  return { selector: null, label: targetText };
}

export async function resolveDragDropTargetsFromDom(
  adapter: WebIntentHelperAdapter,
  sourceText: string,
  targetText: string,
  tabId?: string,
): Promise<{
  sourceSelector: string | null;
  targetSelector: string | null;
  sourceLabel: string;
  targetLabel: string;
}> {
  const probe = await adapter.executeInPage(`
    (() => {
      const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
      const isVisible = (el) => {
        if (!(el instanceof Element)) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const semanticDragNode = el.hasAttribute('data-drag-source')
          || el.hasAttribute('data-drop-target')
          || el.getAttribute('draggable') === 'true'
          || el.getAttribute('data-droppable') === 'true';
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && ((rect.width > 0 && rect.height > 0) || semanticDragNode);
      };
      const escapeCss = (value) => {
        if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value));
        return String(value).replace(/([ #;?%&,.+*~\\':\"!^$[\\]()=>|\\/@])/g, '\\\\$1');
      };
      const cssPath = (el) => {
        if (!(el instanceof Element)) return '';
        if (el.id) return '#' + escapeCss(el.id);
        const dataTest = el.getAttribute('data-test') || el.getAttribute('data-testid');
        if (dataTest) return '[' + (el.hasAttribute('data-test') ? 'data-test' : 'data-testid') + '="' + escapeCss(dataTest) + '"]';
        const parts = [];
        let node = el;
        while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
          let selector = node.tagName.toLowerCase();
          const parent = node.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter(child => child.tagName === node.tagName);
            if (siblings.length > 1) selector += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
          }
          parts.unshift(selector);
          node = parent;
        }
        return parts.join(' > ');
      };
      const labelOf = (el) => clean([
        el.getAttribute('aria-label') || '',
        el.getAttribute('data-label') || '',
        el.getAttribute('data-test') || '',
        el.getAttribute('data-testid') || '',
        el.getAttribute('title') || '',
        el.id || '',
        el.className && typeof el.className === 'string' ? el.className : '',
        el.textContent || '',
      ].join(' '));
      const sourceNeedle = ${JSON.stringify(sourceText)}.toLowerCase();
      const targetNeedle = ${JSON.stringify(targetText)}.toLowerCase();
      const sourceBroadRe = /drag|circle|ball|token|item|source/i;
      const targetBroadRe = /drop|target|can|bin|basket|zone|destination/i;
      const sourceNodes = Array.from(document.querySelectorAll('[draggable="true"],[data-draggable="true"],[data-drag-source],.draggable,.circle,[class*="circle"],svg circle,button,[role="button"],div,span'))
        .filter(isVisible);
      const targetNodes = Array.from(document.querySelectorAll('[data-drop-target],[data-droppable="true"],.dropzone,.drop-zone,[class*="drop"],[class*="target"],[class*="can"],[aria-label],div,section'))
        .filter(isVisible);
      const score = (el, needle, broadRe, kind) => {
        const label = labelOf(el);
        const lower = label.toLowerCase();
        let value = 0;
        if (needle && lower.includes(needle)) value += 10;
        if (broadRe.test(label)) value += 5;
        if (kind === 'source' && el.getAttribute('draggable') === 'true') value += 6;
        if (kind === 'target' && (el.hasAttribute('data-drop-target') || el.getAttribute('data-droppable') === 'true')) value += 6;
        if (kind === 'source' && el.tagName.toLowerCase() === 'circle') value += 5;
        const rect = el.getBoundingClientRect();
        if (rect.width > 8 && rect.height > 8) value += 1;
        return { el, label, value };
      };
      const source = sourceNodes
        .map(el => score(el, sourceNeedle, sourceBroadRe, 'source'))
        .filter(item => item.value > 0)
        .sort((a, b) => b.value - a.value)[0];
      const target = targetNodes
        .map(el => score(el, targetNeedle, targetBroadRe, 'target'))
        .filter(item => item.value > 0 && item.el !== source?.el)
        .sort((a, b) => b.value - a.value)[0];

      return {
        sourceSelector: source ? cssPath(source.el) : null,
        targetSelector: target ? cssPath(target.el) : null,
        sourceLabel: source ? source.label : ${JSON.stringify(sourceText)},
        targetLabel: target ? target.label : ${JSON.stringify(targetText)},
      };
    })()
  `, tabId);

  if (!probe.error && probe.result && typeof probe.result === 'object') {
    const raw = probe.result as Record<string, unknown>;
    return {
      sourceSelector: typeof raw.sourceSelector === 'string' && raw.sourceSelector ? raw.sourceSelector : null,
      targetSelector: typeof raw.targetSelector === 'string' && raw.targetSelector ? raw.targetSelector : null,
      sourceLabel: typeof raw.sourceLabel === 'string' && raw.sourceLabel ? raw.sourceLabel : sourceText,
      targetLabel: typeof raw.targetLabel === 'string' && raw.targetLabel ? raw.targetLabel : targetText,
    };
  }

  return {
    sourceSelector: null,
    targetSelector: null,
    sourceLabel: sourceText,
    targetLabel: targetText,
  };
}

export async function resolveLoginTargetsFromDom(
  adapter: WebIntentHelperAdapter,
  tabId?: string,
): Promise<LoginTargets> {
  const probe = await adapter.executeInPage(`
    (() => {
      const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const cssPath = (el) => {
        if (!(el instanceof Element)) return '';
        if (el.id) return '#' + CSS.escape(el.id);
        const parts = [];
        let node = el;
        while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
          let selector = node.tagName.toLowerCase();
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
      const fieldLabel = (field) => clean([
        field.getAttribute('aria-label') || '',
        field.getAttribute('name') || '',
        field.getAttribute('id') || '',
        field.getAttribute('placeholder') || '',
        (field.id ? document.querySelector('label[for="' + CSS.escape(field.id) + '"]')?.textContent : '') || '',
      ].join(' '));
      const userRe = /email|e-mail|username|user|login/i;
        const submitRe = /sign in|log in|login|continue|submit|next/i;

      const forms = Array.from(document.querySelectorAll('form'));
      const formCandidates = forms
        .filter(form => form instanceof HTMLElement && isVisible(form))
        .map((form) => {
          const inputs = Array.from(form.querySelectorAll('input,textarea,select')).filter(node => node instanceof HTMLElement && isVisible(node));
          const password = inputs.find(node => node instanceof HTMLInputElement && (node.type || '').toLowerCase() === 'password');
          const username = inputs.find((node) => {
            if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) return false;
            const type = node instanceof HTMLInputElement ? (node.type || '').toLowerCase() : 'text';
            if (type === 'password' || type === 'hidden') return false;
            return userRe.test(fieldLabel(node)) || type === 'email' || type === 'text';
          });
          const submit = Array.from(form.querySelectorAll('button,input[type="submit"],[role="button"]'))
            .find(node => node instanceof HTMLElement && isVisible(node) && submitRe.test(clean(node.textContent || node.getAttribute('value') || node.getAttribute('aria-label') || '')));
          let score = 0;
            if (password) score += 5;
          if (username) score += 4;
          if (submit) score += 2;
          if (/login|sign/i.test(clean(form.getAttribute('aria-label') || form.id || form.className || ''))) score += 2;
          return {
            selector: cssPath(form),
            usernameSelector: username ? cssPath(username) : '',
            passwordSelector: password ? cssPath(password) : '',
            submitSelector: submit ? cssPath(submit) : '',
            score,
          };
        })
        .sort((a, b) => b.score - a.score);

      const bestForm = formCandidates[0];
      if (bestForm && bestForm.passwordSelector && bestForm.usernameSelector) {
        return {
          usernameSelector: bestForm.usernameSelector,
          passwordSelector: bestForm.passwordSelector,
          submitSelector: bestForm.submitSelector || null,
          formSelector: bestForm.selector || null,
        };
      }

      const allInputs = Array.from(document.querySelectorAll('input,textarea,select')).filter(node => node instanceof HTMLElement && isVisible(node));
      const username = allInputs.find((node) => {
        if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) return false;
        const type = node instanceof HTMLInputElement ? (node.type || '').toLowerCase() : 'text';
        if (type === 'password' || type === 'hidden') return false;
        return userRe.test(fieldLabel(node)) || type === 'email' || type === 'text';
      });
      const password = allInputs.find((node) => node instanceof HTMLInputElement && (node.type || '').toLowerCase() === 'password');
      const submit = Array.from(document.querySelectorAll('button,input[type="submit"],[role="button"]'))
        .find(node => node instanceof HTMLElement && isVisible(node) && submitRe.test(clean(node.textContent || node.getAttribute('value') || node.getAttribute('aria-label') || '')));

      return {
        usernameSelector: username ? cssPath(username) : null,
        passwordSelector: password ? cssPath(password) : null,
        submitSelector: submit ? cssPath(submit) : null,
        formSelector: null,
      };
    })()
  `, tabId);

  if (!probe.error && probe.result && typeof probe.result === 'object') {
    const raw = probe.result as Record<string, unknown>;
    return {
      usernameSelector: typeof raw.usernameSelector === 'string' && raw.usernameSelector ? raw.usernameSelector : null,
      passwordSelector: typeof raw.passwordSelector === 'string' && raw.passwordSelector ? raw.passwordSelector : null,
      submitSelector: typeof raw.submitSelector === 'string' && raw.submitSelector ? raw.submitSelector : null,
      formSelector: typeof raw.formSelector === 'string' && raw.formSelector ? raw.formSelector : null,
    };
  }

  return {
    usernameSelector: null,
    passwordSelector: null,
    submitSelector: null,
    formSelector: null,
  };
}

export async function resolveCheckoutInfoTargetsFromDom(
  adapter: WebIntentHelperAdapter,
  tabId?: string,
): Promise<CheckoutInfoTargets> {
  const probe = await adapter.executeInPage(`
    (() => {
      const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const cssPath = (el) => {
        if (!(el instanceof Element)) return '';
        if (el.id) return '#' + CSS.escape(el.id);
        const parts = [];
        let node = el;
        while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
          let selector = node.tagName.toLowerCase();
          const parent = node.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter(child => child.tagName === node.tagName);
            if (siblings.length > 1) selector += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
          }
          parts.unshift(selector);
          node = parent;
        }
        return parts.join(' > ');
      };
      const labelOf = (field) => clean([
        field.getAttribute('aria-label') || '',
        field.getAttribute('name') || '',
        field.getAttribute('id') || '',
        field.getAttribute('placeholder') || '',
        (field.id ? document.querySelector('label[for="' + CSS.escape(field.id) + '"]')?.textContent : '') || '',
      ].join(' '));
      const firstRe = /first name|firstname|given name|first/i;
      const lastRe = /last name|lastname|surname|family name|last/i;
      const postalRe = /postal|zip|zipcode|zip code|postcode/i;
      const continueRe = /continue|next|review|proceed/i;

      const forms = Array.from(document.querySelectorAll('form'));
      const best = forms
        .filter(form => form instanceof HTMLElement && isVisible(form))
        .map((form) => {
          const fields = Array.from(form.querySelectorAll('input,textarea,select')).filter(node => node instanceof HTMLElement && isVisible(node));
          const first = fields.find(node => firstRe.test(labelOf(node)));
          const last = fields.find(node => lastRe.test(labelOf(node)));
          const postal = fields.find(node => postalRe.test(labelOf(node)));
          const submit = Array.from(form.querySelectorAll('button,input[type="submit"],[role="button"]'))
            .find(node => node instanceof HTMLElement && isVisible(node) && continueRe.test(clean(node.textContent || node.getAttribute('value') || node.getAttribute('aria-label') || '')));
          let score = 0;
          if (first) score += 4;
          if (last) score += 4;
          if (postal) score += 4;
          if (submit) score += 2;
          return {
            formSelector: cssPath(form),
            firstNameSelector: first ? cssPath(first) : '',
            lastNameSelector: last ? cssPath(last) : '',
            postalSelector: postal ? cssPath(postal) : '',
            submitSelector: submit ? cssPath(submit) : '',
            score,
          };
        })
        .sort((a, b) => b.score - a.score)[0];

      if (best && best.firstNameSelector && best.lastNameSelector && best.postalSelector) {
        return {
          firstNameSelector: best.firstNameSelector,
          lastNameSelector: best.lastNameSelector,
          postalSelector: best.postalSelector,
          submitSelector: best.submitSelector || null,
          formSelector: best.formSelector || null,
        };
      }

      return {
        firstNameSelector: null,
        lastNameSelector: null,
        postalSelector: null,
        submitSelector: null,
        formSelector: null,
      };
    })()
  `, tabId);

  if (!probe.error && probe.result && typeof probe.result === 'object') {
    const raw = probe.result as Record<string, unknown>;
    return {
      firstNameSelector: typeof raw.firstNameSelector === 'string' && raw.firstNameSelector ? raw.firstNameSelector : null,
      lastNameSelector: typeof raw.lastNameSelector === 'string' && raw.lastNameSelector ? raw.lastNameSelector : null,
      postalSelector: typeof raw.postalSelector === 'string' && raw.postalSelector ? raw.postalSelector : null,
      submitSelector: typeof raw.submitSelector === 'string' && raw.submitSelector ? raw.submitSelector : null,
      formSelector: typeof raw.formSelector === 'string' && raw.formSelector ? raw.formSelector : null,
    };
  }

  return {
    firstNameSelector: null,
    lastNameSelector: null,
    postalSelector: null,
    submitSelector: null,
    formSelector: null,
  };
}
