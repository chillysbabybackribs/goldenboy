import { describe, it, expect } from 'vitest';
import { sanitizeResearchQuery } from './querySanitizer';

describe('sanitizeResearchQuery', () => {
  describe('operator stripping', () => {
    it('strips site: operator with a domain', () => {
      const result = sanitizeResearchQuery('site:reddit.com best espresso machines');
      expect(result.sanitized).toBe('best espresso machines');
      expect(result.strippedOperators).toEqual(['site:reddit.com']);
      expect(result.wasModified).toBe(true);
    });

    it('strips multiple operators in any position', () => {
      const result = sanitizeResearchQuery(
        'filetype:pdf intitle:"annual report" tesla Q4 site:investor.tesla.com',
      );
      expect(result.sanitized.toLowerCase()).toContain('tesla');
      expect(result.sanitized.toLowerCase()).toContain('q4');
      expect(result.sanitized).not.toMatch(/site:/i);
      expect(result.sanitized).not.toMatch(/filetype:/i);
      expect(result.sanitized).not.toMatch(/intitle:/i);
      expect(result.strippedOperators.length).toBe(3);
    });

    it('strips inurl, intext, ext, before, after, cache, related, link, define', () => {
      const operators = [
        'inurl:/docs',
        'intext:machine',
        'ext:csv',
        'before:2024-01-01',
        'after:2023-01-01',
        'cache:example.com',
        'related:example.com',
        'link:example.com',
        'define:serendipity',
      ];
      for (const op of operators) {
        const result = sanitizeResearchQuery(`${op} hello world`);
        expect(result.strippedOperators).toContain(op);
        expect(result.sanitized.toLowerCase()).toContain('hello world');
      }
    });

    it('strips allinurl, allintitle, allintext variants', () => {
      const r1 = sanitizeResearchQuery('allinurl:docs nodejs');
      expect(r1.sanitized.toLowerCase()).toContain('nodejs');
      expect(r1.sanitized.toLowerCase()).not.toContain('allinurl');

      const r2 = sanitizeResearchQuery('allintitle:docs nodejs');
      expect(r2.sanitized.toLowerCase()).not.toContain('allintitle');

      const r3 = sanitizeResearchQuery('allintext:docs nodejs');
      expect(r3.sanitized.toLowerCase()).not.toContain('allintext');
    });

    it('is case-insensitive for operator names', () => {
      const result = sanitizeResearchQuery('SITE:reddit.com FILETYPE:pdf hello');
      expect(result.sanitized.toLowerCase()).toBe('hello');
      expect(result.strippedOperators.map(op => op.toLowerCase())).toEqual(
        expect.arrayContaining(['site:reddit.com', 'filetype:pdf']),
      );
    });

    it('strips operators with whitespace around the colon', () => {
      const result = sanitizeResearchQuery('site : reddit.com best coffee');
      expect(result.sanitized.toLowerCase()).toBe('best coffee');
      expect(result.strippedOperators.length).toBe(1);
    });
  });

  describe('non-operator queries', () => {
    it('leaves a plain English query unchanged', () => {
      const result = sanitizeResearchQuery('how to write a debounce function');
      expect(result.sanitized).toBe('how to write a debounce function');
      expect(result.strippedOperators).toEqual([]);
      expect(result.wasModified).toBe(false);
    });

    it('does not strip words that merely contain operator substrings', () => {
      const result = sanitizeResearchQuery('parasiteology field notes');
      expect(result.sanitized).toBe('parasiteology field notes');
      expect(result.wasModified).toBe(false);
    });

    it('does not strip URL-like substrings that contain a colon', () => {
      const result = sanitizeResearchQuery('visit https://example.com for context');
      expect(result.sanitized).toContain('https://example.com');
      expect(result.wasModified).toBe(false);
    });
  });

  describe('hygiene', () => {
    it('collapses multiple spaces', () => {
      const result = sanitizeResearchQuery('hello     world\t\tfoo');
      expect(result.sanitized).toBe('hello world foo');
    });

    it('trims leading and trailing whitespace', () => {
      const result = sanitizeResearchQuery('  hello world  ');
      expect(result.sanitized).toBe('hello world');
    });

    it('strips trailing punctuation', () => {
      const result = sanitizeResearchQuery('what is tail call optimization???');
      expect(result.sanitized).toBe('what is tail call optimization');
    });

    it('keeps internal punctuation intact', () => {
      const result = sanitizeResearchQuery("elon musk's latest post");
      expect(result.sanitized).toBe("elon musk's latest post");
    });

    it('caps queries at 200 characters', () => {
      const long = 'a'.repeat(500);
      const result = sanitizeResearchQuery(long);
      expect(result.sanitized.length).toBe(200);
    });

    it('reports wasModified=true when only hygiene fired', () => {
      const result = sanitizeResearchQuery('   hello   world   ');
      expect(result.wasModified).toBe(true);
      expect(result.strippedOperators).toEqual([]);
    });
  });

  describe('preserveOperators flag', () => {
    it('leaves operators intact when preserveOperators=true', () => {
      const result = sanitizeResearchQuery(
        'site:reddit.com best espresso',
        { preserveOperators: true },
      );
      expect(result.sanitized).toBe('site:reddit.com best espresso');
      expect(result.strippedOperators).toEqual([]);
      expect(result.wasModified).toBe(false);
    });

    it('still applies whitespace/punctuation hygiene with preserveOperators=true', () => {
      const result = sanitizeResearchQuery(
        '  site:reddit.com   best espresso???  ',
        { preserveOperators: true },
      );
      expect(result.sanitized).toBe('site:reddit.com best espresso');
      expect(result.wasModified).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('returns empty string sanitized for all-operator input', () => {
      const result = sanitizeResearchQuery('site:reddit.com filetype:pdf');
      expect(result.sanitized).toBe('');
      expect(result.strippedOperators.length).toBe(2);
    });

    it('handles empty input', () => {
      const result = sanitizeResearchQuery('');
      expect(result.sanitized).toBe('');
      expect(result.strippedOperators).toEqual([]);
      expect(result.wasModified).toBe(false);
    });

    it('handles whitespace-only input', () => {
      const result = sanitizeResearchQuery('   \t  \n  ');
      expect(result.sanitized).toBe('');
      expect(result.wasModified).toBe(true);
    });

    it('preserves original in result.original regardless of mutation', () => {
      const query = 'site:x.com hello';
      const result = sanitizeResearchQuery(query);
      expect(result.original).toBe(query);
    });
  });
});
