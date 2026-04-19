import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown.ts';

describe('renderMarkdown', () => {
  it('preserves explicit paragraph breaks', () => {
    const html = renderMarkdown('First paragraph.\n\nSecond paragraph.');

    expect(html).toContain('<p>First paragraph.</p>');
    expect(html).toContain('<p>Second paragraph.</p>');
  });

  it('splits dense prose into multiple readable paragraphs', () => {
    const html = renderMarkdown(
      'This is the first sentence of a dense response. Here is a second sentence that keeps expanding the same thought with more detail so the block becomes difficult to scan. This is a third sentence that should trigger a paragraph break for readability. Finally, this fourth sentence should land in a later paragraph instead of keeping everything clumped together.'
    );

    expect((html.match(/<p>/g) ?? []).length).toBeGreaterThan(1);
  });

  it('renders standalone section labels as headings', () => {
    const html = renderMarkdown('Changes:\nUpdated the renderer and improved spacing.');

    expect(html).toContain('<h3>Changes</h3>');
    expect(html).toContain('<p>Updated the renderer and improved spacing.</p>');
  });

  it('keeps markdown lists intact', () => {
    const html = renderMarkdown('- first item\n- second item');

    expect(html).toContain('<ul>');
    expect(html).toContain('<li>first item</li>');
    expect(html).toContain('<li>second item</li>');
  });
});
