import { appStateStore } from '../../state/appStateStore';
import { ActionType } from '../../state/actions';
import { generateId } from '../../../shared/utils/ids';
import { agentCache } from '../AgentCache';
import { browserService } from '../../browser/BrowserService';
import { PageExtractor } from '../../context/pageExtractor';
import { pageKnowledgeStore } from '../../browserKnowledge/PageKnowledgeStore';
import {
  BrowserOperationKind,
  BrowserOperationPayloadMap,
  BrowserOperationResult,
  executeBrowserOperation,
} from '../../browser/browserOperations';

type ScoreInput = {
  query: string;
  title?: string;
  url?: string;
  summary?: string;
  keyFacts?: string[];
  matchSnippets?: string[];
  dates?: string[];
};

export function objectInput(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
}

export function requireObjectInput(input: unknown, toolName: string): Record<string, unknown> {
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  const received = input === null ? 'null' : Array.isArray(input) ? 'array' : typeof input;
  throw new Error(`Invalid input for ${toolName}: input must be an object; got ${received}.`);
}

export function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Expected non-empty string input: ${key}`);
  }
  return value;
}

export function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

export function optionalNumber(input: Record<string, unknown>, key: string, fallback: number): number {
  const value = input[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function optionalStringArray(input: Record<string, unknown>, key: string): string[] {
  const value = input[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : [];
}

export function logBrowserCache(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
  appStateStore.dispatch({
    type: ActionType.ADD_LOG,
    log: {
      id: generateId('log'),
      timestamp: Date.now(),
      level,
      source: 'browser',
      message,
    },
  });
}

export function invalidateBrowserCaches(): void {
  agentCache.invalidateByToolPrefix('browser.');
}

export function includesText(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function buildWaitForTextExpression(): string {
  return `(() => {
    const parts = [];
    if (document.body?.innerText) parts.push(document.body.innerText);
    for (const element of document.querySelectorAll('input, textarea, select')) {
      if (element instanceof HTMLSelectElement) {
        const selectedText = Array.from(element.selectedOptions || [])
          .map(option => option.textContent || '')
          .join('\\n')
          .trim();
        if (selectedText) parts.push(selectedText);
        if (element.value) parts.push(element.value);
        continue;
      }
      if ('value' in element && typeof element.value === 'string' && element.value.trim()) {
        parts.push(element.value);
      }
    }
    return parts.join('\\n');
  })()`;
}

export function compactText(text: string | undefined, maxChars: number): string {
  const cleaned = (text || '').replace(/\s+/g, ' ').trim();
  return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars)}...` : cleaned;
}

export async function resolveWithSoftTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<{ value: T; timedOut: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ value: fallback, timedOut: true });
    }, timeoutMs);

    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ value, timedOut: false });
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ value: fallback, timedOut: false });
      });
  });
}

export function queryTerms(query: string): string[] {
  const stopWords = new Set([
    'the', 'and', 'for', 'with', 'from', 'what', 'when', 'where', 'how', 'does', 'are',
    'was', 'latest', 'current', 'search', 'look', 'lookup', 'find', 'online',
  ]);
  return Array.from(new Set(
    query.toLowerCase()
      .split(/[^a-z0-9.$%-]+/)
      .filter(term => term.length >= 2 && !stopWords.has(term)),
  ));
}

export function currentSearchYear(): number {
  return new Date().getFullYear();
}

export function hasExplicitYear(query: string): boolean {
  return /\b(?:19|20)\d{2}\b/.test(query);
}

export function isFreshnessSensitiveQuery(query: string): boolean {
  const normalized = query.toLowerCase();
  return /\b(latest|current|today|recent|newest|up[- ]?to[- ]?date|breaking|news|release(?: notes?)?|pricing|price|cost|version|docs?|documentation|policy|policies|law|laws|regulation|regulations|guidance|schedule|scores?)\b/.test(normalized)
    && !hasExplicitYear(query);
}

export function extractReferencedYears(input: Array<string | undefined>): number[] {
  const years = new Set<number>();
  for (const text of input) {
    for (const match of (text || '').match(/\b(?:19|20)\d{2}\b/g) || []) {
      years.add(Number(match));
    }
  }
  return Array.from(years).sort((a, b) => b - a);
}

export function scoreEvidence(input: {
  query: string;
  title?: string;
  url?: string;
  summary?: string;
  keyFacts?: string[];
  matchSnippets?: string[];
  dates?: string[];
}): { score: number; reasons: string[]; sufficient: boolean } {
  const terms = queryTerms(input.query);
  const titleUrl = `${input.title || ''} ${input.url || ''}`.toLowerCase();
  const body = `${input.summary || ''} ${(input.keyFacts || []).join(' ')} ${(input.matchSnippets || []).join(' ')}`.toLowerCase();
  const combined = `${titleUrl} ${body}`;
  let score = 0;
  const reasons: string[] = [];

  const matchedTerms = terms.filter(term => combined.includes(term));
  score += matchedTerms.length * 2;
  if (matchedTerms.length > 0) reasons.push(`matched terms: ${matchedTerms.slice(0, 6).join(', ')}`);

  const titleMatches = terms.filter(term => titleUrl.includes(term));
  score += titleMatches.length;
  if (titleMatches.length > 0) reasons.push('title/url relevance');

  if (/[$€£¥]|(?:usd|eur|gbp)|\b\d+(?:\.\d+)?\s*(?:%|tokens?|million|thousand|per|\/)\b/i.test(body)) {
    score += 3;
    reasons.push('numeric/pricing-style evidence');
  }
  if (/\b(?:api|pricing|price|cost|rate|input|output|token|tokens|model)\b/i.test(input.query)
    && /\b(?:api|pricing|price|cost|rate|input|output|token|tokens|model)\b/i.test(body)) {
    score += 3;
    reasons.push('query-specific evidence terms');
  }
  if ((input.keyFacts || []).length > 0) {
    score += 2;
    reasons.push('structured page facts');
  }

  const freshnessSensitive = isFreshnessSensitiveQuery(input.query);
  const currentYear = currentSearchYear();
  const referencedYears = extractReferencedYears([
    input.title,
    input.url,
    input.summary,
    ...(input.keyFacts || []),
    ...(input.matchSnippets || []),
    ...(input.dates || []),
  ]);
  const newestYear = referencedYears[0] ?? null;
  if (freshnessSensitive && newestYear !== null) {
    if (newestYear >= currentYear) {
      score += 5;
      reasons.push(`current-year evidence (${newestYear})`);
    } else if (newestYear === currentYear - 1) {
      score += 1;
      reasons.push(`recent evidence (${newestYear})`);
    } else {
      score -= 4;
      reasons.push(`stale evidence (${newestYear})`);
    }
  }

  return {
    score,
    reasons,
    sufficient: freshnessSensitive
      ? ((newestYear !== null && newestYear >= currentYear && score >= 9)
        || (matchedTerms.length >= Math.min(4, Math.max(2, terms.length)) && newestYear !== null && newestYear >= currentYear && score >= 8))
      : (score >= 9 || (matchedTerms.length >= Math.min(4, Math.max(2, terms.length)) && score >= 7)),
  };
}

export function requireBrowserCreated(): void {
  if (!browserService.isCreated()) {
    throw new Error('Browser surface is not initialized yet. Open the execution window before using browser tools.');
  }
}

export async function runBrowserOperation<K extends BrowserOperationKind>(
  kind: K,
  payload: BrowserOperationPayloadMap[K],
  input?: { invalidateCache?: boolean },
): Promise<BrowserOperationResult> {
  const result = await executeBrowserOperation({ kind, payload });
  if (input?.invalidateCache) invalidateBrowserCaches();
  return result;
}

export async function waitForBrowserSettled(timeoutMs = 7000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = browserService.getState();
    if (!state.navigation.isLoading) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

export async function cachePageForTab(pageExtractor: PageExtractor, tabId: string): Promise<{
  id: string;
  tabId: string;
  url: string;
  title: string;
  chunkIds: string[];
}> {
  const content = await pageExtractor.extractContent(tabId);
  const page = pageKnowledgeStore.cachePage({
    tabId,
    url: content.url,
    title: content.title,
    content: content.content,
    tier: content.tier,
  });
  return {
    id: page.id,
    tabId: page.tabId,
    url: page.url,
    title: page.title,
    chunkIds: page.chunkIds,
  };
}

export async function waitForCondition(input: {
  selector?: string;
  text?: string;
  state: 'present' | 'absent';
  tabId?: string;
  timeoutMs: number;
}): Promise<{ success: boolean; elapsedMs: number; matched: boolean }> {
  const start = Date.now();
  while (Date.now() - start < input.timeoutMs) {
    let matched = false;
    if (input.selector) {
      const query = JSON.stringify(input.selector);
      const result = await browserService.executeInPage(
        `Boolean(document.querySelector(${query}))`,
        input.tabId,
      );
      matched = result.result === true;
    }
    if (input.text) {
      const result = await browserService.executeInPage(
        buildWaitForTextExpression(),
        input.tabId,
      );
      matched = matched || (typeof result.result === 'string' && includesText(result.result, input.text));
    }

    const success = input.state === 'present' ? matched : !matched;
    if (success) {
      return { success: true, elapsedMs: Date.now() - start, matched };
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return { success: false, elapsedMs: Date.now() - start, matched: false };
}
