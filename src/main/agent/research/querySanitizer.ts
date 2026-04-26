export type SanitizeResult = {
  sanitized: string;
  original: string;
  strippedOperators: string[];
  wasModified: boolean;
};

export type SanitizeOptions = {
  preserveOperators?: boolean;
};

const MAX_QUERY_LENGTH = 200;

const OPERATOR_NAMES = [
  'site',
  'inurl',
  'intitle',
  'intext',
  'filetype',
  'ext',
  'before',
  'after',
  'cache',
  'related',
  'link',
  'define',
  'allinurl',
  'allintitle',
  'allintext',
];

// Matches `operator : value` where `value` is a non-whitespace token.
// Whitespace around the colon is allowed so `site : reddit.com` still
// matches. The value captures until the next run of whitespace so
// embedded punctuation (e.g. `site:investor.tesla.com`) travels with
// the operator. Quoted values (e.g. `intitle:"annual report"`) are
// handled by a second pattern below.
//
// IMPORTANT: the operator name must be preceded by a word boundary so
// common words containing an operator substring (e.g. `parasiteology`,
// which contains `site`) are not stripped. `\b` is not sufficient
// because `parasiteology` contains the boundary `e|site`, so we also
// require either start-of-string or a whitespace character before.
const operatorAlternation = OPERATOR_NAMES.join('|');
const UNQUOTED_OPERATOR_RE = new RegExp(
  `(?:^|\\s)((?:${operatorAlternation}))\\s*:\\s*(\\S+)`,
  'gi',
);
const QUOTED_OPERATOR_RE = new RegExp(
  `(?:^|\\s)((?:${operatorAlternation}))\\s*:\\s*("[^"]*")`,
  'gi',
);

const TRAILING_PUNCT_RE = /[\s?!.,;:]+$/;

export function sanitizeResearchQuery(
  query: string,
  opts: SanitizeOptions = {},
): SanitizeResult {
  const original = query;
  const preserveOperators = opts.preserveOperators === true;

  let working = query;
  const strippedOperators: string[] = [];

  if (!preserveOperators) {
    // Quoted first so unquoted regex does not half-match the opening
    // quote as the value.
    working = working.replace(QUOTED_OPERATOR_RE, (match, name, value) => {
      strippedOperators.push(`${String(name).toLowerCase()}:${value}`);
      // Replace with a single space so the word boundary before the
      // next token survives.
      return match.startsWith(' ') ? ' ' : '';
    });
    working = working.replace(UNQUOTED_OPERATOR_RE, (match, name, value) => {
      strippedOperators.push(`${String(name).toLowerCase()}:${value}`);
      return match.startsWith(' ') ? ' ' : '';
    });
  }

  // Whitespace hygiene.
  working = working.replace(/\s+/g, ' ').trim();
  // Trailing punctuation (question marks, periods, etc). Keep
  // internal punctuation and apostrophes intact.
  working = working.replace(TRAILING_PUNCT_RE, '');

  if (working.length > MAX_QUERY_LENGTH) {
    working = working.slice(0, MAX_QUERY_LENGTH);
  }

  const wasModified = working !== original;

  return {
    sanitized: working,
    original,
    strippedOperators,
    wasModified,
  };
}
