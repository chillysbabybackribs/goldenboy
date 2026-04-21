import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown.js';

describe('renderMarkdown', () => {
  describe('existing behavior', () => {
    it('renders plain paragraphs', () => {
      expect(renderMarkdown('Hello world')).toBe('<p>Hello world</p>');
    });

    it('joins wrapped paragraph lines with spaces', () => {
      expect(renderMarkdown('line one\nline two')).toBe('<p>line one line two</p>');
    });

    it('splits on blank lines', () => {
      expect(renderMarkdown('one\n\ntwo')).toBe('<p>one</p><p>two</p>');
    });

    it('renders headings, clamping deeper levels at h4', () => {
      expect(renderMarkdown('# big')).toBe('<h1>big</h1>');
      expect(renderMarkdown('#### four')).toBe('<h4>four</h4>');
      expect(renderMarkdown('###### deep')).toBe('<h4>deep</h4>');
    });

    it('renders unordered and ordered lists', () => {
      expect(renderMarkdown('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
      expect(renderMarkdown('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
    });

    it('applies inline bold and code formatting', () => {
      expect(renderMarkdown('Use `foo` and **bar**.')).toBe(
        '<p>Use <code>foo</code> and <strong>bar</strong>.</p>',
      );
    });

    it('escapes raw HTML in prose', () => {
      expect(renderMarkdown('<script>alert(1)</script>')).toBe(
        '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
      );
    });

    it('normalizes <br> tags to newlines inside paragraphs', () => {
      expect(renderMarkdown('one<br>two')).toBe('<p>one two</p>');
      expect(renderMarkdown('one<br><br>two')).toBe('<p>one</p><p>two</p>');
    });
  });

  describe('fenced code blocks', () => {
    it('renders triple-backtick blocks with language attribute', () => {
      const input = '```ts\nconst x = 1;\n```';
      const output = renderMarkdown(input);
      expect(output).toBe(
        '<pre data-lang="ts"><code class="language-ts">const x = 1;</code></pre>',
      );
    });

    it('renders unlabelled fences without a language attribute', () => {
      const output = renderMarkdown('```\nplain\n```');
      expect(output).toBe('<pre><code>plain</code></pre>');
    });

    it('escapes HTML inside fenced blocks', () => {
      const output = renderMarkdown('```html\n<div>&</div>\n```');
      expect(output).toContain('&lt;div&gt;&amp;&lt;/div&gt;');
    });

    it('preserves internal blank lines inside a fence', () => {
      const output = renderMarkdown('```\nline one\n\nline two\n```');
      expect(output).toBe('<pre><code>line one\n\nline two</code></pre>');
    });

    it('does not treat lone pipe rows inside a fence as tables', () => {
      const input = '```\n| a | b |\n|---|---|\n| 1 | 2 |\n```';
      const output = renderMarkdown(input);
      expect(output).toBe(
        '<pre><code>| a | b |\n|---|---|\n| 1 | 2 |</code></pre>',
      );
    });
  });

  describe('tables', () => {
    it('renders a GFM pipe table', () => {
      const input = '| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |';
      const output = renderMarkdown(input);
      expect(output).toContain('<table class="chat-markdown-table">');
      expect(output).toContain('<thead><tr><th>A</th><th>B</th></tr></thead>');
      expect(output).toContain('<tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody>');
    });

    it('honors column alignment hints', () => {
      const input = '| L | C | R |\n|:---|:---:|---:|\n| a | b | c |';
      const output = renderMarkdown(input);
      expect(output).toContain('<th style="text-align:left">L</th>');
      expect(output).toContain('<th style="text-align:center">C</th>');
      expect(output).toContain('<th style="text-align:right">R</th>');
      expect(output).toContain('<td style="text-align:left">a</td>');
      expect(output).toContain('<td style="text-align:center">b</td>');
      expect(output).toContain('<td style="text-align:right">c</td>');
    });

    it('applies inline formatting inside cells', () => {
      const input = '| Item | Note |\n|---|---|\n| `foo` | **bar** |';
      const output = renderMarkdown(input);
      expect(output).toContain('<td><code>foo</code></td>');
      expect(output).toContain('<td><strong>bar</strong></td>');
    });

    it('handles missing trailing cells gracefully', () => {
      const input = '| A | B | C |\n|---|---|---|\n| 1 | 2 |';
      const output = renderMarkdown(input);
      expect(output).toContain('<tr><td>1</td><td>2</td><td></td></tr>');
    });

    it('requires a separator row — plain pipe rows stay as paragraphs', () => {
      const output = renderMarkdown('| not | a table |');
      expect(output).toBe('<p>| not | a table |</p>');
    });

    it('wraps tables in a scroll container', () => {
      const output = renderMarkdown('| A | B |\n|---|---|\n| 1 | 2 |');
      expect(output.startsWith('<div class="chat-markdown-table-wrap">')).toBe(true);
      expect(output.endsWith('</table></div>')).toBe(true);
    });

    it('continues rendering surrounding blocks after a table', () => {
      const input = 'Intro paragraph.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nOutro line.';
      const output = renderMarkdown(input);
      expect(output.startsWith('<p>Intro paragraph.</p>')).toBe(true);
      expect(output.endsWith('<p>Outro line.</p>')).toBe(true);
      expect(output).toContain('<table class="chat-markdown-table">');
    });
  });

  describe('other blocks', () => {
    it('renders horizontal rules', () => {
      expect(renderMarkdown('above\n\n---\n\nbelow')).toBe('<p>above</p><hr><p>below</p>');
    });

    it('renders blockquotes', () => {
      expect(renderMarkdown('> quoted line')).toBe('<blockquote>quoted line</blockquote>');
    });
  });

  describe('inline links', () => {
    it('renders absolute file-path links as a retracted chip', () => {
      const output = renderMarkdown('See [AgentModelService.invoke()](/home/dp/Documents/goldenboy/src/main/agent/AgentModelService.ts:384) for details.');
      // The whole chip is a single `<details>` so it flows inline with the
      // surrounding prose — clicking the label reveals the path pill.
      expect(output).toContain('<details class="chat-file-ref">');
      expect(output).toContain('<summary class="chat-file-ref-text" title="/home/dp/Documents/goldenboy/src/main/agent/AgentModelService.ts:384">AgentModelService.invoke()</summary>');
      expect(output).toContain('<code class="chat-file-ref-path">/home/dp/Documents/goldenboy/src/main/agent/AgentModelService.ts:384</code>');
      // The raw path is NOT spliced inline next to the label as prose — it
      // only appears inside the collapsed details body so long paths don't
      // clutter the chat surface.
      expect(output).not.toContain('See /home/dp/Documents');
    });

    it('renders http/https links as external anchors', () => {
      const output = renderMarkdown('Visit [docs](https://example.com/guide).');
      expect(output).toContain('<a href="https://example.com/guide" class="chat-external-link" target="_blank" rel="noopener">docs</a>');
    });

    it('drops unsupported URL schemes but keeps the label', () => {
      const output = renderMarkdown('Ignore [bad](javascript:void0) text.');
      expect(output).toContain('<p>Ignore bad text.</p>');
      expect(output).not.toContain('href');
      expect(output).not.toContain('javascript:');
    });

    it('processes inline formatting inside the link label', () => {
      const output = renderMarkdown('[`foo`](/abs/path.ts)');
      expect(output).toContain('<summary class="chat-file-ref-text" title="/abs/path.ts"><code>foo</code></summary>');
    });

    it('escapes HTML inside the label and URL', () => {
      const output = renderMarkdown('[<evil>](/path/with<script>)');
      expect(output).toContain('&lt;evil&gt;');
      // URL chars are escaped before the link regex runs; the resulting
      // URL in the details body is the escaped form, not raw HTML.
      expect(output).toContain('/path/with&lt;script&gt;');
    });
  });
});
