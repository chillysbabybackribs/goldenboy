import { describe, it, expect } from 'vitest';
import { scoreCandidates, pickTopX } from './candidateScoring';
import type { MergedCandidate } from './serpProbe';

function makeCandidate(overrides: Partial<MergedCandidate>): MergedCandidate {
  return {
    url: 'https://example.com/page',
    title: 'Example',
    snippet: 'example snippet',
    bestRank: 1,
    sources: ['google'],
    ...overrides,
  };
}

describe('scoreCandidates', () => {
  it('ranks high-quality multi-source rank-1 candidates at the top', () => {
    const candidates: MergedCandidate[] = [
      makeCandidate({
        url: 'https://docs.example.org/espresso-guide',
        title: 'Best Espresso Machines: Definitive Guide',
        snippet: 'Detailed guide to espresso machines with reviews.',
        bestRank: 1,
        sources: ['google', 'duckduckgo', 'bing'],
      }),
      makeCandidate({
        url: 'https://spam.xyz/page?id=x&utm=1',
        title: 'click here',
        snippet: 'please enable javascript to continue',
        bestRank: 9,
        sources: ['bing'],
      }),
    ];
    const scored = scoreCandidates('best espresso machines', candidates);
    expect(scored[0].url).toContain('docs.example.org');
    expect(scored[0].qualityScore).toBeGreaterThan(scored[1].qualityScore);
  });

  it('applies a multi-engine agreement bonus', () => {
    const solo = scoreCandidates('x', [
      makeCandidate({ title: 'x page', sources: ['google'], bestRank: 3 }),
    ]);
    const trio = scoreCandidates('x', [
      makeCandidate({
        title: 'x page',
        sources: ['google', 'duckduckgo', 'bing'],
        bestRank: 3,
      }),
    ]);
    expect(trio[0].qualityScore).toBeGreaterThan(solo[0].qualityScore);
    expect(trio[0].qualityReasons.join(' ')).toMatch(/multi-engine|agreement/i);
  });

  it('penalizes spam TLDs', () => {
    const scored = scoreCandidates('test query', [
      makeCandidate({ url: 'https://good.example.com/page', title: 'test query result' }),
      makeCandidate({ url: 'https://bad.xyz/page', title: 'test query result' }),
    ]);
    const good = scored.find(s => s.url.includes('example.com'))!;
    const bad = scored.find(s => s.url.includes('.xyz'))!;
    expect(good.qualityScore).toBeGreaterThan(bad.qualityScore);
  });

  it('penalizes boilerplate snippets', () => {
    const scored = scoreCandidates('widget docs', [
      makeCandidate({
        url: 'https://a.example.com/docs',
        title: 'widget docs',
        snippet: 'A complete walkthrough of widget docs with examples.',
      }),
      makeCandidate({
        url: 'https://b.example.com/docs',
        title: 'widget docs',
        snippet: 'Please enable JavaScript to view this page',
      }),
    ]);
    const a = scored.find(s => s.url.includes('a.example.com'))!;
    const b = scored.find(s => s.url.includes('b.example.com'))!;
    expect(a.qualityScore).toBeGreaterThan(b.qualityScore);
  });

  it('rewards HTTPS over HTTP', () => {
    const scored = scoreCandidates('x', [
      makeCandidate({ url: 'https://secure.example.com/p', title: 'x page' }),
      makeCandidate({ url: 'http://insecure.example.com/p', title: 'x page' }),
    ]);
    const secure = scored.find(s => s.url.startsWith('https://'))!;
    const insecure = scored.find(s => s.url.startsWith('http://'))!;
    expect(secure.qualityScore).toBeGreaterThan(insecure.qualityScore);
  });

  it('rewards clean URL paths', () => {
    const scored = scoreCandidates('x', [
      makeCandidate({ url: 'https://a.example.com/docs', title: 'x docs' }),
      makeCandidate({
        url: 'https://b.example.com/a/b/c/d/e/f/page?p1=1&p2=2&p3=3&p4=4',
        title: 'x docs',
      }),
    ]);
    const clean = scored.find(s => s.url.startsWith('https://a.'))!;
    const noisy = scored.find(s => s.url.startsWith('https://b.'))!;
    expect(clean.qualityScore).toBeGreaterThan(noisy.qualityScore);
  });

  it('penalizes AMP URLs in favor of canonical non-AMP', () => {
    const scored = scoreCandidates('x', [
      makeCandidate({ url: 'https://example.com/page', title: 'x page' }),
      makeCandidate({ url: 'https://amp.example.com/page', title: 'x page' }),
    ]);
    const canonical = scored.find(s => s.url === 'https://example.com/page')!;
    const amp = scored.find(s => s.url.includes('amp.'))!;
    expect(canonical.qualityScore).toBeGreaterThan(amp.qualityScore);
  });

  it('scores query-term matches in title and snippet', () => {
    const scored = scoreCandidates('debounce function javascript', [
      makeCandidate({
        url: 'https://mdn.example.com/debounce',
        title: 'Debounce function in JavaScript - MDN',
        snippet: 'How to implement debounce in JavaScript with examples.',
      }),
      makeCandidate({
        url: 'https://unrelated.example.com/page',
        title: 'Unrelated content',
        snippet: 'Talks about something else entirely.',
      }),
    ]);
    const relevant = scored.find(s => s.url.includes('mdn'))!;
    const irrelevant = scored.find(s => s.url.includes('unrelated'))!;
    expect(relevant.qualityScore).toBeGreaterThan(irrelevant.qualityScore);
  });

  it('returns scored results in descending quality order', () => {
    const candidates: MergedCandidate[] = [
      makeCandidate({ url: 'https://a.com/p', title: 'unrelated', bestRank: 8, sources: ['bing'] }),
      makeCandidate({ url: 'https://b.com/p', title: 'test query docs', bestRank: 1, sources: ['google', 'bing'] }),
      makeCandidate({ url: 'https://c.com/p', title: 'test query ref', bestRank: 3, sources: ['google'] }),
    ];
    const scored = scoreCandidates('test query', candidates);
    for (let i = 1; i < scored.length; i++) {
      expect(scored[i - 1].qualityScore).toBeGreaterThanOrEqual(scored[i].qualityScore);
    }
  });
});

describe('scoreCandidates (phrase / authority / freshness)', () => {
  it('boosts candidates whose title contains the full query phrase over scattered-term candidates', () => {
    const scored = scoreCandidates('gpt5 pricing', [
      makeCandidate({
        url: 'https://a.example.com/gpt5-pricing',
        title: 'GPT5 pricing announced',
        snippet: 'Full breakdown of GPT5 pricing tiers.',
      }),
      makeCandidate({
        url: 'https://b.example.com/gpt5-overview',
        title: 'GPT5 overview and technical details',
        snippet: 'Some details on GPT5; pricing is covered separately.',
      }),
    ]);
    const phrase = scored.find(s => s.url.includes('a.example.com'))!;
    const scattered = scored.find(s => s.url.includes('b.example.com'))!;
    expect(phrase.qualityScore).toBeGreaterThan(scattered.qualityScore);
    expect(phrase.qualityReasons.join(' ')).toMatch(/phrase/i);
  });

  it('gives a modest authority boost to well-known reference hosts', () => {
    const scored = scoreCandidates('debounce function', [
      makeCandidate({
        url: 'https://developer.mozilla.org/en-US/docs/Glossary/Debounce',
        title: 'Debounce function',
        snippet: 'MDN reference on debounce function.',
      }),
      makeCandidate({
        url: 'https://random-blog.example/debounce-function',
        title: 'Debounce function',
        snippet: 'Random blog post about debounce function.',
      }),
    ]);
    const mdn = scored.find(s => s.url.includes('mozilla.org'))!;
    const blog = scored.find(s => s.url.includes('random-blog'))!;
    expect(mdn.qualityScore).toBeGreaterThan(blog.qualityScore);
    expect(mdn.qualityReasons.join(' ')).toMatch(/authority/i);
    // Authority bonus must exceed clean-path differential since canonical docs
    // URLs are often deep and don't qualify for the clean-path bonus.
    expect(mdn.qualityScore - blog.qualityScore).toBeGreaterThanOrEqual(1);
  });

  it('gives a docs-subdomain boost when the host starts with docs./api./reference.', () => {
    const scored = scoreCandidates('widget api', [
      makeCandidate({
        url: 'https://docs.example.org/widget-api',
        title: 'Widget API',
        snippet: 'Reference for the widget API.',
      }),
      makeCandidate({
        url: 'https://blog.example.org/widget-api-thoughts',
        title: 'Widget API thoughts',
        snippet: 'My thoughts on the widget API.',
      }),
    ]);
    const docs = scored.find(s => s.url.includes('docs.'))!;
    const blog = scored.find(s => s.url.includes('blog.'))!;
    expect(docs.qualityScore).toBeGreaterThan(blog.qualityScore);
  });

  it('rewards a current-year marker in URL/title (without penalizing older content)', () => {
    const year = new Date().getUTCFullYear();
    const scored = scoreCandidates('widget', [
      makeCandidate({
        url: `https://a.example.com/widget/${year}`,
        title: `Widget review ${year}`,
        snippet: 'Widget guide.',
      }),
      makeCandidate({
        url: 'https://b.example.com/widget/2015',
        title: 'Widget review 2015',
        snippet: 'Widget guide.',
      }),
    ]);
    const fresh = scored.find(s => s.url.includes(`/${year}`))!;
    const stale = scored.find(s => s.url.includes('/2015'))!;
    expect(fresh.qualityScore).toBeGreaterThan(stale.qualityScore);
    // Both should still have a positive score — we never punish older content.
    expect(stale.qualityScore).toBeGreaterThan(0);
  });
});

describe('pickTopX', () => {
  it('returns exactly X candidates', () => {
    const scored = scoreCandidates('x', [
      makeCandidate({ url: 'https://a.com/p', title: 'x 1' }),
      makeCandidate({ url: 'https://b.com/p', title: 'x 2' }),
      makeCandidate({ url: 'https://c.com/p', title: 'x 3' }),
      makeCandidate({ url: 'https://d.com/p', title: 'x 4' }),
    ]);
    expect(pickTopX(scored, 2)).toHaveLength(2);
    expect(pickTopX(scored, 10)).toHaveLength(4);
    expect(pickTopX(scored, 0)).toHaveLength(0);
  });

  it('breaks ties by bestRank ascending', () => {
    const scored = scoreCandidates('x', [
      makeCandidate({ url: 'https://a.com/p', title: 'x page', bestRank: 5 }),
      makeCandidate({ url: 'https://b.com/p', title: 'x page', bestRank: 1 }),
    ]);
    const top1 = pickTopX(scored, 1);
    expect(top1[0].url).toBe('https://b.com/p');
  });
});
