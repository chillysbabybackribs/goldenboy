import { queryTerms } from './queryTerms';

export type EvidenceInput = {
  query: string;
  title?: string;
  url?: string;
  summary?: string;
  keyFacts?: string[];
  matchSnippets?: string[];
};

export type EvidenceScore = {
  score: number;
  reasons: string[];
  sufficient: boolean;
};

// Maximum snippet length we'll ever surface to the model. 200 is a
// pragmatic balance: long enough to convey context, short enough
// that 5 snippets fit in a single turn budget.
const MAX_SNIPPET_CHARS = 200;

// Leading-date patterns. Google SERPs routinely prefix snippets
// with "Jan 12, 2024 —" even when the body has nothing to do with
// that date. Stripping cleans noise at the head of the snippet only.
const LEADING_DATE_RE =
  /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember|t)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\s*[-\u2014\u2013:]?\s*/i;
const LEADING_RATING_RE = /^[\d.]+\s*(?:★|\u2605)\s*[-\u2014\u2013:]?\s*/;
const LEADING_RESULTS_HEADER_RE =
  /^About\s+[\d,]+\s+results?\s*\([^)]*\)\s*/i;

export function cleanSnippet(raw: string): string {
  let s = (raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';

  let changed = true;
  while (changed) {
    changed = false;
    if (LEADING_RESULTS_HEADER_RE.test(s)) {
      s = s.replace(LEADING_RESULTS_HEADER_RE, '').trim();
      changed = true;
    }
    if (LEADING_DATE_RE.test(s)) {
      s = s.replace(LEADING_DATE_RE, '').trim();
      changed = true;
    }
    if (LEADING_RATING_RE.test(s)) {
      s = s.replace(LEADING_RATING_RE, '').trim();
      changed = true;
    }
  }

  if (s.length > MAX_SNIPPET_CHARS) s = s.slice(0, MAX_SNIPPET_CHARS);
  return s;
}

export function scoreEvidence(input: EvidenceInput): EvidenceScore {
  const terms = queryTerms(input.query);
  const titleUrl = `${input.title || ''} ${input.url || ''}`.toLowerCase();

  // If matchSnippets is empty (the page cache had no chunks for
  // this query), fall back to summary+keyFacts as the body text so
  // a valid page with no cached chunks still produces a signal.
  const snippetBody = (input.matchSnippets || []).join(' ');
  const fallbackBody = `${input.summary || ''} ${(input.keyFacts || []).join(' ')}`;
  const body = (snippetBody.trim() ? snippetBody : fallbackBody).toLowerCase();
  const combined = `${titleUrl} ${body}`;

  let score = 0;
  const reasons: string[] = [];

  const matchedTerms = terms.filter(term => combined.includes(term));
  if (matchedTerms.length > 0) {
    score += matchedTerms.length * 2;
    reasons.push(`matched terms: ${matchedTerms.slice(0, 6).join(', ')}`);
  }

  const titleMatches = terms.filter(term => titleUrl.includes(term));
  if (titleMatches.length > 0) {
    score += titleMatches.length;
    reasons.push('title/url relevance');
  }

  // Only reward structured facts on pages that are already relevant
  // — otherwise every unrelated page with a keyFacts list gets free
  // points.
  if ((input.keyFacts || []).length > 0 && matchedTerms.length > 0) {
    score += 2;
    reasons.push('structured page facts');
  }

  // `sufficient` now requires BOTH meaningful term coverage AND a
  // base score. The old threshold of 9 was only reachable because
  // the pricing-vocabulary bonus added 3+3 "for free" on any page
  // that mentioned dollars. Removing that bonus requires a lower
  // absolute floor.
  const requiredMatches = Math.min(3, terms.length);
  const sufficient =
    matchedTerms.length >= requiredMatches && score >= 6;

  return { score, reasons, sufficient };
}
