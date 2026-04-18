import { describe, expect, it } from 'vitest';
import { buildSandboxedHtmlDocument, parseCsvRows, renderMarkdownPreview } from './preview';

describe('document preview helpers', () => {
  it('renders headings and list items for markdown preview', () => {
    const html = renderMarkdownPreview('# Title\n\n- One\n- Two');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>One</li>');
  });

  it('parses csv rows using newline and comma splits', () => {
    expect(parseCsvRows('name,value\r\nalpha,1\nbeta,2')).toEqual([
      ['name', 'value'],
      ['alpha', '1'],
      ['beta', '2'],
    ]);
  });

  it('builds sandboxed html with interaction disabled', () => {
    const doc = buildSandboxedHtmlDocument('<a href=\"https://example.com\">Link</a>');
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain('pointer-events: none');
    expect(doc).toContain('<body><a href="https://example.com">Link</a></body>');
  });
});
