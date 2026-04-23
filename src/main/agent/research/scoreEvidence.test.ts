import { describe, it, expect } from 'vitest';
import { scoreEvidence, cleanSnippet } from './scoreEvidence';

describe('cleanSnippet', () => {
  it('strips a leading month-day-year date with an em-dash or hyphen', () => {
    expect(cleanSnippet('Jan 12, 2024 — How to debounce in JavaScript')).toBe(
      'How to debounce in JavaScript',
    );
    expect(cleanSnippet('Feb 3, 2023 - Real body content here')).toBe(
      'Real body content here',
    );
    expect(cleanSnippet('December 25 2023 — body')).toBe('body');
  });

  it('strips a leading rating like "4.5 ★"', () => {
    expect(cleanSnippet('4.5 ★ Great coffee machine')).toBe('Great coffee machine');
    expect(cleanSnippet('5 ★ Best ever')).toBe('Best ever');
  });

  it('strips the Google "About N results" header', () => {
    expect(cleanSnippet('About 1,230,000 results (0.42 seconds) Body text here')).toBe(
      'Body text here',
    );
  });

  it('collapses whitespace', () => {
    expect(cleanSnippet('multiple   spaces\t\tand\nnewlines')).toBe(
      'multiple spaces and newlines',
    );
  });

  it('caps output at 200 characters', () => {
    const long = 'x'.repeat(500);
    expect(cleanSnippet(long).length).toBe(200);
  });

  it('handles empty and whitespace input gracefully', () => {
    expect(cleanSnippet('')).toBe('');
    expect(cleanSnippet('   \t  ')).toBe('');
  });

  it('leaves a clean snippet unchanged', () => {
    expect(cleanSnippet('A plain, clean snippet about testing.')).toBe(
      'A plain, clean snippet about testing.',
    );
  });

  it('does not strip dates inside the body', () => {
    expect(cleanSnippet('Released on Jan 12, 2024 with new features.')).toBe(
      'Released on Jan 12, 2024 with new features.',
    );
  });
});

describe('scoreEvidence (rewritten)', () => {
  it('does not grant a free pricing bonus to non-pricing queries', () => {
    const priceish = scoreEvidence({
      query: 'gpt 4 api pricing per token',
      title: 'Pricing | OpenAI',
      url: 'https://openai.com/pricing',
      summary: '$10/M input tokens, $30/M output tokens for gpt-4.',
      keyFacts: ['Input: $10 per million tokens', 'Output: $30 per million tokens'],
      matchSnippets: [],
    });
    const nonPrice = scoreEvidence({
      query: 'how to write a debounce function in javascript',
      title: 'Debounce function - MDN',
      url: 'https://developer.mozilla.org/en-US/docs/debounce',
      summary: 'A debounce function delays invoking until after wait ms have elapsed.',
      keyFacts: ['Used to limit execution of a handler'],
      matchSnippets: [],
    });
    expect(priceish.score).toBeGreaterThan(0);
    expect(nonPrice.score).toBeGreaterThan(0);
    expect(nonPrice.reasons.join(' ')).not.toMatch(/pricing/i);
  });

  it('non-pricing query on a relevant MDN-like page clears the sufficient bar', () => {
    const result = scoreEvidence({
      query: 'how to write a debounce function in javascript',
      title: 'Debounce function in JavaScript - MDN Web Docs',
      url: 'https://developer.mozilla.org/en-US/docs/Glossary/Debounce',
      summary:
        'The debounce function is a technique that ensures a function is not called too frequently. It delays execution until after a specified time has elapsed since the last call. Useful for input handlers.',
      keyFacts: [
        'Debounce delays the execution of a function',
        'Commonly used for scroll, resize, and input events',
        'Implemented with setTimeout and clearTimeout',
      ],
      matchSnippets: [],
    });
    expect(result.sufficient).toBe(true);
  });

  it('falls back to summary + keyFacts when matchSnippets is empty', () => {
    const withSnippets = scoreEvidence({
      query: 'tail call optimization',
      title: 'Tail call optimization in compilers',
      url: 'https://example.com/tco',
      summary: '',
      keyFacts: [],
      matchSnippets: ['tail call optimization reuses the current stack frame'],
    });
    const withoutSnippets = scoreEvidence({
      query: 'tail call optimization',
      title: 'Tail call optimization in compilers',
      url: 'https://example.com/tco',
      summary: 'Tail call optimization (TCO) reuses the current stack frame for a tail call.',
      keyFacts: ['Eliminates stack growth for recursive tail calls'],
      matchSnippets: [],
    });
    expect(withoutSnippets.score).toBeGreaterThan(0);
    // Scores should be in the same ballpark — within 3 pts of each other.
    expect(Math.abs(withoutSnippets.score - withSnippets.score)).toBeLessThanOrEqual(3);
  });

  it('scores zero when the page is entirely unrelated', () => {
    const result = scoreEvidence({
      query: 'debounce function javascript',
      title: 'Unrelated corporate homepage',
      url: 'https://corp.example.com',
      summary: 'We make widgets for industrial applications.',
      keyFacts: ['Founded 1987', 'Headquartered in Ohio'],
      matchSnippets: [],
    });
    expect(result.score).toBe(0);
    expect(result.sufficient).toBe(false);
  });

  it('rewards structured keyFacts as a small bonus', () => {
    const withFacts = scoreEvidence({
      query: 'foo bar',
      title: 'foo bar page',
      url: 'https://example.com/foo-bar',
      summary: 'foo bar summary',
      keyFacts: ['foo bar is a thing', 'and here are details about foo bar'],
      matchSnippets: [],
    });
    const withoutFacts = scoreEvidence({
      query: 'foo bar',
      title: 'foo bar page',
      url: 'https://example.com/foo-bar',
      summary: 'foo bar summary',
      keyFacts: [],
      matchSnippets: [],
    });
    expect(withFacts.score).toBeGreaterThan(withoutFacts.score);
  });
});
