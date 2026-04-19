import { BrowserActionableElement, BrowserFormModel } from '../../shared/types/browserIntelligence';
import {
  ADD_TO_CART_BUTTON_RE,
  ADD_TO_CART_TEXT_RE,
  CHECKOUT_BUTTON_RE,
  CHECKOUT_CONTINUE_RE,
  CHECKOUT_FORM_FIRST_RE,
  CHECKOUT_FORM_LAST_RE,
  CHECKOUT_FORM_POSTAL_RE,
  CHECKOUT_SUCCESS_RE,
  CART_ACTION_RE,
  DRAG_SUCCESS_RE,
  DIALOG_SUCCESS_RE,
  FINISH_ORDER_RE,
  HOVER_SUCCESS_RE,
  LOGIN_PASSWORD_RE,
  LOGIN_SUBMIT_RE,
  LOGIN_USER_RE,
  UPLOAD_BUTTON_RE,
  UPLOAD_FIELD_RE,
  findBestAction,
  findBestForm,
  findField,
  includesText,
  asObject,
  normalizeOp,
  optionalNumber,
  optionalString,
  requiredString,
  scoreLoginForm,
  scoreUploadForm,
  compact,
  textOfElement,
} from './WebIntentVM.utils';
import {
  extractStructuredData,
  readAuthState,
  readCartState,
  resolveCheckoutInfoTargetsFromDom,
  resolveDragDropTargetsFromDom,
  resolveHoverTargetFromDom,
  resolveLoginTargetsFromDom,
  selectRequestedFields,
} from './WebIntentVM.helpers';

export type WebIntentOpcode =
  | 'NAVIGATE'
  | 'WAIT'
  | 'ASSERT'
  | 'INTENT.LOGIN'
  | 'INTENT.ACCEPT_DIALOG'
  | 'INTENT.DISMISS_DIALOG'
  | 'INTENT.HOVER'
  | 'INTENT.DRAG_DROP'
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
  getDialogs: (tabId?: string) => Promise<Array<{
    id: string;
    type: string;
    message: string;
    defaultPrompt?: string;
  }>>;
  acceptDialog: (input: { tabId?: string; dialogId?: string; promptText?: string }) => Promise<{ accepted: boolean; error: string | null }>;
  dismissDialog: (input: { tabId?: string; dialogId?: string }) => Promise<{ dismissed: boolean; error: string | null }>;
  getActionableElements: (tabId?: string) => Promise<BrowserActionableElement[]>;
  getFormModel: (tabId?: string) => Promise<BrowserFormModel[]>;
  click: (selector: string, tabId?: string) => Promise<{ clicked: boolean; error: string | null }>;
  type: (selector: string, text: string, tabId?: string) => Promise<{ typed: boolean; error: string | null }>;
  upload: (selector: string, filePath: string, tabId?: string) => Promise<{ uploaded: boolean; error: string | null }>;
  hover: (selector: string, tabId?: string) => Promise<{ hovered: boolean; error: string | null }>;
  drag: (sourceSelector: string, targetSelector: string, tabId?: string) => Promise<{ dragged: boolean; error: string | null }>;
  executeInPage: (expression: string, tabId?: string) => Promise<{ result: unknown; error: string | null }>;
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
        const op = normalizeOp(String(instruction.op || '')) as WebIntentOpcode;
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
      case 'INTENT.ACCEPT_DIALOG':
        return this.executeAcceptDialog(args, tabId);
      case 'INTENT.DISMISS_DIALOG':
        return this.executeDismissDialog(args, tabId);
      case 'INTENT.HOVER':
        return this.executeHover(args, tabId);
      case 'INTENT.DRAG_DROP':
        return this.executeDragDrop(args, tabId);
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
      const auth = await readAuthState(this.adapter, tabId);
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

    const fallbackTargets = await resolveLoginTargetsFromDom(this.adapter, tabId);
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
    const auth = await readAuthState(this.adapter, tabId);
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

  private async executeAcceptDialog(args: Record<string, unknown>, tabId?: string): Promise<Record<string, unknown>> {
    const dialogs = await this.adapter.getDialogs(tabId);
    const dialogId = optionalString(args, 'dialogId');
    const messageContains = optionalString(args, 'messageContains') || optionalString(args, 'message');
    const dialog = dialogs.find((item) => {
      if (dialogId && item.id !== dialogId) return false;
      if (messageContains && !includesText(item.message || '', messageContains)) return false;
      return true;
    }) || dialogs[0] || null;
    if (!dialog) throw new Error('No pending dialog to accept');

    const promptText = optionalString(args, 'promptText') || optionalString(args, 'value') || undefined;
    const accepted = await this.adapter.acceptDialog({
      tabId,
      dialogId: dialog.id,
      promptText,
    });
    if (!accepted.accepted) throw new Error(accepted.error || 'Accept dialog failed');
    await this.adapter.waitForSettled(1_000);
    const page = await this.adapter.readPageState(tabId);
    const successText = optionalString(args, 'successText');
    const ok = successText ? includesText(page.text, successText) : DIALOG_SUCCESS_RE.test(page.text);
    if (!ok) {
      throw new Error('Accept dialog postcondition failed: no confirmation text found');
    }
    return {
      dialogId: dialog.id,
      type: dialog.type,
      message: dialog.message,
      promptText: promptText || null,
      accepted: true,
      evidence: ok
        ? `Accepted ${dialog.type} dialog: ${dialog.message || '(empty)'}`
        : `Accepted ${dialog.type} dialog`,
    };
  }

  private async executeDismissDialog(args: Record<string, unknown>, tabId?: string): Promise<Record<string, unknown>> {
    const dialogs = await this.adapter.getDialogs(tabId);
    const dialogId = optionalString(args, 'dialogId');
    const messageContains = optionalString(args, 'messageContains') || optionalString(args, 'message');
    const dialog = dialogs.find((item) => {
      if (dialogId && item.id !== dialogId) return false;
      if (messageContains && !includesText(item.message || '', messageContains)) return false;
      return true;
    }) || dialogs[0] || null;
    if (!dialog) throw new Error('No pending dialog to dismiss');

    const dismissed = await this.adapter.dismissDialog({
      tabId,
      dialogId: dialog.id,
    });
    if (!dismissed.dismissed) throw new Error(dismissed.error || 'Dismiss dialog failed');
    await this.adapter.waitForSettled(1_000);
    const page = await this.adapter.readPageState(tabId);
    const successText = optionalString(args, 'successText');
    const ok = successText ? includesText(page.text, successText) : DIALOG_SUCCESS_RE.test(page.text);
    if (!ok) {
      throw new Error('Dismiss dialog postcondition failed: no confirmation text found');
    }
    return {
      dialogId: dialog.id,
      type: dialog.type,
      message: dialog.message,
      dismissed: true,
      evidence: `Dismissed ${dialog.type} dialog: ${dialog.message || '(empty)'}`,
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
    const upload = await this.adapter.upload(fileField.ref.selector, filePath, tabId);
    if (!upload.uploaded) throw new Error(upload.error || 'Uploading file failed');

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

  private async executeHover(args: Record<string, unknown>, tabId?: string): Promise<Record<string, unknown>> {
    const selector = optionalString(args, 'selector');
    const targetText = optionalString(args, 'target')
      || optionalString(args, 'targetText')
      || optionalString(args, 'text')
      || optionalString(args, 'item')
      || 'hover';
    const resolved = selector
      ? { selector, label: targetText }
      : await resolveHoverTargetFromDom(this.adapter, targetText, tabId);

    if (!resolved.selector) {
      throw new Error(`Could not resolve hover target for "${targetText}"`);
    }

    const before = await this.adapter.readPageState(tabId);
    const hover = await this.adapter.hover(resolved.selector, tabId);
    if (!hover.hovered) throw new Error(hover.error || 'Hover action failed');
    await this.adapter.waitForSettled(500);
    const after = await this.adapter.readPageState(tabId);

    const successText = optionalString(args, 'successText');
    const changed = before.text !== after.text;
    const successObserved = successText
      ? includesText(after.text, successText)
      : HOVER_SUCCESS_RE.test(after.text) || changed;
    if (!successObserved) {
      throw new Error('Hover postcondition failed: no revealed hover content or page state change detected');
    }

    return {
      selector: resolved.selector,
      target: resolved.label,
      evidence: `Hovered "${resolved.label}"`,
    };
  }

  private async executeDragDrop(args: Record<string, unknown>, tabId?: string): Promise<Record<string, unknown>> {
    const sourceSelector = optionalString(args, 'sourceSelector');
    const targetSelector = optionalString(args, 'targetSelector');
    const sourceText = optionalString(args, 'source')
      || optionalString(args, 'sourceText')
      || optionalString(args, 'item')
      || optionalString(args, 'from')
      || 'draggable';
    const targetText = optionalString(args, 'target')
      || optionalString(args, 'targetText')
      || optionalString(args, 'to')
      || 'drop';

    const resolved = sourceSelector && targetSelector
      ? { sourceSelector, targetSelector, sourceLabel: sourceText, targetLabel: targetText }
      : await resolveDragDropTargetsFromDom(this.adapter, sourceText, targetText, tabId);

    if (!resolved.sourceSelector || !resolved.targetSelector) {
      throw new Error(`Could not resolve drag/drop targets for "${sourceText}" -> "${targetText}"`);
    }

    const before = await this.adapter.readPageState(tabId);
    const drag = await this.adapter.drag(resolved.sourceSelector, resolved.targetSelector, tabId);
    if (!drag.dragged) throw new Error(drag.error || 'Drag/drop action failed');
    await this.adapter.waitForSettled(3_000);
    const after = await this.adapter.readPageState(tabId);

    const changed = before.text !== after.text || before.url !== after.url;
    const successText = optionalString(args, 'successText');
    const successObserved = successText
      ? includesText(after.text, successText)
      : DRAG_SUCCESS_RE.test(after.text) || changed;

    if (!successObserved) {
      throw new Error('Drag/drop postcondition failed: no success text or page state change detected');
    }

    return {
      sourceSelector: resolved.sourceSelector,
      targetSelector: resolved.targetSelector,
      source: resolved.sourceLabel,
      target: resolved.targetLabel,
      evidence: `Dragged "${resolved.sourceLabel}" to "${resolved.targetLabel}"`,
    };
  }

  private async executeAddToCart(args: Record<string, unknown>, tabId?: string): Promise<Record<string, unknown>> {
    const item = optionalString(args, 'item')
      || optionalString(args, 'itemName')
      || optionalString(args, 'product')
      || optionalString(args, 'name');

    const before = await readCartState(this.adapter, tabId);
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
    const after = await readCartState(this.adapter, tabId);
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

    const fallbackTargets = await resolveCheckoutInfoTargetsFromDom(this.adapter, tabId);
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

    const extracted = await extractStructuredData(this.adapter, tabId);
    const selected = requestedFields.length > 0
      ? selectRequestedFields(requestedFields, extracted)
      : {};

    return {
      ...extracted,
      selected,
      evidence: requestedFields.length > 0
        ? `Extracted ${Object.keys(selected).length} requested fields`
        : `Extracted ${extracted.keyValues.length} key/value pairs`,
    };
  }

}
