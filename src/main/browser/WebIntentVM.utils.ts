import { BrowserActionableElement, BrowserFormFieldModel, BrowserFormModel } from '../../shared/types/browserIntelligence';

export const LOGIN_USER_RE = /\b(email|e-mail|username|user|login)\b/i;
export const LOGIN_PASSWORD_RE = /\bpassword|passcode|pin\b/i;
export const LOGIN_SUBMIT_RE = /\b(sign in|log in|login|continue|submit|next)\b/i;
export const DIALOG_SUCCESS_RE = /\b(alert|confirm|prompt|accepted|dismissed|clicked:|entered:|you successfully)\b/i;
export const HOVER_SUCCESS_RE = /\b(view profile|profile|caption|tooltip|menu|popover|visible|shown|name:|user)\b/i;
export const DRAG_SUCCESS_RE = /\b(dropped|success|complete|placed|accepted|in the can|inside)\b/i;
export const UPLOAD_FIELD_RE = /\b(file|upload|attachment|document|csv|path)\b/i;
export const UPLOAD_BUTTON_RE = /\b(upload|attach|import|submit file|send file)\b/i;
export const ADD_TO_CART_BUTTON_RE = /\b(add to cart|add item|add)\b/i;
export const CART_ACTION_RE = /\b(cart|shopping cart|basket|bag)\b/i;
export const ADD_TO_CART_TEXT_RE = /\badd to cart\b/i;
export const CHECKOUT_BUTTON_RE = /\b(checkout|pay now|place order|complete order|buy now|submit order)\b/i;
export const CHECKOUT_FORM_FIRST_RE = /\b(first name|firstname|given name|first)\b/i;
export const CHECKOUT_FORM_LAST_RE = /\b(last name|lastname|surname|family name|last)\b/i;
export const CHECKOUT_FORM_POSTAL_RE = /\b(postal|zip|zipcode|zip code|postcode)\b/i;
export const CHECKOUT_CONTINUE_RE = /\b(continue|next|review|proceed)\b/i;
export const FINISH_ORDER_RE = /\b(finish|place order|complete order|submit order|pay now)\b/i;
export const CHECKOUT_SUCCESS_RE = /\b(order complete|order confirmed|thank you|receipt|purchase complete|success)\b/i;
export const TEXT_NORMALIZE_RE = /\s+/g;

export function textOfElement(element: BrowserActionableElement): string {
  return `${element.text || ''} ${element.ariaLabel || ''} ${element.role || ''}`.replace(TEXT_NORMALIZE_RE, ' ').trim();
}

export function includesText(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

export function requiredString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Expected non-empty string: ${key}`);
  }
  return value.trim();
}

export function optionalString(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function optionalNumber(obj: Record<string, unknown>, key: string, fallback: number): number {
  const value = obj[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function normalizeOp(op: string): string {
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

export function findBestForm(forms: BrowserFormModel[], scorer: (form: BrowserFormModel) => number): BrowserFormModel | null {
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

export function scoreLoginForm(form: BrowserFormModel): number {
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

export function scoreUploadForm(form: BrowserFormModel): number {
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

export function findField(fields: BrowserFormFieldModel[], matcher: (field: BrowserFormFieldModel) => boolean): BrowserFormFieldModel | null {
  for (const field of fields) {
    if (!field.visible) continue;
    if (!field.ref?.selector) continue;
    if (matcher(field)) return field;
  }
  return null;
}

export function findBestAction(
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

export function compact(input: string, max = 180): string {
  const text = input.replace(TEXT_NORMALIZE_RE, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
