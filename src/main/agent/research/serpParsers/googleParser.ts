import type { SerpCandidate } from '../types';

export type GoogleParseResult = {
  candidates: SerpCandidate[];
  consentWall: boolean;
};

// Patterns that mean Google is gating the page (consent interstitial,
// bot challenge, or a country redirect). When any of these fire we
// return zero candidates and let the caller fall back to the other
// engines the probe is fetching in parallel.
const CONSENT_MARKERS = [
  /action\s*=\s*["'][^"']*consent\.google\.com/i,
  /action\s*=\s*["'][^"']*\/sorry\/(index|CaptchaRedirect)/i,
  /id\s*=\s*["']captcha-form["']/i,
];

// Anchor opening tag; captures the href value in group 1 and the
// remaining attributes (if any). The `s` flag lets `.` cross newlines
// so inlined JSON-like attributes spanning lines still match.
const ANCHOR_RE = /<a\s+([^>]*?)href\s*=\s*["']([^"']+)["']([^>]*)>/gis;
// <h3 ...>Title</h3>, captures the inner text (no nested tags in the
// canonical Google structure; we strip any that leak in).
const H3_RE = /<h3\b[^>]*>([\s\S]*?)<\/h3>/i;

// Snippet candidates appear in these classes historically and in
// current Google HTML. We try them in order; the first non-empty
// match wins.
const SNIPPET_CLASSES = ['VwiC3b', 'IsZvec', 'MUxGbd', 'aCOpRe', 'st'];

// Internal Google URLs we never want as "results". We strip both
// google.com search pages (any host) and the commonly-linked Google
// sub-properties (support, accounts, policies, etc.) that are almost
// never what the user is researching.
const INTERNAL_GOOGLE_HOST_RE = /^(?:www|support|accounts|policies|maps|translate|books|news|ads|adservice|consent|myaccount|play|developers|workspace|cloud)\.google\.com$/i;
const INTERNAL_GOOGLE_PATH_RE = /^https?:\/\/(?:[\w-]+\.)*google\.com\/(?:search|preferences|advanced_search|imgres|intl|sorry|url)\b/i;

function hasConsentWall(html: string): boolean {
  return CONSENT_MARKERS.some(re => re.test(html));
}

function decodeRedirectUrl(href: string): string | null {
  // Google wraps external links as /url?q=REAL&sa=U&ved=... for
  // non-JS user agents. Decode the `q` param and discard the rest.
  if (href.startsWith('/url?') || href.startsWith('/url%3F')) {
    try {
      // Use a dummy base for relative URLs; the WHATWG parser will
      // decode the query string for us.
      const parsed = new URL(href, 'https://www.google.com');
      const q = parsed.searchParams.get('q');
      if (q && /^https?:\/\//i.test(q)) return q;
    } catch {
      // fall through
    }
    return null;
  }
  return href;
}

function normalizeHref(href: string): string | null {
  if (!href) return null;
  if (href.startsWith('#')) return null;
  if (href.startsWith('javascript:')) return null;

  const decoded = decodeRedirectUrl(href);
  if (!decoded) return null;

  // Accept absolute http(s) URLs only; drop mailto:, tel:, relative
  // search URLs, Google-internal paths, etc.
  let absolute = decoded;
  if (absolute.startsWith('//')) absolute = `https:${absolute}`;
  if (!/^https?:\/\//i.test(absolute)) return null;

  if (INTERNAL_GOOGLE_PATH_RE.test(absolute)) return null;
  try {
    const host = new URL(absolute).host;
    if (INTERNAL_GOOGLE_HOST_RE.test(host)) return null;
  } catch {
    return null;
  }

  return absolute;
}

// Find the index of the closing tag for the given tag name starting
// at `startIdx`, tracking depth so nested same-name tags don't break
// the match. Returns the index of the `<` character of the closing
// tag, or -1 if not found within `limit` characters.
function findBalancedClose(
  html: string,
  startIdx: number,
  tagName: string,
  limit: number,
): number {
  const openRe = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  const closeRe = new RegExp(`</${tagName}\\s*>`, 'gi');
  openRe.lastIndex = startIdx;
  closeRe.lastIndex = startIdx;
  const end = Math.min(html.length, startIdx + limit);
  let depth = 1;
  while (depth > 0) {
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    if (!nextClose || nextClose.index >= end) return -1;
    if (nextOpen && nextOpen.index < nextClose.index && nextOpen.index < end) {
      depth += 1;
      closeRe.lastIndex = nextOpen.index + nextOpen[0].length;
    } else {
      depth -= 1;
      if (depth === 0) return nextClose.index;
      openRe.lastIndex = nextClose.index + nextClose[0].length;
    }
  }
  return -1;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsaquo;|&#8250;/g, '›')
    .replace(/\s+/g, ' ')
    .trim();
}

// Look forward from the end of the anchor tag for the next snippet
// element. We stop at 4KB to avoid pulling noise from downstream
// results into this candidate's snippet.
const MAX_SNIPPET_SEARCH_WINDOW = 4096;

function findSnippet(html: string, anchorEndIdx: number): string {
  const windowEnd = Math.min(html.length, anchorEndIdx + MAX_SNIPPET_SEARCH_WINDOW);
  for (const cls of SNIPPET_CLASSES) {
    const openRe = new RegExp(
      `<(div|span|p)\\b[^>]*class\\s*=\\s*["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>`,
      'i',
    );
    const slice = html.slice(anchorEndIdx, windowEnd);
    const openMatch = openRe.exec(slice);
    if (!openMatch) continue;
    const openEnd = anchorEndIdx + openMatch.index + openMatch[0].length;
    const tagName = openMatch[1].toLowerCase();
    const closeIdx = findBalancedClose(html, openEnd, tagName, MAX_SNIPPET_SEARCH_WINDOW);
    if (closeIdx === -1) continue;
    const text = stripTags(html.slice(openEnd, closeIdx));
    if (text.length > 0) return text;
  }
  return '';
}

export function parseGoogleSerp(html: string): GoogleParseResult {
  if (!html) return { candidates: [], consentWall: false };
  if (hasConsentWall(html)) return { candidates: [], consentWall: true };

  const candidates: SerpCandidate[] = [];
  const seenUrls = new Set<string>();

  // Reset lastIndex in case a previous invocation on this module
  // left state (regex is global-flagged).
  ANCHOR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ANCHOR_RE.exec(html)) !== null) {
    const href = match[2];
    const anchorOpenEnd = match.index + match[0].length;
    // Find the matching </a> so we can scan the anchor body for <h3>.
    const closeIdx = html.indexOf('</a>', anchorOpenEnd);
    if (closeIdx === -1) continue;
    const body = html.slice(anchorOpenEnd, closeIdx);
    const h3Match = H3_RE.exec(body);
    if (!h3Match) continue;

    const url = normalizeHref(href);
    if (!url) continue;
    if (seenUrls.has(url)) continue;

    const title = stripTags(h3Match[1]);
    if (!title) continue;

    const snippet = findSnippet(html, closeIdx + '</a>'.length);

    seenUrls.add(url);
    candidates.push({
      url,
      title,
      snippet,
      serpRank: candidates.length + 1,
      serpSource: 'google',
    });
  }

  return { candidates, consentWall: false };
}
