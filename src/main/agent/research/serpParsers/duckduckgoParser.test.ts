import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseDuckduckgoSerp } from './duckduckgoParser';

const FIXTURE_DIR = path.join(__dirname, '..', '__fixtures__');

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
}

describe('parseDuckduckgoSerp', () => {
  it('extracts candidates with title, url, snippet from the main results fixture', () => {
    const html = loadFixture('duckduckgo-results.html');
    const { candidates, consentWall } = parseDuckduckgoSerp(html);

    expect(consentWall).toBe(false);
    expect(candidates.length).toBeGreaterThanOrEqual(5);

    const first = candidates[0];
    expect(first.url).toBe('https://example.com/page1');
    expect(first.title).toBe('Example Page 1 Title');
    expect(first.snippet).toContain('concise summary of what example page 1');
    expect(first.serpRank).toBe(1);
    expect(first.serpSource).toBe('duckduckgo');
  });

  it('decodes //duckduckgo.com/l/?uddg= redirect wrappers', () => {
    const html = loadFixture('duckduckgo-results.html');
    const { candidates } = parseDuckduckgoSerp(html);
    const stackoverflow = candidates.find(c => c.url.includes('stackoverflow.com'));
    expect(stackoverflow).toBeDefined();
    expect(stackoverflow?.url).toBe('https://stackoverflow.com/questions/12345/how-to');
    expect(stackoverflow?.url).not.toContain('duckduckgo.com');
  });

  it('preserves direct non-wrapped URLs', () => {
    const html = loadFixture('duckduckgo-results.html');
    const { candidates } = parseDuckduckgoSerp(html);
    const github = candidates.find(c => c.url.startsWith('https://github.com'));
    expect(github).toBeDefined();
    expect(github?.title).toContain('example/project');
  });

  it('assigns serpRank in document order starting at 1', () => {
    const html = loadFixture('duckduckgo-results.html');
    const { candidates } = parseDuckduckgoSerp(html);
    for (let i = 0; i < candidates.length; i++) {
      expect(candidates[i].serpRank).toBe(i + 1);
    }
  });

  it('never reports a consent wall (DDG has none)', () => {
    const html = loadFixture('duckduckgo-results.html');
    const { consentWall } = parseDuckduckgoSerp(html);
    expect(consentWall).toBe(false);
  });

  it('returns empty candidates for malformed HTML without throwing', () => {
    expect(() => parseDuckduckgoSerp('<html><body>no results</body></html>')).not.toThrow();
    const { candidates } = parseDuckduckgoSerp('<html><body>no results</body></html>');
    expect(candidates).toEqual([]);
  });

  it('returns empty candidates for empty input', () => {
    const { candidates } = parseDuckduckgoSerp('');
    expect(candidates).toEqual([]);
  });

  it('skips results that lack a usable URL', () => {
    const html = `
      <div class="result">
        <a class="result__a" href="#">No URL</a>
      </div>
      <div class="result">
        <a class="result__a" href="https://valid.example.com">Valid</a>
        <a class="result__snippet" href="https://valid.example.com">snippet</a>
      </div>
    `;
    const { candidates } = parseDuckduckgoSerp(html);
    expect(candidates.length).toBe(1);
    expect(candidates[0].url).toBe('https://valid.example.com');
  });

  it('returns candidates even when snippet is missing', () => {
    const html = `
      <div class="result">
        <a class="result__a" href="https://nosnippet.example.com">Title only</a>
      </div>
    `;
    const { candidates } = parseDuckduckgoSerp(html);
    expect(candidates.length).toBe(1);
    expect(candidates[0].url).toBe('https://nosnippet.example.com');
    expect(candidates[0].snippet).toBe('');
  });
});
