import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { probeSerps, canonicalizeUrl } from './serpProbe';

const FIXTURE_DIR = path.join(__dirname, '__fixtures__');

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
}

function makeFetch(
  responses: Partial<Record<'google' | 'duckduckgo' | 'bing', string | 'timeout' | 'error'>>,
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input as URL | Request).toString();
    let engine: 'google' | 'duckduckgo' | 'bing' | null = null;
    if (/google\.com/i.test(url)) engine = 'google';
    else if (/duckduckgo\.com/i.test(url)) engine = 'duckduckgo';
    else if (/bing\.com/i.test(url)) engine = 'bing';

    if (!engine) throw new Error(`Unexpected fetch to ${url}`);
    const body = responses[engine];
    if (!body) throw new Error(`No fixture for engine ${engine}`);
    if (body === 'error') throw new Error('simulated network error');
    if (body === 'timeout') {
      // Never resolve; caller must time us out.
      return new Promise<Response>(() => {});
    }
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
}

describe('canonicalizeUrl', () => {
  it('lowercases host and preserves path casing', () => {
    expect(canonicalizeUrl('https://Example.COM/Page/Foo')).toBe('https://example.com/Page/Foo');
  });

  it('strips utm_ / fbclid / gclid / ref / mc_ tracking params', () => {
    expect(
      canonicalizeUrl('https://example.com/page?utm_source=x&utm_medium=y&fbclid=z&gclid=w&ref=rss&id=keep'),
    ).toBe('https://example.com/page?id=keep');
  });

  it('drops the fragment', () => {
    expect(canonicalizeUrl('https://example.com/page#section')).toBe('https://example.com/page');
  });

  it('removes a trailing slash except on bare host', () => {
    expect(canonicalizeUrl('https://example.com/page/')).toBe('https://example.com/page');
    expect(canonicalizeUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('treats https and http as distinct protocols', () => {
    expect(canonicalizeUrl('http://example.com/page')).not.toBe(canonicalizeUrl('https://example.com/page'));
  });

  it('returns the original string on unparseable input', () => {
    expect(canonicalizeUrl('not a url')).toBe('not a url');
  });

  it('returns a stable canonical form regardless of param order', () => {
    const a = canonicalizeUrl('https://example.com/p?b=2&a=1');
    const b = canonicalizeUrl('https://example.com/p?a=1&b=2');
    expect(a).toBe(b);
  });
});

describe('probeSerps', () => {
  it('merges candidates across three engines, deduping by canonical URL', async () => {
    const result = await probeSerps('best espresso machines', {
      fetchImpl: makeFetch({
        google: loadFixture('google-results.html'),
        duckduckgo: loadFixture('duckduckgo-results.html'),
        bing: loadFixture('bing-results.html'),
      }),
    });

    expect(result.engines.google.hit).toBe(true);
    expect(result.engines.duckduckgo.hit).toBe(true);
    expect(result.engines.bing.hit).toBe(true);
    expect(result.engines.google.consentWall).toBe(false);
    expect(result.candidates.length).toBeGreaterThan(0);

    const page1 = result.candidates.find(c => c.url.includes('example.com/page1'));
    expect(page1).toBeDefined();
    expect(page1?.sources.length).toBeGreaterThanOrEqual(2);
  });

  it('records consent wall on Google but still returns DDG + Bing candidates', async () => {
    const result = await probeSerps('q', {
      fetchImpl: makeFetch({
        google: loadFixture('google-consent.html'),
        duckduckgo: loadFixture('duckduckgo-results.html'),
        bing: loadFixture('bing-results.html'),
      }),
    });

    expect(result.engines.google.consentWall).toBe(true);
    expect(result.engines.google.count).toBe(0);
    expect(result.engines.duckduckgo.hit).toBe(true);
    expect(result.engines.bing.hit).toBe(true);
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  it('records engine errors without throwing', async () => {
    const result = await probeSerps('q', {
      fetchImpl: makeFetch({ google: 'error', duckduckgo: 'error', bing: 'error' }),
    });

    expect(result.candidates).toEqual([]);
    expect(result.engines.google.error).toBeTruthy();
    expect(result.engines.duckduckgo.error).toBeTruthy();
    expect(result.engines.bing.error).toBeTruthy();
  });

  it('enforces per-engine timeout', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = makeFetch({ google: 'timeout', duckduckgo: 'timeout', bing: 'timeout' });
      const promise = probeSerps('q', { fetchImpl, timeoutMs: 1000 });
      await vi.advanceTimersByTimeAsync(1600);
      const result = await promise;
      expect(result.candidates).toEqual([]);
      expect(result.engines.google.error).toMatch(/timeout/i);
      expect(result.engines.duckduckgo.error).toMatch(/timeout/i);
      expect(result.engines.bing.error).toMatch(/timeout/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('deduplicates candidates via canonical URL and unions their sources', async () => {
    const googleHtml = `
      <div class="g"><a href="https://example.com/overlap?utm_source=g"><h3>Overlap title</h3></a><div class="VwiC3b">g snippet</div></div>
    `;
    const ddgHtml = `
      <div class="result"><a class="result__a" href="https://example.com/overlap/">Overlap title ddg</a><a class="result__snippet" href="https://example.com/overlap/">this is the longer and more informative duckduckgo snippet for the overlapping url</a></div>
    `;
    const bingHtml = `
      <li class="b_algo"><h2><a href="https://Example.com/overlap">Overlap</a></h2><div class="b_caption"><p>b snippet</p></div></li>
    `;
    const result = await probeSerps('overlap test', {
      fetchImpl: makeFetch({ google: googleHtml, duckduckgo: ddgHtml, bing: bingHtml }),
    });

    expect(result.candidates.length).toBe(1);
    const merged = result.candidates[0];
    expect(merged.sources.sort()).toEqual(['bing', 'duckduckgo', 'google']);
    expect(merged.bestRank).toBe(1);
    expect(merged.snippet).toMatch(/duckduckgo snippet/);
  });

  it('passes a desktop User-Agent and Accept header to each engine', async () => {
    const seenRequests: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as URL | Request).toString();
      const headers: Record<string, string> = {};
      const h = init?.headers as Record<string, string> | Headers | undefined;
      if (h instanceof Headers) {
        h.forEach((v, k) => {
          headers[k.toLowerCase()] = v;
        });
      } else if (h && typeof h === 'object') {
        for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = String(v);
      }
      seenRequests.push({ url, headers });
      return new Response('<html></html>', { status: 200 });
    }) as typeof fetch;

    await probeSerps('test', { fetchImpl });

    expect(seenRequests.length).toBe(3);
    for (const req of seenRequests) {
      expect(req.headers['user-agent']).toMatch(/Mozilla\/5\.0/);
      expect(req.headers['accept']).toMatch(/text\/html/);
    }
  });
});
