import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseGoogleSerp } from './googleParser';

const FIXTURE_DIR = path.join(__dirname, '..', '__fixtures__');

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
}

describe('parseGoogleSerp', () => {
  it('extracts candidates with title, url, snippet from the main results fixture', () => {
    const html = loadFixture('google-results.html');
    const { candidates, consentWall } = parseGoogleSerp(html);

    expect(consentWall).toBe(false);
    expect(candidates.length).toBeGreaterThanOrEqual(5);

    const first = candidates[0];
    expect(first.url).toBe('https://example.com/page1');
    expect(first.title).toBe('Example Page 1 — Definitive Guide');
    expect(first.snippet).toContain('detailed snippet for example page 1');
    expect(first.serpRank).toBe(1);
    expect(first.serpSource).toBe('google');
  });

  it('decodes /url?q= redirect wrappers', () => {
    const html = loadFixture('google-results.html');
    const { candidates } = parseGoogleSerp(html);
    const stackoverflow = candidates.find(c => c.url.includes('stackoverflow.com'));
    expect(stackoverflow).toBeDefined();
    expect(stackoverflow?.url).toBe('https://stackoverflow.com/questions/12345/how-to');
    expect(stackoverflow?.url).not.toContain('/url?q=');
  });

  it('preserves direct non-wrapped URLs', () => {
    const html = loadFixture('google-results.html');
    const { candidates } = parseGoogleSerp(html);
    const docs = candidates.find(c => c.url.startsWith('https://docs.example.org'));
    const github = candidates.find(c => c.url.startsWith('https://github.com'));
    expect(docs).toBeDefined();
    expect(github).toBeDefined();
  });

  it('assigns serpRank in document order starting at 1', () => {
    const html = loadFixture('google-results.html');
    const { candidates } = parseGoogleSerp(html);
    for (let i = 0; i < candidates.length; i++) {
      expect(candidates[i].serpRank).toBe(i + 1);
    }
  });

  it('detects consent walls and returns no candidates', () => {
    const html = loadFixture('google-consent.html');
    const { candidates, consentWall } = parseGoogleSerp(html);
    expect(consentWall).toBe(true);
    expect(candidates).toEqual([]);
  });

  it('returns empty candidates for malformed HTML without throwing', () => {
    expect(() => parseGoogleSerp('<html><body>no results here</body></html>')).not.toThrow();
    const { candidates, consentWall } = parseGoogleSerp('<html><body>no results here</body></html>');
    expect(candidates).toEqual([]);
    expect(consentWall).toBe(false);
  });

  it('returns empty candidates for empty input', () => {
    const { candidates, consentWall } = parseGoogleSerp('');
    expect(candidates).toEqual([]);
    expect(consentWall).toBe(false);
  });

  it('skips results that lack a usable URL', () => {
    const html = `
      <div class="g"><div><a href="#"><h3>No URL</h3></a></div></div>
      <div class="g"><div><a href="https://valid.example.com"><h3>Valid</h3></a><div class="VwiC3b">snippet</div></div></div>
    `;
    const { candidates } = parseGoogleSerp(html);
    expect(candidates.length).toBe(1);
    expect(candidates[0].url).toBe('https://valid.example.com');
  });

  it('skips internal Google links (search/preferences/support)', () => {
    const html = `
      <div class="g"><a href="/search?q=other"><h3>Internal search</h3></a></div>
      <div class="g"><a href="https://support.google.com/help"><h3>Google Support</h3></a></div>
      <div class="g"><a href="https://real.example.com"><h3>Real result</h3></a><div class="VwiC3b">s</div></div>
    `;
    const { candidates } = parseGoogleSerp(html);
    expect(candidates.length).toBe(1);
    expect(candidates[0].url).toBe('https://real.example.com');
  });

  it('handles the /sorry/index bot challenge as a consent wall', () => {
    const html = `
      <html><body>
        <form action="/sorry/index" method="POST">
          <input type="hidden" name="continue" value="https://www.google.com/search">
        </form>
      </body></html>
    `;
    expect(parseGoogleSerp(html).consentWall).toBe(true);
  });
});
