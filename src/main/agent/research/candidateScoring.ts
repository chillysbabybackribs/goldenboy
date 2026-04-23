import type { MergedCandidate } from './serpProbe';
import { queryTerms } from './queryTerms';

export type ScoredCandidate = MergedCandidate & {
  qualityScore: number;
  qualityReasons: string[];
};

// TLDs we see dominated by spam / typo domains in SERPs. Matching
// is done on the full host, not just the last label, so `.co.xyz`
// type variants still hit.
const SPAM_TLDS = new Set(['xyz', 'top', 'click', 'loan', 'work', 'buzz', 'lol', 'tk', 'ml', 'ga', 'cf']);

// Boilerplate snippets usually mean the engine served a JS-gated
// shell or an error page; a SERP snippet of "Please enable
// JavaScript" is never useful content.
const BOILERPLATE_SNIPPET_RE = /please enable javascript|this site requires javascript|javascript is disabled|\berror 4\d{2}\b|page not found|404\s*(?:not found)?|access denied|just a moment/i;

// Hosts and host-suffixes we consider authoritative enough to boost. Bias is
// deliberately small so a perfect match on a random blog still beats a poor
// match on a reputable domain. Split by match type: exact host vs suffix.
const AUTHORITY_HOST_SUFFIXES = [
  '.wikipedia.org',
  '.wikimedia.org',
  '.github.com',
  '.github.io',
  '.mozilla.org',
  '.stackoverflow.com',
  '.stackexchange.com',
  '.arxiv.org',
  '.reuters.com',
  '.apnews.com',
  '.bbc.co.uk',
  '.bbc.com',
  '.npr.org',
  '.gov',
  '.edu',
  '.readthedocs.io',
  '.readthedocs.org',
];
const AUTHORITY_HOSTS_EXACT = new Set([
  'wikipedia.org',
  'github.com',
  'stackoverflow.com',
  'stackexchange.com',
  'arxiv.org',
  'mdn.io',
  'developer.mozilla.org',
  'reuters.com',
  'apnews.com',
  'bbc.co.uk',
  'bbc.com',
  'npr.org',
]);
const DOCS_SUBDOMAIN_RE = /^(docs|developer|developers|help|support|api|reference|learn)\./i;

// "Current" means this year or the prior year. Older pages often still answer
// the query, so we only _reward_ fresh markers rather than penalize old ones.
const CURRENT_YEAR = new Date().getUTCFullYear();
const FRESH_YEARS = new Set([
  String(CURRENT_YEAR),
  String(CURRENT_YEAR - 1),
]);
const YEAR_TOKEN_RE = /(?:^|[^\d])((?:19|20)\d{2})(?:[^\d]|$)/;

function tldOf(host: string): string {
  const parts = host.toLowerCase().split('.');
  return parts[parts.length - 1] ?? '';
}

function urlPathDepth(pathname: string): number {
  return pathname.split('/').filter(Boolean).length;
}

function matchCount(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  let n = 0;
  for (const t of terms) if (lower.includes(t)) n += 1;
  return n;
}

export function scoreCandidates(
  query: string,
  candidates: MergedCandidate[],
): ScoredCandidate[] {
  const terms = queryTerms(query);
  const phrase = normalizePhrase(query);

  const scored = candidates.map(c => {
    const reasons: string[] = [];
    let score = 0;

    // --- SERP rank inverse: rank 1 contributes the most. We cap
    //     the reward at rank 10 so deep results don't go negative
    //     from this signal alone.
    const rankContrib = Math.max(0, 10 - c.bestRank);
    score += rankContrib;
    if (rankContrib > 0) reasons.push(`rank ${c.bestRank} (+${rankContrib})`);

    // --- Query-term overlap in title (worth 2 each) and snippet
    //     (worth 1 each). Terms that match both don't double.
    const titleMatches = matchCount(c.title, terms);
    const snippetMatches = matchCount(c.snippet, terms);
    if (titleMatches > 0) {
      const delta = titleMatches * 2;
      score += delta;
      reasons.push(`title terms ${titleMatches} (+${delta})`);
    }
    if (snippetMatches > 0) {
      const delta = snippetMatches;
      score += delta;
      reasons.push(`snippet terms ${snippetMatches} (+${delta})`);
    }

    // --- Phrase match: the full normalized query appearing as a
    //     contiguous substring is much stronger than token overlap.
    if (phrase) {
      const titleLower = c.title.toLowerCase();
      const snippetLower = c.snippet.toLowerCase();
      if (titleLower.includes(phrase)) {
        score += 4;
        reasons.push('title phrase (+4)');
      } else if (snippetLower.includes(phrase)) {
        score += 2;
        reasons.push('snippet phrase (+2)');
      }
    }

    // --- Multi-engine agreement. Two engines agreeing on a URL
    //     is a strong relevance signal; three engines stronger.
    if (c.sources.length > 1) {
      const delta = 2 * (c.sources.length - 1);
      score += delta;
      reasons.push(`multi-engine agreement ${c.sources.length} (+${delta})`);
    }

    let host = '';
    let pathname = '/';
    let paramCount = 0;
    let isHttps = false;
    try {
      const parsed = new URL(c.url);
      host = parsed.host.toLowerCase();
      pathname = parsed.pathname;
      paramCount = Array.from(parsed.searchParams.keys()).length;
      isHttps = parsed.protocol === 'https:';
    } catch {
      // unparseable: skip host-based signals
    }

    // --- Clean-path bonus: short path, few params.
    if (host && urlPathDepth(pathname) <= 3 && paramCount <= 1) {
      score += 2;
      reasons.push('clean path (+2)');
    }

    if (isHttps) {
      score += 1;
      reasons.push('https (+1)');
    }

    // --- Authority bonus: well-known reference/docs domains get a
    //     modest boost. Kept small enough that a perfect match on
    //     an obscure blog can still beat a weak match on wikipedia.
    //     We weight +3 because canonical docs URLs are often deep
    //     (e.g. developer.mozilla.org/en-US/docs/Glossary/Debounce)
    //     and would otherwise forfeit the +2 clean-path bonus.
    if (host && isAuthorityHost(host)) {
      score += 3;
      reasons.push('authority host (+3)');
    } else if (host && DOCS_SUBDOMAIN_RE.test(host)) {
      score += 1;
      reasons.push('docs subdomain (+1)');
    }

    // --- Freshness: a recent year token in URL or title is a weak
    //     positive signal; we never penalize older pages because
    //     plenty of evergreen content predates the current year.
    const freshMarker = freshnessMarker(c.url, c.title);
    if (freshMarker) {
      score += 1;
      reasons.push(`fresh marker ${freshMarker} (+1)`);
    }

    if (host && SPAM_TLDS.has(tldOf(host))) {
      score -= 2;
      reasons.push('spam tld (-2)');
    }

    if (c.snippet && BOILERPLATE_SNIPPET_RE.test(c.snippet)) {
      score -= 2;
      reasons.push('boilerplate snippet (-2)');
    }

    if (/(^amp\.|\.amp\.)/i.test(host)) {
      score -= 3;
      reasons.push('amp subdomain (-3)');
    }

    return { ...c, qualityScore: score, qualityReasons: reasons };
  });

  scored.sort((a, b) => {
    if (b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore;
    return a.bestRank - b.bestRank;
  });
  return scored;
}

function normalizePhrase(query: string): string | null {
  const collapsed = query.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!collapsed || !collapsed.includes(' ')) return null;
  if (collapsed.length > 80) return null;
  return collapsed;
}

function isAuthorityHost(host: string): boolean {
  if (AUTHORITY_HOSTS_EXACT.has(host)) return true;
  for (const suffix of AUTHORITY_HOST_SUFFIXES) {
    if (host === suffix.slice(1) || host.endsWith(suffix)) return true;
  }
  return false;
}

function freshnessMarker(url: string, title: string): string | null {
  const urlMatch = url.match(YEAR_TOKEN_RE);
  if (urlMatch && FRESH_YEARS.has(urlMatch[1])) return urlMatch[1];
  const titleMatch = title.match(YEAR_TOKEN_RE);
  if (titleMatch && FRESH_YEARS.has(titleMatch[1])) return titleMatch[1];
  return null;
}

export function pickTopX(scored: ScoredCandidate[], x: number): ScoredCandidate[] {
  if (x <= 0) return [];
  // scored is already sorted by scoreCandidates; re-sort defensively
  // in case a caller mutated it.
  const copy = [...scored].sort((a, b) => {
    if (b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore;
    return a.bestRank - b.bestRank;
  });
  return copy.slice(0, x);
}
