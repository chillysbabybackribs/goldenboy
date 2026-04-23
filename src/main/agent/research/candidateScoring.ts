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
