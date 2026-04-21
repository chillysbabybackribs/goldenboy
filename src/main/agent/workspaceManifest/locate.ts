import type { ManifestFile, WorkspaceManifest } from './types';

export interface LocateOptions {
  /** Natural-language or keyword query. */
  query: string;
  /** Restrict to files whose relative path starts with this prefix (e.g. "src/main/agent"). */
  pathPrefix?: string;
  /** Restrict to files of given types. */
  fileTypes?: ReadonlyArray<ManifestFile['fileType']>;
  /** Max matches returned. Default 15. */
  limit?: number;
  /** Minimum score to include. Default 0.5. */
  minScore?: number;
}

export interface LocateMatch {
  path: string;
  score: number;
  purpose?: string;
  fileType: ManifestFile['fileType'];
  language?: string;
  /** Which query tokens contributed to the match, for explainability. */
  matchedTokens: string[];
}

/**
 * Token-weighted prompt → file scoring. Deliberately simple: no embeddings, no
 * ranking model. Per token, awards points for hits in filename / path /
 * purpose / language, then sums and orders. The manifest is small enough for
 * this to be ~microseconds per call.
 */
export function locate(manifest: WorkspaceManifest, options: LocateOptions): LocateMatch[] {
  const { query, pathPrefix, fileTypes, limit = 15, minScore = 0.5 } = options;
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const normPrefix = pathPrefix ? (pathPrefix.endsWith('/') ? pathPrefix : `${pathPrefix}/`) : undefined;
  const allowedTypes = fileTypes ? new Set(fileTypes) : undefined;

  const matches: LocateMatch[] = [];
  for (const file of manifest.files) {
    if (normPrefix && !file.path.startsWith(normPrefix) && file.path !== normPrefix.slice(0, -1)) continue;
    if (allowedTypes && !allowedTypes.has(file.fileType)) continue;

    const basename = (file.path.split('/').pop() ?? '').toLowerCase();
    const pathLower = file.path.toLowerCase();
    const purposeLower = (file.purpose ?? '').toLowerCase();
    const langLower = (file.language ?? '').toLowerCase();

    let score = 0;
    const matched: string[] = [];
    for (const raw of tokens) {
      const t = raw.toLowerCase();
      let hit = 0;
      if (basename === t) hit += 6;
      else if (basename.startsWith(`${t}.`) || basename.startsWith(`${t}-`) || basename.startsWith(`${t}_`)) hit += 4;
      else if (basename.includes(t)) hit += 3;
      if (pathLower.includes(`/${t}/`) || pathLower.startsWith(`${t}/`)) hit += 2.5;
      else if (pathLower.includes(t)) hit += 1.2;
      if (purposeLower.includes(t)) hit += 1.8;
      if (langLower === t) hit += 1.5;
      if (hit > 0) {
        score += hit;
        matched.push(raw);
      }
    }
    // Small bonus for matching multiple tokens.
    if (matched.length > 1) score *= 1 + 0.15 * (matched.length - 1);
    // Demote fixture/asset by default (they rarely answer prompts).
    if (file.fileType === 'fixture') score *= 0.5;
    if (file.fileType === 'asset') score *= 0.3;

    if (score >= minScore) {
      matches.push({
        path: file.path,
        score: Number(score.toFixed(3)),
        purpose: file.purpose,
        fileType: file.fileType,
        language: file.language,
        matchedTokens: matched,
      });
    }
  }

  matches.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return matches.slice(0, limit);
}

const STOPWORDS = new Set<string>([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'in',
  'for',
  'on',
  'with',
  'is',
  'are',
  'be',
  'it',
  'this',
  'that',
  'how',
  'why',
  'what',
  'where',
  'when',
  'which',
  'do',
  'does',
  'did',
  'can',
  'should',
  'would',
  'could',
  'about',
  'from',
  'by',
  'at',
  'as',
  'our',
  'we',
  'i',
  'me',
  'my',
  'you',
  'your',
]);

export function tokenize(query: string): string[] {
  // Preserve original case so camelCase boundaries can still be split, but
  // allow non-identifier punctuation to act as token separators first.
  const rawTokens = query
    .replace(/[^A-Za-z0-9_\s/.-]/g, ' ')
    .split(/[\s/]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const expanded: string[] = [];
  for (const rawToken of rawTokens) {
    const lowered = rawToken.toLowerCase();
    if (lowered.length < 2 || STOPWORDS.has(lowered)) {
      // Fall through to subtoken splitting even if the whole token is dropped;
      // a long camelCase identifier like "AuthService" has useful subtokens.
    } else {
      expanded.push(lowered);
    }
    const subs = splitIdentifier(rawToken);
    for (const s of subs) {
      if (s.length >= 2 && !STOPWORDS.has(s) && s !== lowered) expanded.push(s);
    }
  }
  return Array.from(new Set(expanded));
}

function splitIdentifier(t: string): string[] {
  return t
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[._\-\s]+/)
    .map((s) => s.toLowerCase())
    .filter(Boolean);
}
