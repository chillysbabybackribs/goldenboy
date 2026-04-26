import type { SerpCandidate } from '../types';

export type DuckduckgoParseResult = {
  candidates: SerpCandidate[];
  consentWall: boolean;
};

// DDG html-lite wraps outbound links through /l/?uddg=<encoded>. We
// decode so callers see the real destination. Direct hrefs (starting
// with http://... or https://...) pass through unchanged.
function decodeRedirect(href: string): string | null {
  if (!href) return null;
  if (href.startsWith('#') || href.startsWith('javascript:')) return null;

  let absolute = href;
  if (absolute.startsWith('//')) absolute = `https:${absolute}`;

  try {
    const parsed = new URL(absolute);
    if (/duckduckgo\.com$/i.test(parsed.host) && parsed.pathname.startsWith('/l/')) {
      const real = parsed.searchParams.get('uddg');
      if (real && /^https?:\/\//i.test(real)) return real;
      return null;
    }
    if (!/^https?:$/i.test(parsed.protocol)) return null;
    // Return the validated input rather than parsed.toString() —
    // WHATWG would append a trailing slash to bare hosts which we
    // want to preserve verbatim for downstream canonicalization.
    return absolute;
  } catch {
    return null;
  }
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
    .replace(/\s+/g, ' ')
    .trim();
}

const TITLE_ANCHOR_RE = /<a\b[^>]*class\s*=\s*["'][^"']*\bresult__a\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
const HREF_RE = /href\s*=\s*["']([^"']+)["']/i;
const SNIPPET_RE = /<a\b[^>]*class\s*=\s*["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i;

// DDG-lite keeps each result inside <div class="result ...">. We use
// the closing position of that container as the upper bound when
// looking for the snippet for this candidate, so we don't pull the
// next result's snippet in.
const RESULT_BLOCK_SEARCH_AFTER_ANCHOR = 2048;

export function parseDuckduckgoSerp(html: string): DuckduckgoParseResult {
  if (!html) return { candidates: [], consentWall: false };

  const candidates: SerpCandidate[] = [];
  const seenUrls = new Set<string>();

  TITLE_ANCHOR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TITLE_ANCHOR_RE.exec(html)) !== null) {
    const anchorTag = match[0];
    const titleInner = match[1];
    const hrefMatch = HREF_RE.exec(anchorTag);
    if (!hrefMatch) continue;

    const url = decodeRedirect(hrefMatch[1]);
    if (!url) continue;
    if (seenUrls.has(url)) continue;

    const title = stripTags(titleInner);
    if (!title) continue;

    const afterAnchor = match.index + match[0].length;
    const windowEnd = Math.min(html.length, afterAnchor + RESULT_BLOCK_SEARCH_AFTER_ANCHOR);
    const snippetMatch = SNIPPET_RE.exec(html.slice(afterAnchor, windowEnd));
    const snippet = snippetMatch ? stripTags(snippetMatch[1]) : '';

    seenUrls.add(url);
    candidates.push({
      url,
      title,
      snippet,
      serpRank: candidates.length + 1,
      serpSource: 'duckduckgo',
    });
  }

  return { candidates, consentWall: false };
}
