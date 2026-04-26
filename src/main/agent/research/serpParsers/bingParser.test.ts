import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseBingSerp } from './bingParser';

const FIXTURE_DIR = path.join(__dirname, '..', '__fixtures__');

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
}

describe('parseBingSerp', () => {
  it('extracts candidates with title, url, snippet from the main results fixture', () => {
    const html = loadFixture('bing-results.html');
    const { candidates, consentWall } = parseBingSerp(html);

    expect(consentWall).toBe(false);
    expect(candidates.length).toBeGreaterThanOrEqual(5);

    const first = candidates[0];
    expect(first.url).toBe('https://example.com/page1');
    expect(first.title).toBe('Example Page 1 Title');
    expect(first.snippet).toContain('detailed snippet for example page 1');
    expect(first.serpRank).toBe(1);
    expect(first.serpSource).toBe('bing');
  });

  it('assigns serpRank in document order starting at 1', () => {
    const html = loadFixture('bing-results.html');
    const { candidates } = parseBingSerp(html);
    for (let i = 0; i < candidates.length; i++) {
      expect(candidates[i].serpRank).toBe(i + 1);
    }
  });

  it('skips ad results (b_ad class)', () => {
    const html = loadFixture('bing-results.html');
    const { candidates } = parseBingSerp(html);
    const sponsored = candidates.find(c => c.url.includes('ads.example.com'));
    expect(sponsored).toBeUndefined();
  });

  it('never reports a consent wall (Bing has none)', () => {
    const html = loadFixture('bing-results.html');
    const { consentWall } = parseBingSerp(html);
    expect(consentWall).toBe(false);
  });

  it('returns empty candidates for malformed HTML without throwing', () => {
    expect(() => parseBingSerp('<html><body>no results</body></html>')).not.toThrow();
    const { candidates } = parseBingSerp('<html><body>no results</body></html>');
    expect(candidates).toEqual([]);
  });

  it('returns empty candidates for empty input', () => {
    const { candidates } = parseBingSerp('');
    expect(candidates).toEqual([]);
  });

  it('skips b_algo blocks with unusable hrefs', () => {
    const html = `
      <li class="b_algo"><h2><a href="#">Bad</a></h2></li>
      <li class="b_algo"><h2><a href="javascript:void(0)">Bad2</a></h2></li>
      <li class="b_algo"><h2><a href="https://good.example.com">Good</a></h2><div class="b_caption"><p>ok</p></div></li>
    `;
    const { candidates } = parseBingSerp(html);
    expect(candidates.length).toBe(1);
    expect(candidates[0].url).toBe('https://good.example.com');
  });

  it('returns candidates even when snippet paragraph is missing', () => {
    const html = `
      <li class="b_algo"><h2><a href="https://nosnippet.example.com">Title only</a></h2></li>
    `;
    const { candidates } = parseBingSerp(html);
    expect(candidates.length).toBe(1);
    expect(candidates[0].url).toBe('https://nosnippet.example.com');
    expect(candidates[0].snippet).toBe('');
  });

  it('filters bing.com internal navigation URLs', () => {
    const html = `
      <li class="b_algo"><h2><a href="https://www.bing.com/search?q=other">Internal</a></h2></li>
      <li class="b_algo"><h2><a href="https://external.example.com">External</a></h2><div class="b_caption"><p>s</p></div></li>
    `;
    const { candidates } = parseBingSerp(html);
    expect(candidates.length).toBe(1);
    expect(candidates[0].url).toBe('https://external.example.com');
  });
});
