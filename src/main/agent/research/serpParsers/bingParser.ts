import type { SerpCandidate } from '../types';

export type BingParseResult = {
  candidates: SerpCandidate[];
  consentWall: boolean;
};

// Each organic Bing result is wrapped in <li class="b_algo"> (ads
// use class="b_ad" which we skip). Titles live in the first <h2>
// inside the <li> with a nested anchor; snippet lives in a following
// <div class="b_caption"><p>...</p></div>.
const ALGO_BLOCK_RE = /<li\b[^>]*class\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/li>/gi;
const H2_ANCHOR_RE = /<h2\b[^>]*>\s*<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h2>/i;
const CAPTION_P_RE = /<div\b[^>]*class\s*=\s*["'][^"']*\bb_caption\b[^"']*["'][^>]*>[\s\S]*?<p\b[^>]*>([\s\S]*?)<\/p>/i;

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

function normalizeHref(href: string): string | null {
  if (!href) return null;
  if (href.startsWith('#') || href.startsWith('javascript:')) return null;
  if (!/^https?:\/\//i.test(href)) return null;
  try {
    const host = new URL(href).host;
    // Bing internal navigation and Microsoft account URLs are never
    // what a researcher is after.
    if (/^(?:www\.)?bing\.com$/i.test(host)) return null;
    if (/^(?:login|account)\.live\.com$/i.test(host)) return null;
  } catch {
    return null;
  }
  return href;
}

export function parseBingSerp(html: string): BingParseResult {
  if (!html) return { candidates: [], consentWall: false };

  const candidates: SerpCandidate[] = [];
  const seenUrls = new Set<string>();

  ALGO_BLOCK_RE.lastIndex = 0;
  let block: RegExpExecArray | null;
  while ((block = ALGO_BLOCK_RE.exec(html)) !== null) {
    const classes = block[1];
    // Skip ads — `b_ad` is Bing's sponsored-result marker. We keep
    // `b_algo` plus any algo variants like `b_algo_group`.
    if (!/\bb_algo\b/i.test(classes)) continue;
    if (/\bb_ad\b/i.test(classes)) continue;

    const body = block[2];
    const anchorMatch = H2_ANCHOR_RE.exec(body);
    if (!anchorMatch) continue;

    const url = normalizeHref(anchorMatch[1]);
    if (!url) continue;
    if (seenUrls.has(url)) continue;

    const title = stripTags(anchorMatch[2]);
    if (!title) continue;

    const captionMatch = CAPTION_P_RE.exec(body);
    const snippet = captionMatch ? stripTags(captionMatch[1]) : '';

    seenUrls.add(url);
    candidates.push({
      url,
      title,
      snippet,
      serpRank: candidates.length + 1,
      serpSource: 'bing',
    });
  }

  return { candidates, consentWall: false };
}
