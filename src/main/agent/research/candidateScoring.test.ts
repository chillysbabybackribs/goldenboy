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
