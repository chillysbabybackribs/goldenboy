import { BrowserActionableElement, BrowserFormFieldModel, BrowserFormModel } from '../../shared/types/browserIntelligence';

export type WebIntentOpcode =
  | 'NAVIGATE'
  | 'WAIT'
  | 'ASSERT'
  | 'INTENT.LOGIN'
  | 'INTENT.ADD_TO_CART'
  | 'INTENT.OPEN_CART'
  | 'INTENT.FILL_CHECKOUT_INFO'
  | 'INTENT.FINISH_ORDER'
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
const ADD_TO_CART_BUTTON_RE = /\b(add to cart|add item|add)\b/i;
const CART_ACTION_RE = /\b(cart|shopping cart|basket|bag)\b/i;
const ADD_TO_CART_TEXT_RE = /\badd to cart\b/i;
const CHECKOUT_BUTTON_RE = /\b(checkout|pay now|place order|complete order|buy now|submit order)\b/i;
const CHECKOUT_FORM_FIRST_RE = /\b(first name|firstname|given name|first)\b/i;
const CHECKOUT_FORM_LAST_RE = /\b(last name|lastname|surname|family name|last)\b/i;
const CHECKOUT_FORM_POSTAL_RE = /\b(postal|zip|zipcode|zip code|postcode)\b/i;
const CHECKOUT_CONTINUE_RE = /\b(continue|next|review|proceed)\b/i;
const FINISH_ORDER_RE = /\b(finish|place order|complete order|submit order|pay now)\b/i;
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
    case 'INTENT.ADD_TO_CART':
    case 'INTENT.OPEN_CART':
    case 'INTENT.FILL_CHECKOUT_INFO':
    case 'INTENT.FINISH_ORDER':
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

type CheckoutInfoTargets = {
  firstNameSelector: string | null;
  lastNameSelector: string | null;
  postalSelector: string | null;
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
      case 'INTENT.ADD_TO_CART':
        return this.executeAddToCart(args, tabId);
      case 'INTENT.OPEN_CART':
        return this.executeOpenCart(tabId);
      case 'INTENT.FILL_CHECKOUT_INFO':
        return this.executeFillCheckoutInfo(args, tabId);
      case 'INTENT.FINISH_ORDER':
        return this.executeFinishOrder(tabId);
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

  private async executeAddToCart(args: Record<string, unknown>, tabId?: string): Promise<Record<string, unknown>> {
    const item = optionalString(args, 'item')
      || optionalString(args, 'itemName')
      || optionalString(args, 'product')
      || optionalString(args, 'name');

    const before = await this.readCartState(tabId);
    const targetedAdd = await this.adapter.executeInPage(`
      (() => {
        const clean = (v) => String(v || '').replace(/\\s+/g, ' ').trim();
        const isVisible = (el) => {
          if (!(el instanceof HTMLElement)) return false;
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const item = ${JSON.stringify(item || '')}.toLowerCase();
        const addRe = /add to cart|add item|add/i;
        const selectors = 'button,input[type="button"],input[type="submit"],[role="button"]';
        const buttons = Array.from(document.querySelectorAll(selectors)).filter(node => node instanceof HTMLElement && isVisible(node));
        const best = buttons
          .map((btn) => {
            const text = clean(btn.textContent || btn.getAttribute('value') || btn.getAttribute('aria-label') || '');
            if (!addRe.test(text)) return null;
            const container = btn.closest('article,[data-test],section,li,div') || btn.parentElement;
            const context = clean(container?.textContent || '');
            let score = 0;
            if (/add to cart/i.test(text)) score += 4;
            if (item && context.toLowerCase().includes(item)) score += 8;
            if (item && text.toLowerCase().includes(item)) score += 6;
            return { btn, text, context, score };
          })
          .filter((entry) => !!entry)
          .sort((a, b) => b.score - a.score)[0];
        if (!best || !(best.btn instanceof HTMLElement)) return { clicked: false };
        best.btn.click();
        return {
          clicked: true,
          label: best.text,
          itemMatched: item ? best.context.toLowerCase().includes(item) || best.text.toLowerCase().includes(item) : null,
        };
      })()
    `, tabId);

    if (targetedAdd.error) throw new Error(targetedAdd.error);
    const targetedResult = asObject(targetedAdd.result);
    if (targetedResult.clicked !== true) {
      const actions = await this.adapter.getActionableElements(tabId);
      const addAction = findBestAction(actions, ADD_TO_CART_BUTTON_RE);
      if (!addAction?.ref.selector) throw new Error('Could not resolve add-to-cart action');
      const click = await this.adapter.click(addAction.ref.selector, tabId);
      if (!click.clicked) throw new Error(click.error || 'Could not click add-to-cart action');
    }

    await this.adapter.waitForSettled(4_000);
    const after = await this.readCartState(tabId);
    const page = await this.adapter.readPageState(tabId);
    const success = (
      (typeof before.count === 'number' && typeof after.count === 'number' && after.count > before.count)
      || after.hasRemove
      || /\b(remove)\b/i.test(page.text)
    );
    if (!success) {
      throw new Error('Add-to-cart postcondition failed: no cart or UI state change detected');
    }
    return {
      item: item || null,
      cartCountBefore: before.count,
      cartCountAfter: after.count,
      evidence: item
        ? `Added "${item}" to cart`
        : 'Added item to cart',
    };
  }

  private async executeOpenCart(tabId?: string): Promise<Record<string, unknown>> {
    const targetedCart = await this.adapter.executeInPage(`
      (() => {
        const clean = (v) => String(v || '').replace(/\\s+/g, ' ').trim();
        const isVisible = (el) => {
          if (!(el instanceof HTMLElement)) return false;
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const nodes = Array.from(document.querySelectorAll('a[href],button,[role="button"],input[type="button"],input[type="submit"]'));
        const best = nodes
          .filter(node => node instanceof HTMLElement && isVisible(node))
          .map((node) => {
            const href = node.getAttribute('href') || '';
            const text = clean(node.textContent || node.getAttribute('aria-label') || node.getAttribute('value') || '');
            let score = 0;
            if (/cart|basket|bag/i.test(text)) score += 6;
            if (/cart/i.test(href)) score += 8;
            if (/add to cart/i.test(text)) score -= 10;
            if (node.tagName.toLowerCase() === 'a') score += 2;
            if (node.getAttribute('data-test')?.includes('cart')) score += 5;
            return { node, href, score };
          })
          .filter(item => item.score > 0)
          .sort((a, b) => b.score - a.score)[0];
        if (!best || !(best.node instanceof HTMLElement)) return { clicked: false };
        best.node.click();
        return { clicked: true, href: best.href || null };
      })()
    `, tabId);

    if (targetedCart.error) throw new Error(targetedCart.error);
    const targetedResult = asObject(targetedCart.result);
    if (targetedResult.clicked !== true) {
      const actions = await this.adapter.getActionableElements(tabId);
      const cartAction = actions
        .filter(el => el.visible && el.enabled && !!el.ref?.selector)
        .filter((el) => {
          const text = textOfElement(el);
          return CART_ACTION_RE.test(text) && !ADD_TO_CART_TEXT_RE.test(text);
        })
        .sort((a, b) => {
          const score = (el: BrowserActionableElement) => {
            let out = 0;
            const text = textOfElement(el);
            if (el.tagName === 'a') out += 4;
            if (el.actionability.includes('clickable')) out += 2;
            if (/cart/i.test(el.href || '')) out += 8;
            if (/shopping cart/i.test(text)) out += 4;
            return out;
          };
          return score(b) - score(a);
        })[0] || null;
      if (!cartAction?.ref.selector) throw new Error('Could not resolve cart navigation action');
      const click = await this.adapter.click(cartAction.ref.selector, tabId);
      if (!click.clicked) throw new Error(click.error || 'Could not click cart navigation action');
    }

    await this.adapter.waitForSettled(6_000);
    const page = await this.adapter.readPageState(tabId);
    const urlLooksCart = /\bcart\b/i.test(page.url);
    const textLooksCart = /\b(your cart|shopping cart|cart items|checkout)\b/i.test(page.text);
    if (!urlLooksCart && !textLooksCart) {
      throw new Error(`Cart navigation postcondition failed at ${page.url}`);
    }
    return {
      url: page.url,
      evidence: `Opened cart at ${page.url}`,
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
    if (CHECKOUT_SUCCESS_RE.test(page.text)) {
      return {
        url: page.url,
        action: checkoutAction.ref.selector,
        stage: 'completed',
        evidence: 'Checkout confirmation observed',
      };
    }

    if (/\b(checkout|shipping|billing|first name|postal|zip)\b/i.test(page.text) || /\bcheckout\b/i.test(page.url)) {
      return {
        url: page.url,
        action: checkoutAction.ref.selector,
        stage: 'in_progress',
        evidence: `Checkout started on ${page.url}`,
      };
    }
    throw new Error('Checkout postcondition failed: no checkout stage detected');
  }

  private async executeFillCheckoutInfo(args: Record<string, unknown>, tabId?: string): Promise<Record<string, unknown>> {
    const firstName = optionalString(args, 'firstName')
      || optionalString(args, 'firstname')
      || optionalString(args, 'first')
      || 'Test';
    const lastName = optionalString(args, 'lastName')
      || optionalString(args, 'lastname')
      || optionalString(args, 'last')
      || 'User';
    const postalCode = optionalString(args, 'postalCode')
      || optionalString(args, 'zip')
      || optionalString(args, 'zipCode')
      || '12345';

    const forms = await this.adapter.getFormModel(tabId);
    const checkoutForm = findBestForm(forms, (form) => {
      let score = 0;
      for (const field of form.fields) {
        const label = `${field.label} ${field.name} ${field.placeholder}`;
        if (CHECKOUT_FORM_FIRST_RE.test(label)) score += 4;
        if (CHECKOUT_FORM_LAST_RE.test(label)) score += 4;
        if (CHECKOUT_FORM_POSTAL_RE.test(label)) score += 4;
        if (field.visible) score += 1;
      }
      return score;
    });

    const firstField = checkoutForm
      ? findField(checkoutForm.fields, field => CHECKOUT_FORM_FIRST_RE.test(`${field.label} ${field.name} ${field.placeholder}`))
      : null;
    const lastField = checkoutForm
      ? findField(checkoutForm.fields, field => CHECKOUT_FORM_LAST_RE.test(`${field.label} ${field.name} ${field.placeholder}`))
      : null;
    const postalField = checkoutForm
      ? findField(checkoutForm.fields, field => CHECKOUT_FORM_POSTAL_RE.test(`${field.label} ${field.name} ${field.placeholder}`))
      : null;

    const fallbackTargets = await this.resolveCheckoutInfoTargetsFromDom(tabId);
    const firstSelector = firstField?.ref.selector || fallbackTargets.firstNameSelector;
    const lastSelector = lastField?.ref.selector || fallbackTargets.lastNameSelector;
    const postalSelector = postalField?.ref.selector || fallbackTargets.postalSelector;
    const formSelector = checkoutForm?.formRef?.selector || fallbackTargets.formSelector;

    if (!firstSelector || !lastSelector || !postalSelector) {
      throw new Error('Could not resolve checkout information fields');
    }

    const firstType = await this.adapter.type(firstSelector, firstName, tabId);
    if (!firstType.typed) throw new Error(firstType.error || 'Typing first name failed');
    const lastType = await this.adapter.type(lastSelector, lastName, tabId);
    if (!lastType.typed) throw new Error(lastType.error || 'Typing last name failed');
    const postalType = await this.adapter.type(postalSelector, postalCode, tabId);
    if (!postalType.typed) throw new Error(postalType.error || 'Typing postal code failed');

    const actions = await this.adapter.getActionableElements(tabId);
    const continueAction = findBestAction(actions, CHECKOUT_CONTINUE_RE);
    const clickSelector = continueAction?.ref.selector || fallbackTargets.submitSelector;
    if (clickSelector) {
      const click = await this.adapter.click(clickSelector, tabId);
      if (!click.clicked) throw new Error(click.error || 'Could not click continue action');
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
      throw new Error('Could not resolve checkout continue action');
    }

    await this.adapter.waitForSettled(6_000);
    const page = await this.adapter.readPageState(tabId);
    const progressed = /\b(checkout|review|order summary|finish|payment|shipping)\b/i.test(page.text)
      || /\b(checkout-step-two|review|finish)\b/i.test(page.url);
    if (!progressed) throw new Error(`Checkout info postcondition failed at ${page.url}`);
    return {
      url: page.url,
      firstNameField: firstSelector,
      lastNameField: lastSelector,
      postalField: postalSelector,
      submitField: clickSelector || formSelector || null,
      evidence: `Checkout info submitted on ${page.url}`,
    };
  }

  private async executeFinishOrder(tabId?: string): Promise<Record<string, unknown>> {
    const actions = await this.adapter.getActionableElements(tabId);
    const finishAction = findBestAction(actions, FINISH_ORDER_RE);
    if (!finishAction?.ref.selector) throw new Error('Could not resolve finish-order action');
    const click = await this.adapter.click(finishAction.ref.selector, tabId);
    if (!click.clicked) throw new Error(click.error || 'Could not click finish-order action');

    await this.adapter.waitForSettled(8_000);
    const page = await this.adapter.readPageState(tabId);
    if (!CHECKOUT_SUCCESS_RE.test(page.text) && !/\b(complete|confirmation)\b/i.test(page.url)) {
      throw new Error('Finish-order postcondition failed: no confirmation text found');
    }
    return {
      url: page.url,
      action: finishAction.ref.selector,
      evidence: `Order completion observed at ${page.url}`,
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

  private async readCartState(tabId?: string): Promise<{ count: number | null; hasRemove: boolean }> {
    const probe = await this.adapter.executeInPage(`
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

  private async resolveCheckoutInfoTargetsFromDom(tabId?: string): Promise<CheckoutInfoTargets> {
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
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
