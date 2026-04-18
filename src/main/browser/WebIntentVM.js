"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebIntentVM = void 0;
const LOGIN_USER_RE = /\b(email|e-mail|username|user|login)\b/i;
const LOGIN_PASSWORD_RE = /\bpassword|passcode|pin\b/i;
const LOGIN_SUBMIT_RE = /\b(sign in|log in|login|continue|submit|next)\b/i;
const DIALOG_SUCCESS_RE = /\b(alert|confirm|prompt|accepted|dismissed|clicked:|entered:|you successfully)\b/i;
const HOVER_SUCCESS_RE = /\b(view profile|profile|caption|tooltip|menu|popover|visible|shown|name:|user)\b/i;
const DRAG_SUCCESS_RE = /\b(dropped|success|complete|placed|accepted|in the can|inside)\b/i;
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
function textOfElement(element) {
    return `${element.text || ''} ${element.ariaLabel || ''} ${element.role || ''}`.replace(TEXT_NORMALIZE_RE, ' ').trim();
}
function includesText(haystack, needle) {
    return haystack.toLowerCase().includes(needle.toLowerCase());
}
function asObject(value) {
    return typeof value === 'object' && value !== null ? value : {};
}
function requiredString(obj, key) {
    const value = obj[key];
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`Expected non-empty string: ${key}`);
    }
    return value.trim();
}
function optionalString(obj, key) {
    const value = obj[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function optionalNumber(obj, key, fallback) {
    const value = obj[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function normalizeOp(op) {
    const upper = op.trim().toUpperCase();
    switch (upper) {
        case 'NAVIGATE':
        case 'WAIT':
        case 'ASSERT':
        case 'INTENT.LOGIN':
        case 'INTENT.ACCEPT_DIALOG':
        case 'INTENT.DISMISS_DIALOG':
        case 'INTENT.HOVER':
        case 'INTENT.DRAG_DROP':
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
function findBestForm(forms, scorer) {
    let best = null;
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
function scoreLoginForm(form) {
    let score = 0;
    const purpose = (form.purpose || '').toLowerCase();
    if (purpose.includes('login') || purpose.includes('sign'))
        score += 3;
    for (const field of form.fields) {
        const label = `${field.label} ${field.name} ${field.placeholder}`;
        if (field.kind === 'password' || LOGIN_PASSWORD_RE.test(label))
            score += 4;
        if (field.kind === 'email' || LOGIN_USER_RE.test(label))
            score += 3;
        if (field.visible)
            score += 1;
    }
    for (const submit of form.submitLabels) {
        if (LOGIN_SUBMIT_RE.test(submit))
            score += 2;
    }
    return score;
}
function scoreUploadForm(form) {
    let score = 0;
    for (const field of form.fields) {
        const label = `${field.label} ${field.name} ${field.placeholder}`;
        if (UPLOAD_FIELD_RE.test(label))
            score += 3;
        if (field.visible)
            score += 1;
    }
    for (const submit of form.submitLabels) {
        if (UPLOAD_BUTTON_RE.test(submit))
            score += 3;
    }
    return score;
}
function findField(fields, matcher) {
    for (const field of fields) {
        if (!field.visible)
            continue;
        if (!field.ref?.selector)
            continue;
        if (matcher(field))
            return field;
    }
    return null;
}
function findBestAction(elements, regex) {
    const candidates = elements
        .filter(el => el.visible && el.enabled && !!el.ref?.selector)
        .map((el) => {
        const haystack = textOfElement(el);
        let score = 0;
        if (el.actionability.includes('clickable'))
            score += 3;
        if (el.tagName === 'button')
            score += 2;
        if (regex.test(haystack))
            score += 5;
        return { el, score };
    })
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score);
    return candidates[0]?.el || null;
}
function compact(input, max = 180) {
    const text = input.replace(TEXT_NORMALIZE_RE, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}...` : text;
}
class WebIntentVM {
    adapter;
    constructor(adapter) {
        this.adapter = adapter;
    }
    async run(program) {
        const instructions = Array.isArray(program.instructions) ? program.instructions : [];
        if (instructions.length === 0)
            throw new Error('Intent program must include at least one instruction');
        const failFast = program.failFast !== false;
        const tabId = program.tabId;
        const steps = [];
        const extracted = [];
        let failedAt = null;
        for (let index = 0; index < instructions.length; index++) {
            const instruction = instructions[index] || { op: 'WAIT', args: {} };
            const started = Date.now();
            try {
                const op = normalizeOp(String(instruction.op || ''));
                const data = await this.executeInstruction(op, asObject(instruction.args), tabId);
                if (op === 'INTENT.EXTRACT')
                    extracted.push(data);
                steps.push({
                    index,
                    op,
                    status: 'ok',
                    durationMs: Date.now() - started,
                    evidence: compact(String(data.evidence || 'step completed')),
                    data,
                });
            }
            catch (err) {
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
                if (failFast)
                    break;
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
    async executeInstruction(op, args, tabId) {
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
    async executeNavigate(args, tabId) {
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
    async executeWait(args, tabId) {
        const timeoutMs = optionalNumber(args, 'timeoutMs', 2_000);
        await this.adapter.waitForSettled(timeoutMs);
        const state = await this.adapter.readPageState(tabId);
        return {
            url: state.url,
            evidence: `Waited ${timeoutMs}ms`,
        };
    }
    async executeAssert(args, tabId) {
        const kind = (optionalString(args, 'kind') || optionalString(args, 'type') || '').toLowerCase();
        if (!kind)
            throw new Error('ASSERT requires kind');
        if (kind === 'text_present') {
            const text = requiredString(args, 'text');
            const page = await this.adapter.readPageState(tabId);
            const matched = includesText(page.text, text) || includesText(page.title, text);
            if (!matched)
                throw new Error(`ASSERT text_present failed: "${text}" not found`);
            return { matched, text, evidence: `Found text "${text}"` };
        }
        if (kind === 'url_includes') {
            const part = requiredString(args, 'value');
            const url = await this.adapter.getCurrentUrl(tabId);
            const matched = includesText(url, part);
            if (!matched)
                throw new Error(`ASSERT url_includes failed: "${part}" not in ${url}`);
            return { matched, url, value: part, evidence: `URL includes "${part}"` };
        }
        if (kind === 'element_present') {
            const query = requiredString(args, 'query');
            const elements = await this.adapter.getActionableElements(tabId);
            const match = elements.find(el => includesText(textOfElement(el), query));
            if (!match)
                throw new Error(`ASSERT element_present failed: no element for "${query}"`);
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
            if (!matched)
                throw new Error(`ASSERT logged_in failed on ${auth.url}`);
            return {
                matched,
                url: auth.url,
                title: auth.title,
                evidence: 'Login state confirmed',
            };
        }
        throw new Error(`Unknown ASSERT kind: ${kind}`);
    }
    async executeLogin(args, tabId) {
        const username = optionalString(args, 'username') || optionalString(args, 'email') || optionalString(args, 'user');
        const password = optionalString(args, 'password');
        const successText = optionalString(args, 'successText');
        if (!username || !password) {
            throw new Error('INTENT.LOGIN requires username/email and password');
        }
        const forms = await this.adapter.getFormModel(tabId);
        const loginForm = findBestForm(forms, scoreLoginForm);
        const userField = loginForm
            ? (findField(loginForm.fields, (field) => (field.kind === 'email'
                || (field.kind !== 'password' && LOGIN_USER_RE.test(`${field.label} ${field.name} ${field.placeholder}`)))) || findField(loginForm.fields, (field) => field.kind === 'text' || field.kind === 'email'))
            : null;
        const passField = loginForm
            ? findField(loginForm.fields, (field) => (field.kind === 'password'
                || LOGIN_PASSWORD_RE.test(`${field.label} ${field.name} ${field.placeholder}`)))
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
        if (!userType.typed)
            throw new Error(userType.error || 'Typing username failed');
        const passType = await this.adapter.type(passwordSelector, password, tabId);
        if (!passType.typed)
            throw new Error(passType.error || 'Typing password failed');
        const actions = await this.adapter.getActionableElements(tabId);
        const rankedSubmit = findBestAction(actions, LOGIN_SUBMIT_RE);
        const clickSelector = rankedSubmit?.ref.selector || submitSelector;
        if (clickSelector) {
            const click = await this.adapter.click(clickSelector, tabId);
            if (!click.clicked)
                throw new Error(click.error || 'Could not click login submit action');
        }
        else if (formSelector) {
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
        }
        else {
            throw new Error('Could not resolve login submit action');
        }
        await this.adapter.waitForSettled(8_000);
        const auth = await this.readAuthState(tabId);
        const page = await this.adapter.readPageState(tabId);
        const explicitSuccess = successText ? includesText(page.text, successText) : false;
        const ok = explicitSuccess || auth.hasAuthMarkers || !auth.hasLoginMarkers;
        if (!ok)
            throw new Error(`Login postcondition failed at ${auth.url}`);
        return {
            url: auth.url,
            title: auth.title,
            usernameField: usernameSelector,
            passwordField: passwordSelector,
            submitField: clickSelector || formSelector || null,
            evidence: `Login succeeded on ${auth.url}`,
        };
    }
    async executeAcceptDialog(args, tabId) {
        const dialogs = await this.adapter.getDialogs(tabId);
        const dialogId = optionalString(args, 'dialogId');
        const messageContains = optionalString(args, 'messageContains') || optionalString(args, 'message');
        const dialog = dialogs.find((item) => {
            if (dialogId && item.id !== dialogId)
                return false;
            if (messageContains && !includesText(item.message || '', messageContains))
                return false;
            return true;
        }) || dialogs[0] || null;
        if (!dialog)
            throw new Error('No pending dialog to accept');
        const promptText = optionalString(args, 'promptText') || optionalString(args, 'value') || undefined;
        const accepted = await this.adapter.acceptDialog({
            tabId,
            dialogId: dialog.id,
            promptText,
        });
        if (!accepted.accepted)
            throw new Error(accepted.error || 'Accept dialog failed');
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
    async executeDismissDialog(args, tabId) {
        const dialogs = await this.adapter.getDialogs(tabId);
        const dialogId = optionalString(args, 'dialogId');
        const messageContains = optionalString(args, 'messageContains') || optionalString(args, 'message');
        const dialog = dialogs.find((item) => {
            if (dialogId && item.id !== dialogId)
                return false;
            if (messageContains && !includesText(item.message || '', messageContains))
                return false;
            return true;
        }) || dialogs[0] || null;
        if (!dialog)
            throw new Error('No pending dialog to dismiss');
        const dismissed = await this.adapter.dismissDialog({
            tabId,
            dialogId: dialog.id,
        });
        if (!dismissed.dismissed)
            throw new Error(dismissed.error || 'Dismiss dialog failed');
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
    async executeUpload(args, tabId) {
        const filePath = optionalString(args, 'filePath') || optionalString(args, 'path');
        if (!filePath)
            throw new Error('INTENT.UPLOAD requires filePath');
        const forms = await this.adapter.getFormModel(tabId);
        const uploadForm = findBestForm(forms, scoreUploadForm);
        if (!uploadForm)
            throw new Error('Could not find an upload form');
        const fileField = findField(uploadForm.fields, (field) => (UPLOAD_FIELD_RE.test(`${field.label} ${field.name} ${field.placeholder}`)
            && field.kind !== 'password'));
        if (!fileField?.ref.selector)
            throw new Error('Could not resolve upload field');
        const upload = await this.adapter.upload(fileField.ref.selector, filePath, tabId);
        if (!upload.uploaded)
            throw new Error(upload.error || 'Uploading file failed');
        const actions = await this.adapter.getActionableElements(tabId);
        const uploadAction = findBestAction(actions, UPLOAD_BUTTON_RE);
        if (!uploadAction?.ref.selector)
            throw new Error('Could not resolve upload action');
        const click = await this.adapter.click(uploadAction.ref.selector, tabId);
        if (!click.clicked)
            throw new Error(click.error || 'Could not click upload action');
        await this.adapter.waitForSettled(6_000);
        const page = await this.adapter.readPageState(tabId);
        const ok = /\b(uploaded|attached|imported|success)\b/i.test(page.text);
        if (!ok)
            throw new Error('Upload postcondition failed: no upload confirmation text found');
        return {
            url: page.url,
            uploadField: fileField.ref.selector,
            uploadAction: uploadAction.ref.selector,
            evidence: `Upload confirmed for ${filePath}`,
        };
    }
    async executeHover(args, tabId) {
        const selector = optionalString(args, 'selector');
        const targetText = optionalString(args, 'target')
            || optionalString(args, 'targetText')
            || optionalString(args, 'text')
            || optionalString(args, 'item')
            || 'hover';
        const resolved = selector
            ? { selector, label: targetText }
            : await this.resolveHoverTargetFromDom(targetText, tabId);
        if (!resolved.selector) {
            throw new Error(`Could not resolve hover target for "${targetText}"`);
        }
        const before = await this.adapter.readPageState(tabId);
        const hover = await this.adapter.hover(resolved.selector, tabId);
        if (!hover.hovered)
            throw new Error(hover.error || 'Hover action failed');
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
    async executeDragDrop(args, tabId) {
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
            : await this.resolveDragDropTargetsFromDom(sourceText, targetText, tabId);
        if (!resolved.sourceSelector || !resolved.targetSelector) {
            throw new Error(`Could not resolve drag/drop targets for "${sourceText}" -> "${targetText}"`);
        }
        const before = await this.adapter.readPageState(tabId);
        const drag = await this.adapter.drag(resolved.sourceSelector, resolved.targetSelector, tabId);
        if (!drag.dragged)
            throw new Error(drag.error || 'Drag/drop action failed');
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
    async executeAddToCart(args, tabId) {
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
        if (targetedAdd.error)
            throw new Error(targetedAdd.error);
        const targetedResult = asObject(targetedAdd.result);
        if (targetedResult.clicked !== true) {
            const actions = await this.adapter.getActionableElements(tabId);
            const addAction = findBestAction(actions, ADD_TO_CART_BUTTON_RE);
            if (!addAction?.ref.selector)
                throw new Error('Could not resolve add-to-cart action');
            const click = await this.adapter.click(addAction.ref.selector, tabId);
            if (!click.clicked)
                throw new Error(click.error || 'Could not click add-to-cart action');
        }
        await this.adapter.waitForSettled(4_000);
        const after = await this.readCartState(tabId);
        const page = await this.adapter.readPageState(tabId);
        const success = ((typeof before.count === 'number' && typeof after.count === 'number' && after.count > before.count)
            || after.hasRemove
            || /\b(remove)\b/i.test(page.text));
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
    async executeOpenCart(tabId) {
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
        if (targetedCart.error)
            throw new Error(targetedCart.error);
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
                const score = (el) => {
                    let out = 0;
                    const text = textOfElement(el);
                    if (el.tagName === 'a')
                        out += 4;
                    if (el.actionability.includes('clickable'))
                        out += 2;
                    if (/cart/i.test(el.href || ''))
                        out += 8;
                    if (/shopping cart/i.test(text))
                        out += 4;
                    return out;
                };
                return score(b) - score(a);
            })[0] || null;
            if (!cartAction?.ref.selector)
                throw new Error('Could not resolve cart navigation action');
            const click = await this.adapter.click(cartAction.ref.selector, tabId);
            if (!click.clicked)
                throw new Error(click.error || 'Could not click cart navigation action');
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
    async executeCheckout(tabId) {
        const actions = await this.adapter.getActionableElements(tabId);
        const checkoutAction = findBestAction(actions, CHECKOUT_BUTTON_RE);
        if (!checkoutAction?.ref.selector)
            throw new Error('Could not resolve checkout action');
        const click = await this.adapter.click(checkoutAction.ref.selector, tabId);
        if (!click.clicked)
            throw new Error(click.error || 'Could not click checkout action');
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
    async executeFillCheckoutInfo(args, tabId) {
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
                if (CHECKOUT_FORM_FIRST_RE.test(label))
                    score += 4;
                if (CHECKOUT_FORM_LAST_RE.test(label))
                    score += 4;
                if (CHECKOUT_FORM_POSTAL_RE.test(label))
                    score += 4;
                if (field.visible)
                    score += 1;
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
        if (!firstType.typed)
            throw new Error(firstType.error || 'Typing first name failed');
        const lastType = await this.adapter.type(lastSelector, lastName, tabId);
        if (!lastType.typed)
            throw new Error(lastType.error || 'Typing last name failed');
        const postalType = await this.adapter.type(postalSelector, postalCode, tabId);
        if (!postalType.typed)
            throw new Error(postalType.error || 'Typing postal code failed');
        const actions = await this.adapter.getActionableElements(tabId);
        const continueAction = findBestAction(actions, CHECKOUT_CONTINUE_RE);
        const clickSelector = continueAction?.ref.selector || fallbackTargets.submitSelector;
        if (clickSelector) {
            const click = await this.adapter.click(clickSelector, tabId);
            if (!click.clicked)
                throw new Error(click.error || 'Could not click continue action');
        }
        else if (formSelector) {
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
        }
        else {
            throw new Error('Could not resolve checkout continue action');
        }
        await this.adapter.waitForSettled(6_000);
        const page = await this.adapter.readPageState(tabId);
        const progressed = /\b(checkout|review|order summary|finish|payment|shipping)\b/i.test(page.text)
            || /\b(checkout-step-two|review|finish)\b/i.test(page.url);
        if (!progressed)
            throw new Error(`Checkout info postcondition failed at ${page.url}`);
        return {
            url: page.url,
            firstNameField: firstSelector,
            lastNameField: lastSelector,
            postalField: postalSelector,
            submitField: clickSelector || formSelector || null,
            evidence: `Checkout info submitted on ${page.url}`,
        };
    }
    async executeFinishOrder(tabId) {
        const actions = await this.adapter.getActionableElements(tabId);
        const finishAction = findBestAction(actions, FINISH_ORDER_RE);
        if (!finishAction?.ref.selector)
            throw new Error('Could not resolve finish-order action');
        const click = await this.adapter.click(finishAction.ref.selector, tabId);
        if (!click.clicked)
            throw new Error(click.error || 'Could not click finish-order action');
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
    async executeExtract(args, tabId) {
        const requestedFields = Array.isArray(args.fields)
            ? args.fields.filter((item) => typeof item === 'string' && item.trim().length > 0)
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
    async readAuthState(tabId) {
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
            const raw = probe.result;
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
    async extractStructuredData(tabId) {
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
            const raw = result.result;
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
    selectRequestedFields(fields, extracted) {
        const out = {};
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
            if (found?.[1])
                out[field] = found[1].trim();
        }
        return out;
    }
    async readCartState(tabId) {
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
            const raw = probe.result;
            return {
                count: typeof raw.count === 'number' && Number.isFinite(raw.count) ? raw.count : null,
                hasRemove: raw.hasRemove === true,
            };
        }
        return { count: null, hasRemove: false };
    }
    async resolveHoverTargetFromDom(targetText, tabId) {
        const probe = await this.adapter.executeInPage(`
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
          return String(value).replace(/([ #;?%&,.+*~\\':"!^$[\\]()=>|\\/@])/g, '\\\\$1');
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
            const raw = probe.result;
            return {
                selector: typeof raw.selector === 'string' && raw.selector ? raw.selector : null,
                label: typeof raw.label === 'string' && raw.label ? raw.label : targetText,
            };
        }
        return { selector: null, label: targetText };
    }
    async resolveDragDropTargetsFromDom(sourceText, targetText, tabId) {
        const probe = await this.adapter.executeInPage(`
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
          return String(value).replace(/([ #;?%&,.+*~\\':"!^$[\\]()=>|\\/@])/g, '\\\\$1');
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
            const raw = probe.result;
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
    async resolveLoginTargetsFromDom(tabId) {
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
            const raw = probe.result;
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
    async resolveCheckoutInfoTargetsFromDom(tabId) {
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
            const raw = probe.result;
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
exports.WebIntentVM = WebIntentVM;
function escapeRegex(input) {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
//# sourceMappingURL=WebIntentVM.js.map