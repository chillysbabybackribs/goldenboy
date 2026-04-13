import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { normalizeNavigationTarget } from './navigationTarget';

describe('normalizeNavigationTarget', () => {
  it('preserves explicit URLs', () => {
    const result = normalizeNavigationTarget('https://example.com/docs', { searchEngine: 'google' });
    expect(result.kind).toBe('direct-url');
    expect(result.url).toBe('https://example.com/docs');
  });

  it('normalizes domain-only targets to https', () => {
    const result = normalizeNavigationTarget('example.com/pricing', { searchEngine: 'google' });
    expect(result.kind).toBe('direct-url');
    expect(result.url).toBe('https://example.com/pricing');
  });

  it('converts unsupported URL schemes to search', () => {
    const result = normalizeNavigationTarget('mailto:test@example.com', { searchEngine: 'google' });
    expect(result.kind).toBe('search');
    expect(result.url).toBe('https://www.google.com/search?q=mailto%3Atest%40example.com');
  });

  it('preserves explicit URLs with uppercase schemes', () => {
    const result = normalizeNavigationTarget('HTTP://example.com/path', { searchEngine: 'google' });
    expect(result.kind).toBe('direct-url');
    expect(result.url).toBe('HTTP://example.com/path');
  });

  it('keeps explicit file URLs as direct targets', () => {
    const result = normalizeNavigationTarget('file:///tmp/example.html', { searchEngine: 'google' });
    expect(result.kind).toBe('direct-url');
    expect(result.url).toBe('file:///tmp/example.html');
  });

  it('normalizes localhost and IP targets to http', () => {
    const localhost = normalizeNavigationTarget('localhost:5173/dashboard', { searchEngine: 'google' });
    const loopback = normalizeNavigationTarget('127.0.0.1:3000', { searchEngine: 'google' });
    expect(localhost.url).toBe('http://localhost:5173/dashboard');
    expect(loopback.url).toBe('http://127.0.0.1:3000');
  });

  it('resolves existing local file paths into file:// URLs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-nav-target-'));
    const filePath = path.join(dir, 'index.html');
    fs.writeFileSync(filePath, '<h1>hello</h1>', 'utf-8');

    const result = normalizeNavigationTarget(filePath, { searchEngine: 'google', cwd: dir });
    expect(result.kind).toBe('local-file');
    expect(result.url).toBe(pathToFileURL(filePath).href);
  });

  it('resolves relative file paths when cwd is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-nav-target-relative-'));
    const filePath = path.join(dir, 'local-page.html');
    fs.writeFileSync(filePath, '<h1>relative</h1>', 'utf-8');

    const result = normalizeNavigationTarget('local-page.html', { searchEngine: 'google', cwd: dir });
    expect(result.kind).toBe('local-file');
    expect(result.url).toBe(pathToFileURL(filePath).href);
  });

  it('falls back to search for plain text queries', () => {
    const result = normalizeNavigationTarget('best coffee beans for espresso', { searchEngine: 'google' });
    expect(result.kind).toBe('search');
    expect(result.url).toContain('https://www.google.com/search?q=');
    expect(result.url).toContain('best%20coffee%20beans%20for%20espresso');
  });
});
