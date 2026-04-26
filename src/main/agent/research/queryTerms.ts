const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'what',
  'when',
  'where',
  'how',
  'does',
  'are',
  'was',
  'latest',
  'current',
  'search',
  'look',
  'lookup',
  'find',
  'online',
]);

// Lowercased, stop-word-trimmed terms suitable for title/snippet
// matching. Keeps alphanumerics plus a handful of common special
// characters ($ % . -) that matter in queries like "$4/m" or
// ".env".
export function queryTerms(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9.$%-]+/)
        .filter(term => term.length >= 2 && !STOP_WORDS.has(term)),
    ),
  );
}
