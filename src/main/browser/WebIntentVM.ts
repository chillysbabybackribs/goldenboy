import { BrowserActionableElement, BrowserFormFieldModel, BrowserFormModel } from '../../shared/types/browserIntelligence';

export type WebIntentOpcode =
  | 'NAVIGATE'
  | 'WAIT'
  | 'ASSERT'
  | 'INTENT.LOGIN'
  | 'INTENT.UPLOAD'
  | 'INTENT.CHECKOUT'
  | 'INTENT.EXTRACT';

export type WebIntentInstruction = {
  op: WebIntentOpcode | string;
  args?: Record<string, unknown>;
};

export type WebIntentProgram = {
  instructions: WebIntentInstruction[];
  tabId?: string;
  failFast?: boolean;
};

export type WebIntentStepResult = {
  index: number;
  op: string;
  status: 'ok' | 'failed';
  durationMs: number;
  evidence: string;
  data?: Record<string, unknown>;
  error?: string;
};

export type WebIntentRunResult = {
  success: boolean;
  steps: WebIntentStepResult[];
  extracted: Array<Record<string, unknown>>;
  finalUrl: string;
  failedAt: number | null;
};

export type WebIntentPageState = {
  url: string;
  title: string;
  text: string;
  mainHeading?: string;
};

export type WebIntentAdapter = {
  navigate: (url: string, tabId?: string) => Promise<void>;
  waitForSettled: (timeoutMs?: number) => Promise<void>;
  getCurrentUrl: (tabId?: string) => Promise<string>;
  readPageState: (tabId?: string) => Promise<WebIntentPageState>;
  getActionableElements: (tabId?: string) => Promise<BrowserActionableElement[]>;
  getFormModel: (tabId?: string) => Promise<BrowserFormModel[]>;
  click: (selector: string, tabId?: string) => Promise<{ clicked: boolean; error: string | null }>;
  type: (selector: string, text: string, tabId?: string) => Promise<{ typed: boolean; error: string | null }>;
  executeInPage: (expression: string, tabId?: string) => Promise<{ result: unknown; error: string | null }>;
};

const LOGIN_USER_RE = /\b(email|e-mail|username|user|login)\b/i;
const LOGIN_PASSWORD_RE = /\bpassword|passcode|pin\b/i;
const LOGIN_SUBMIT_RE = /\b(sign in|log in|login|continue|submit|next)\b/i;
const UPLOAD_FIELD_RE = /\b(file|upload|attachment|document|csv|path)\b/i;
const UPLOAD_BUTTON_RE = /\b(upload|attach|import|submit file|send file)\b/i;
const CHECKOUT_BUTTON_RE = /\b(checkout|pay now|place order|complete order|buy now|submit order)\b/i;
const CHECKOUT_SUCCESS_RE = /\b(order complete|order confirmed|thank you|receipt|purchase complete|success)\b/i;
const TEXT_NORMALIZE_RE = /\s+/g;

function textOfElement(element: BrowserActionableElement): string {
  return `${element.text || ''} ${element.ariaLabel || ''} ${element.role || ''}`.replace(TEXT_NORMALIZE_RE, ' ').trim();
}

function includesText(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function requiredString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Expected non-empty string: ${key}`);
  }
  return value.trim();
}

function optionalString(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalNumber(obj: Record<string, unknown>, key: string, fallback: number): number {
  const value = obj[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeOp(op: string): WebIntentOpcode {
  const upper = op.trim().toUpperCase();
  switch (upper) {
    case 'NAVIGATE':
    case 'WAIT':
    case 'ASSERT':
    case 'INTENT.LOGIN':
    case 'INTENT.UPLOAD':
    case 'INTENT.CHECKOUT':
    case 'INTENT.EXTRACT':
      return upper;
    default:
      throw new Error(`Unsupported intent opcode: ${op}`);
  }
}

function findBestForm(forms: BrowserFormModel[], scorer: (form: BrowserFormModel) => number): BrowserFormModel | null {
  let best: BrowserFormModel | null = null;
  let bestScore = -1;
  for (const form of forms) {
    const score = scorer(form);
    if (score > bestScore) {
      bestScore = score;
      best = form;
    }
  }
  return bestScore > 0 ? best : null;
}

function scoreLoginForm(form: BrowserFormModel): number {
  let score = 0;
  const purpose = (form.purpose || '').toLowerCase();
  if (purpose.includes('login') || purpose.includes('sign')) score += 3;
  for (const field of form.fields) {
    const label = `${field.label} ${field.name} ${field.placeholder}`;
    if (field.kind === 'password' || LOGIN_PASSWORD_RE.test(label)) score += 4;
    if (field.kind === 'email' || LOGIN_USER_RE.test(label)) score += 3;
    if (field.visible) score += 1;
  }
  for (const submit of form.submitLabels) {
    if (LOGIN_SUBMIT_RE.test(submit)) score += 2;
  }
  return score;
}

function scoreUploadForm(form: BrowserFormModel): number {
  let score = 0;
  for (const field of form.fields) {
    const label = `${field.label} ${field.name} ${field.placeholder}`;
    if (UPLOAD_FIELD_RE.test(label)) score += 3;
    if (field.visible) score += 1;
  }
  for (const submit of form.submitLabels) {
    if (UPLOAD_BUTTON_RE.test(submit)) score += 3;
  }
  return score;
}

function findField(fields: BrowserFormFieldModel[], matcher: (field: BrowserFormFieldModel) => boolean): BrowserFormFieldModel | null {
  for (const field of fields) {
    if (!field.visible) continue;
    if (!field.ref?.selector) continue;
    if (matcher(field)) return field;
  }
  return null;
}

function findBestAction(
  elements: BrowserActionableElement[],
  regex: RegExp,
): BrowserActionableElement | null {
  const candidates = elements
    .filter(el => el.visible && el.enabled && !!el.ref?.selector)
    .map((el) => {
      const haystack = textOfElement(el);
      let score = 0;
      if (el.actionability.includes('clickable')) score += 3;
      if (el.tagName === 'button') score += 2;
      if (regex.test(haystack)) score += 5;
      return { el, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.el || null;
}

function compact(input: string, max = 180): string {
  const text = input.replace(TEXT_NORMALIZE_RE, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

type AuthState = {
  hasLoginMarkers: boolean;
  hasAuthMarkers: boolean;
  url: string;
  title: string;
};

type LoginTargets = {
  usernameSelector: string | null;
  passwordSelector: string | null;
  submitSelector: string | null;
  formSelector: string | null;
};

export class WebIntentVM {
  constructor(private readonly adapter: WebIntentAdapter) {}

  async run(program: WebIntentProgram): Promise<WebIntentRunResult> {
    const instructions = Array.isArray(program.instructions) ? program.instructions : [];
    if (instructions.length === 0) throw new Error('Intent program must include at least one instruction');
    const failFast = program.failFast !== false;
    const tabId = program.tabId;

    const steps: WebIntentStepResult[] = [];
    const extracted: Array<Record<string, unknown>> = [];
    let failedAt: number | null = null;

    for (let index = 0; index < instructions.length; index++) {
      const instruction = instructions[index] || { op: 'WAIT', args: {} };
      const started = Date.now();
      try {
        const op = normalizeOp(String(instruction.op || ''));
        const data = await this.executeInstruction(op, asObject(instruction.args), tabId);
        if (op === 'INTENT.EXTRACT') extracted.push(data);
        steps.push({
          index,
          op,
          status: 'ok',
          durationMs: Date.now() - started,
          evidence: compact(String(data.evidence || 'step completed')),
          data,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        steps.push({
          index,
          op: String(instruction.op || ''),
          status: 'failed',
          durationMs: Date.now() - started,
          evidence: compact(message),
          error: message,
        });
        failedAt = index;
        if (failFast) break;
      }
    }

    const finalUrl = await this.adapter.getCurrentUrl(tabId);
    return {
      success: failedAt === null,
      steps,
      extracted,
      finalUrl,
      failedAt,
    };
  }

  private async executeInstruction(
    op: WebIntentOpcode,
    args: Record<string, unknown>,
    tabId?: string,
  ): Promise<Record<string, unknown>> {
    switch (op) {
      case 'NAVIGATE':
        return this.executeNavigate(args, tabId);
      case 'WAIT':
        return this.executeWait(args, tabId);
      case 'ASSERT':
        return this.executeAssert(args, tabId);
      case 'INTENT.LOGIN':
        return this.executeLogin(args, tabId);
      case 'INTENT.UPLOAD':
        return this.executeUpload(args, tabId);
      case 'INTENT.CHECKOUT':
        return this.executeCheckout(tabId);
      case 'INTENT.EXTRACT':
        return this.executeExtract(args, tabId);
      default:
        throw new Error(`Unsupported opcode: ${op}`);
    }
  }

  private async executeNavigate(args: Record<string, unknown>, tabId?: string): Promise<Record<string, unknown>> {
    const url = requiredString(args, 'url');
    await this.adapter.navigate(url, tabId);
    await this.adapter.waitForSettled(optionalNumber(args, 'timeoutMs', 10_000));
    const state = await this.adapter.readPageState(tabId);
    return {
      url: state.url,
      title: state.title,
      evidence: `Navigated to ${state.url || url}`,
    };
  }

  private async executeWait(args: Record<string, unknown>, tabId?: string): Promise<Record<string, unknown>> {
    const timeoutMs = optionalNumber(args, 'timeoutMs', 2_000);
    await this.adapter.waitForSettled(timeoutMs);
    const state = await this.adapter.readPageState(tabId);
    return {
      url: state.url,
      evidence: `Waited ${timeoutMs}ms`,
    };
  }

  private async executeAssert(args: Record<string, unknown>, tabId?: string): Promise<Record<string, unknown>> {
    const kind = (optionalString(args, 'kind') || optionalString(args, 'type') || '').toLowerCase();
    if (!kind) throw new Error('ASSERT requires kind');

    if (kind === 'text_present') {
      const text = requiredString(args, 'text');
      const page = await this.adapter.readPageState(tabId);
      const matched = includesText(page.text, text) || includesText(page.title, text);
      if (!matched) throw new Error(`ASSERT text_present failed: "${text}" not found`);
      return { matched, text, evidence: `Found text "${text}"` };
    }

    if (kind === 'url_includes') {
      const part = requiredString(args, 'value');
      const url = await this.adapter.getCurrentUrl(tabId);
      const matched = includesText(url, part);
      if (!matched) throw new Error(`ASSERT url_includes failed: "${part}" not in ${url}`);
      return { matched, url, value: part, evidence: `URL includes "${part}"` };
    }

    if (kind === 'element_present') {
      const query = requiredString(args, 'query');
      const elements = await this.adapter.getActionableElements(tabId);
      const match = elements.find(el => includesText(textOfElement(el), query));
      if (!match) throw new Error(`ASSERT element_present failed: no element for "${query}"`);
      return {
        matched: true,
        query,
        selector: match.ref.selector,
        evidence: `Found element for "${query}"`,
      };
    }

    if (kind === 'logged_in') {
      const auth = await this.readAuthState(tabId);
      const matched = auth.hasAuthMarkers || !auth.hasLoginMarkers;
      if (!matched) throw new Error(`ASSERT logged_in failed on ${auth.url}`);
      return {
        matched,
        url: auth.url,
        title: auth.title,
        evidence: 'Login state confirmed',
      };
    }

    throw new Error(`Unknown ASSERT kind: ${kind}`);
  }

  private async executeLogin(args: Record<string, unknown>, tabId?: string): Promise<Record<string, unknown>> {
    const username = optionalString(args, 'username') || optionalString(args, 'email') || optionalString(args, 'user');
    const password = optionalString(args, 'password');
    const successText = optionalString(args, 'successText');
    if (!username || !password) {
      throw new Error('INTENT.LOGIN requires username/email and password');
    }

    const forms = await this.adapter.getFormModel(tabId);
    const loginForm = findBestForm(forms, scoreLoginForm);

    const userField = loginForm
      ? (findField(loginForm.fields, (field) => (
        field.kind === 'email'
        || (field.kind !== 'password' && LOGIN_USER_RE.test(`${field.label} ${field.name} ${field.placeholder}`))
      )) || findField(loginForm.fields, (field) => field.kind === 'text' || field.kind === 'email'))
      : null;
    const passField = loginForm
      ? findField(loginForm.fields, (field) => (
        field.kind === 'password'
        || LOGIN_PASSWORD_RE.test(`${field.label} ${field.name} ${field.placeholder}`)
      ))
      : null;

    const fallbackTargets = await this.resolveLoginTargetsFromDom(tabId);
    const usernameSelector = userField?.ref.selector || fallbackTargets.usernameSelector;
    const passwordSelector = passField?.ref.selector || fallbackTargets.passwordSelector;
    const submitSelector = fallbackTargets.submitSelector;
    const formSelector = loginForm?.formRef?.selector || fallbackTargets.formSelector;

    if (!usernameSelector || !passwordSelector) {
      throw new Error('Could not resolve login form fields');
    }

    const userType = await this.adapter.type(usernameSelector, username, tabId);
    if (!userType.typed) throw new Error(userType.error || 'Typing username failed');
    const passType = await this.adapter.type(passwordSelector, password, tabId);
    if (!passType.typed) throw new Error(passType.error || 'Typing password failed');

    const actions = await this.adapter.getActionableElements(tabId);
    const rankedSubmit = findBestAction(actions, LOGIN_SUBMIT_RE);
    const clickSelector = rankedSubmit?.ref.selector || submitSelector;
    if (clickSelector) {
      const click = await this.adapter.click(clickSelector, tabId);
      if (!click.clicked) throw new Error(click.error || 'Could not click login submit action');
    } else if (formSelector) {
      const escaped = JSON.stringify(formSelector);
      await this.adapter.executeInPage(`
        (() => {
          const form = document.querySelector(${escaped});
          if (!(form instanceof HTMLFormElement)) return false;
          if (typeof form.requestSubmit === 'function') form.requestSubmit();
          else form.submit();
          return true;
        })()
      `, tabId);
    } else {
      throw new Error('Could not resolve login submit action');
    }

    await this.adapter.waitForSettled(8_000);
    const auth = await this.readAuthState(tabId);
    const page = await this.adapter.readPageState(tabId);
    const explicitSuccess = successText ? includesText(page.text, successText) : false;
    const ok = explicitSuccess || auth.hasAuthMarkers || !auth.hasLoginMarkers;
    if (!ok) throw new Error(`Login postcondition failed at ${auth.url}`);
    return {
      url: auth.url,
      title: auth.title,
      usernameField: usernameSelector,
      passwordField: passwordSelector,
      submitField: clickSelector || formSelector || null,
      evidence: `Login succeeded on ${auth.url}`,
    };
  }

  private async executeUpload(args: Record<string, unknown>, tabId?: string): Promise<Record<string, unknown>> {
    const filePath = optionalString(args, 'filePath') || optionalString(args, 'path');
    if (!filePath) throw new Error('INTENT.UPLOAD requires filePath');

    const forms = await this.adapter.getFormModel(tabId);
    const uploadForm = findBestForm(forms, scoreUploadForm);
    if (!uploadForm) throw new Error('Could not find an upload form');

    const fileField = findField(uploadForm.fields, (field) => (
      UPLOAD_FIELD_RE.test(`${field.label} ${field.name} ${field.placeholder}`)
      && field.kind !== 'password'
    ));
    if (!fileField?.ref.selector) throw new Error('Could not resolve upload field');
    const typed = await this.adapter.type(fileField.ref.selector, filePath, tabId);
    if (!typed.typed) throw new Error(typed.error || 'Typing upload field failed');

    const actions = await this.adapter.getActionableElements(tabId);
    const uploadAction = findBestAction(actions, UPLOAD_BUTTON_RE);
    if (!uploadAction?.ref.selector) throw new Error('Could not resolve upload action');
    const click = await this.adapter.click(uploadAction.ref.selector, tabId);
    if (!click.clicked) throw new Error(click.error || 'Could not click upload action');

    await this.adapter.waitForSettled(6_000);
    const page = await this.adapter.readPageState(tabId);
    const ok = /\b(uploaded|attached|imported|success)\b/i.test(page.text);
    if (!ok) throw new Error('Upload postcondition failed: no upload confirmation text found');
    return {
      url: page.url,
      uploadField: fileField.ref.selector,
      uploadAction: uploadAction.ref.selector,
      evidence: `Upload confirmed for ${filePath}`,
    };
  }

  private async executeCheckout(tabId?: string): Promise<Record<string, unknown>> {
    const actions = await this.adapter.getActionableElements(tabId);
    const checkoutAction = findBestAction(actions, CHECKOUT_BUTTON_RE);
    if (!checkoutAction?.ref.selector) throw new Error('Could not resolve checkout action');
    const click = await this.adapter.click(checkoutAction.ref.selector, tabId);
    if (!click.clicked) throw new Error(click.error || 'Could not click checkout action');

    await this.adapter.waitForSettled(8_000);
    const page = await this.adapter.readPageState(tabId);
    if (!CHECKOUT_SUCCESS_RE.test(page.text)) {
      throw new Error('Checkout postcondition failed: no confirmation text found');
    }
    return {
      url: page.url,
      action: checkoutAction.ref.selector,
      evidence: 'Checkout confirmation observed',
    };
  }

  private async executeExtract(args: Record<string, unknown>, tabId?: string): Promise<Record<string, unknown>> {
    const requestedFields = Array.isArray(args.fields)
      ? args.fields.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];

    const extracted = await this.extractStructuredData(tabId);
    const selected = requestedFields.length > 0
      ? this.selectRequestedFields(requestedFields, extracted)
      : {};

    return {
      ...extracted,
      selected,
      evidence: requestedFields.length > 0
        ? `Extracted ${Object.keys(selected).length} requested fields`
        : `Extracted ${extracted.keyValues.length} key/value pairs`,
    };
  }

  private async readAuthState(tabId?: string): Promise<AuthState> {
    const probe = await this.adapter.executeInPage(`
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

    const page = await this.adapter.readPageState(tabId);
    return {
      hasLoginMarkers: /(log in|sign in|password)/i.test(page.text),
      hasAuthMarkers: /(logout|sign out|logged in|signed in|my account|dashboard|welcome|profile)/i.test(page.text),
      url: page.url,
      title: page.title,
    };
  }

  private async extractStructuredData(tabId?: string): Promise<{
    url: string;
    title: string;
    heading: string;
    excerpt: string;
    keyValues: Array<{ key: string; value: string }>;
  }> {
    const result = await this.adapter.executeInPage(`
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

    const page = await this.adapter.readPageState(tabId);
    return {
      url: page.url,
      title: page.title,
      heading: page.mainHeading || page.title,
      excerpt: page.text.slice(0, 500),
      keyValues: [],
    };
  }

  private selectRequestedFields(
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

  private async resolveLoginTargetsFromDom(tabId?: string): Promise<LoginTargets> {
    const probe = await this.adapter.executeInPage(`
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
        const passRe = /password|passcode|pin/i;
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
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
