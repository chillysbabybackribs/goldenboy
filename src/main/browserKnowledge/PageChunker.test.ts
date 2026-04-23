import { describe, expect, it } from 'vitest';
import { chunkPage, isLowDensity } from './PageChunker';

function realSentence(seed: string): string {
  return `This is a real content sentence about ${seed} with more words than a navigation label could reasonably contain. `;
}

describe('chunkPage', () => {
  const base = {
    pageId: 'pg_1',
    tabId: 'tab_1',
    url: 'https://example.com/a',
    title: 'Page title',
    createdAt: 1,
  };

  it('drops sections whose heading is a nav/related label (when other sections exist)', () => {
    const content = [
      '# Article body',
      realSentence('alpha').repeat(3),
      '',
      '# Related Articles',
      'Link 1\nLink 2\nLink 3',
      '',
      '# Footer',
      'Home About Contact',
    ].join('\n');
    const chunks = chunkPage({ ...base, content });
    const headings = chunks.map(c => c.heading);
    expect(headings).toContain('Article body');
    expect(headings).not.toContain('Related Articles');
    expect(headings).not.toContain('Footer');
  });

  it('keeps a nav-like heading when it is the ONLY section (never wipe a page entirely)', () => {
    const content = '# Menu\n\nHome\nAbout\nContact\nProducts\nPricing';
    const chunks = chunkPage({ ...base, content });
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('applies a density filter to drop link-list chunks when body chunks exist', () => {
    const body = realSentence('beta').repeat(6);
    const linkList = 'Home\nAbout\nContact\nPricing\nDocs\nBlog\nLogin\nRegister\nSupport';
    const content = [
      '# Body',
      body,
      '',
      '# Sidebar',
      linkList,
    ].join('\n');
    const chunks = chunkPage({ ...base, content });
    for (const chunk of chunks) {
      expect(chunk.heading).not.toBe('Sidebar');
    }
  });

  it('never returns zero chunks for non-empty content', () => {
    const chunks = chunkPage({ ...base, content: 'single short line of content' });
    expect(chunks.length).toBeGreaterThan(0);
  });
});

describe('isLowDensity', () => {
  it('returns true for a nav-style link list', () => {
    const text = 'Home\nAbout\nContact\nPricing\nDocs\nBlog';
    expect(isLowDensity(text)).toBe(true);
  });

  it('returns false for prose text with real sentences', () => {
    const text = [
      realSentence('one'),
      realSentence('two'),
      realSentence('three'),
      realSentence('four'),
    ].join('\n');
    expect(isLowDensity(text)).toBe(false);
  });

  it('abstains (returns false) when text is too short to judge', () => {
    expect(isLowDensity('short')).toBe(false);
    expect(isLowDensity('a\nb\nc')).toBe(false);
  });
});
