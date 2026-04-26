/**
 * In-text phrases we always strip wherever they appear. Keep this list small
 * and phrase-specific; broader noise is handled by the line-level filters
 * below. Expanding this list risks chewing legitimate body text, so
 * {@link BOILERPLATE_LINE_PATTERNS} is the preferred extension point.
 */
const BOILERPLATE_PATTERNS = [
  /accept all cookies/gi,
  /manage cookies/gi,
  /reject all cookies/gi,
  /cookie settings/gi,
  /privacy policy/gi,
  /terms of service/gi,
  /terms of use/gi,
  /subscribe to our newsletter/gi,
  /all rights reserved/gi,
];

/**
 * Whole-line regexes. Any non-empty line that matches one of these patterns
 * (case-insensitive) is dropped entirely. Patterns are deliberately anchored
 * with `^…$` (after `.trim()`) so we only hit lines that ARE the noise — not
 * lines that merely contain it.
 */
const BOILERPLATE_LINE_PATTERNS: RegExp[] = [
  // Common action/menu lines.
  /^(sign|log)\s*(in|out|up)$/i,
  /^(register|create account|my account|account settings?)$/i,
  /^(menu|navigation|main navigation|primary menu)$/i,
  /^(search)$/i,
  /^(skip to (main )?content|skip navigation|skip to search)$/i,
  /^(back to top|scroll to top|to the top)$/i,
  /^(load more|show more|read more|view more|see all|view all)$/i,
  // Social share.
  /^share (on|via|this|to)\b.*/i,
  /^(follow us|follow me) (on|via)\b.*/i,
  /^tweet this|share this article|share this post|share this story$/i,
  // Content-farm cross-links.
  /^(related|related articles|related posts|related stories|related reading)$/i,
  /^(you may also (like|enjoy)|you might (also )?like|recommended (for you)?)$/i,
  /^(trending now|most popular|most read|read next|up next|more stories|editor'?s picks?)$/i,
  // Ads / sponsored.
  /^(sponsored|advertisement|advertisements?|ad)$/i,
  /^(sponsored content|promoted (story|stories|content))$/i,
  // Comments / engagement.
  /^(\d+\s+)?comments?$/i,
  /^leave (a )?(comment|reply)$/i,
  /^(post (a )?comment|add (a )?comment)$/i,
  // Copyright.
  /^©\s*\d{4}.*/i,
  /^copyright\s*(©\s*)?\d{4}.*/i,
  // Newsletter CTAs.
  /^(subscribe|subscribe now|join (our )?newsletter|get (the )?newsletter)$/i,
  /^(enter your email|sign up for (our|the) newsletter)$/i,
  // Cookie banner fragments.
  /^we use cookies.*/i,
  /^(by )?(clicking|using this site).*cookies.*/i,
  /^your (privacy|cookie) (choices|preferences)$/i,
  // Pagination markers.
  /^(previous|next|prev)\s*(page)?$/i,
  /^page\s+\d+\s*(of\s+\d+)?$/i,
  // Breadcrumbs: "Home > X > Y" or "Home / X / Y" (with few tokens).
  /^home\s*[>/›»]\s*[^\n]{0,80}$/i,
  // "Table of contents" labels (actual TOC content has links/text on following lines).
  /^(table of contents|on this page|in this article)$/i,
  // Lone "©" / "™" / "•" style ornament lines.
  /^[•·©™®|\-_=]{1,}$/,
];

/**
 * Social button sequences that often land on a single line, e.g.
 * "Facebook Twitter LinkedIn Reddit Email". If a line consists ONLY of
 * whitespace-separated platform names, drop it.
 */
const SOCIAL_PLATFORM_RE =
  /^(?:facebook|twitter|x|linkedin|reddit|pinterest|mastodon|threads|tumblr|whatsapp|telegram|email|messenger|instagram|youtube|tiktok|copy link)(?:\s+(?:facebook|twitter|x|linkedin|reddit|pinterest|mastodon|threads|tumblr|whatsapp|telegram|email|messenger|instagram|youtube|tiktok|copy link))+$/i;

function isBoilerplateLine(line: string): boolean {
  if (SOCIAL_PLATFORM_RE.test(line)) return true;
  for (const pattern of BOILERPLATE_LINE_PATTERNS) {
    if (pattern.test(line)) return true;
  }
  return false;
}

export function cleanPageText(input: string): string {
  let text = input.replace(/\r/g, '\n');
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');

  for (const pattern of BOILERPLATE_PATTERNS) {
    text = text.replace(pattern, '');
  }

  const seen = new Set<string>();
  const lines: string[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      if (lines[lines.length - 1] !== '') lines.push('');
      continue;
    }
    if (isBoilerplateLine(line)) continue;
    const key = line.toLowerCase();
    if (line.length > 20 && seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
