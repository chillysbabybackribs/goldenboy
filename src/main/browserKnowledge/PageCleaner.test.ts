import { describe, expect, it } from 'vitest';
import { cleanPageText, estimateTokens } from './PageCleaner';

describe('cleanPageText', () => {
  it('strips simple in-text boilerplate phrases', () => {
    const input = 'Main body text here.\nPrivacy Policy\nMore body text.';
    const cleaned = cleanPageText(input);
    expect(cleaned).not.toMatch(/privacy policy/i);
    expect(cleaned).toContain('Main body text here.');
    expect(cleaned).toContain('More body text.');
  });

  it('drops whole lines that are pure nav/menu labels', () => {
    const input = [
      'Home',
      'About',
      'Menu',
      'Sign in',
      'Sign Up',
      'Log Out',
      'Real paragraph with substantive content that should survive cleaning.',
      'Skip to main content',
      'Back to top',
    ].join('\n');
    const cleaned = cleanPageText(input);
    expect(cleaned).not.toMatch(/^menu$/im);
    expect(cleaned).not.toMatch(/^sign in$/im);
    expect(cleaned).not.toMatch(/^sign up$/im);
    expect(cleaned).not.toMatch(/^log out$/im);
    expect(cleaned).not.toMatch(/^skip to main content$/im);
    expect(cleaned).not.toMatch(/^back to top$/im);
    expect(cleaned).toContain('Real paragraph');
  });

  it('drops social share / follow-us lines and platform-only lines', () => {
    const input = [
      'Content that should survive.',
      'Share on Twitter',
      'Follow us on Facebook',
      'Facebook Twitter LinkedIn Reddit',
      'More body text.',
    ].join('\n');
    const cleaned = cleanPageText(input);
    expect(cleaned).not.toMatch(/^share on twitter$/im);
    expect(cleaned).not.toMatch(/^follow us on facebook$/im);
    expect(cleaned).not.toMatch(/^facebook twitter linkedin reddit$/im);
    expect(cleaned).toContain('Content that should survive.');
    expect(cleaned).toContain('More body text.');
  });

  it('drops related-content cross-link labels and ad markers', () => {
    const input = [
      'Article body paragraph one.',
      'Related Articles',
      'You may also like',
      'Trending Now',
      'Sponsored',
      'Advertisement',
      'Article body paragraph two.',
    ].join('\n');
    const cleaned = cleanPageText(input);
    expect(cleaned).not.toMatch(/^related articles$/im);
    expect(cleaned).not.toMatch(/^you may also like$/im);
    expect(cleaned).not.toMatch(/^trending now$/im);
    expect(cleaned).not.toMatch(/^sponsored$/im);
    expect(cleaned).not.toMatch(/^advertisement$/im);
    expect(cleaned).toContain('Article body paragraph one.');
    expect(cleaned).toContain('Article body paragraph two.');
  });

  it('drops copyright and pagination noise', () => {
    const input = [
      'Main content line.',
      '© 2024 Example Corp',
      'Copyright 2023',
      'Previous',
      'Next',
      'Page 3 of 10',
      'Another main content line.',
    ].join('\n');
    const cleaned = cleanPageText(input);
    expect(cleaned).not.toMatch(/^©/m);
    expect(cleaned).not.toMatch(/^copyright/im);
    expect(cleaned).not.toMatch(/^previous$/im);
    expect(cleaned).not.toMatch(/^next$/im);
    expect(cleaned).not.toMatch(/^page \d+/im);
    expect(cleaned).toContain('Main content line.');
    expect(cleaned).toContain('Another main content line.');
  });

  it('drops cookie-banner fragments that are not covered by the in-text phrase list', () => {
    const input = [
      'Article body.',
      'We use cookies to improve your experience',
      'By clicking accept you agree to our use of cookies.',
      'Your Privacy Choices',
      'More body.',
    ].join('\n');
    const cleaned = cleanPageText(input);
    expect(cleaned).not.toMatch(/^we use cookies/im);
    expect(cleaned).not.toMatch(/^by clicking/im);
    expect(cleaned).not.toMatch(/^your privacy choices$/im);
    expect(cleaned).toContain('Article body.');
    expect(cleaned).toContain('More body.');
  });

  it('leaves unrelated body text untouched even if it mentions a boilerplate word', () => {
    const input = [
      'This paragraph discusses why you should sign in properly for security.',
      'This is a sentence mentioning sponsored content as a concept.',
    ].join('\n');
    const cleaned = cleanPageText(input);
    expect(cleaned).toContain('This paragraph discusses');
    expect(cleaned).toContain('This is a sentence mentioning');
  });

  it('strips a substantial fraction of noise on a nav/footer-heavy page', () => {
    const noisy = [
      'Home',
      'About',
      'Menu',
      'Sign in',
      'Search',
      'Main article: introduction to the topic that has multiple paragraphs of real body text.',
      'Share on Twitter',
      'Follow us on LinkedIn',
      'Related Articles',
      'Trending Now',
      'Advertisement',
      'Body paragraph two: more real content.',
      'Previous',
      'Next',
      '© 2024 Example Corp',
      'All rights reserved',
      'Privacy Policy',
      'Terms of Service',
    ].join('\n');
    const before = noisy.length;
    const after = cleanPageText(noisy).length;
    expect(after).toBeLessThan(before * 0.7);
  });
});

describe('estimateTokens', () => {
  it('rounds up to the nearest token at ~4 chars per token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});
