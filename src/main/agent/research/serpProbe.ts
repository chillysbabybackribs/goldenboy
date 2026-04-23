import type { SerpCandidate, SerpSource } from './types';
import { parseGoogleSerp } from './serpParsers/googleParser';
import { parseDuckduckgoSerp } from './serpParsers/duckduckgoParser';
import { parseBingSerp } from './serpParsers/bingParser';

export type EngineStats = {
  hit: boolean;
  count: number;
  consentWall: boolean;
  error: string | null;
};

export type MergedCandidate = {
  url: string;
  title: string;
  snippet: string;
  bestRank: number;
  sources: SerpSource[];
};

export type ProbeResult = {
  candidates: MergedCandidate[];
  engines: Record<SerpSource, EngineStats>;
};

export type ProbeOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  userAgent?: string;
};

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Tracking-only query params we drop during canonicalization. Keep
// this conservative: we explicitly enumerate known-noisy prefixes
// rather than dropping anything that "looks like" tracking, because
// many sites use short keys (`id`, `q`, `page`) meaningfully.
const TRACKING_PARAM_PREFIXES = ['utm_', 'mc_', 'hsa_', 'ga_'];
const TRACKING_PARAM_EXACT = new Set([
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'yclid',
  'msclkid',
  'zanpid',
  'ref',
  'ref_',
  'ref_src',
  'referrer',
  'igshid',
  'trk',
  's_cid',
  'vero_id',
  'vero_conv',
  'campaignid',
  'adgroupid',
]);

function isTrackingParam(name: string): boolean {
  if (TRACKING_PARAM_EXACT.has(name)) return true;
  for (const prefix of TRACKING_PARAM_PREFIXES) if (name.startsWith(prefix)) return true;
  return false;
}

export function canonicalizeUrl(input: string): string {
  try {
    const url = new URL(input);
    if (!/^https?:$/i.test(url.protocol)) return input;

    url.host = url.host.toLowerCase();
    url.hash = '';

    const keep: [string, string][] = [];
    url.searchParams.forEach((value, key) => {
      if (!isTrackingParam(key)) keep.push([key, value]);
    });
    keep.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const newSearch = new URLSearchParams();
    for (const [k, v] of keep) newSearch.append(k, v);
    url.search = newSearch.toString();

    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }

    let serialized = url.toString();
    // WHATWG appends `/` to bare hosts regardless of input; the only
    // case that matters for downstream dedupe is consistency, not
    // matching the input shape.
    return serialized;
  } catch {
    return input;
  }
}

type EngineDef = {
  source: SerpSource;
  url: (q: string) => string;
  parse: (html: string) => { candidates: SerpCandidate[]; consentWall: boolean };
};

const ENGINES: EngineDef[] = [
  {
    source: 'google',
    // `udm=14` asks for the Web vertical only (no AI overview, no
    // rich panels) which keeps the HTML smaller and the parser
    // happier. `hl=en&gl=US` stabilizes language/region.
    url: q =>
      `https://www.google.com/search?q=${encodeURIComponent(q)}&udm=14&hl=en&gl=US&pws=0`,
    parse: parseGoogleSerp,
  },
  {
    source: 'duckduckgo',
    url: q => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    parse: parseDuckduckgoSerp,
  },
  {
    source: 'bing',
    url: q => `https://www.bing.com/search?q=${encodeURIComponent(q)}&form=QBLH`,
    parse: parseBingSerp,
  },
];

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
  userAgent: string,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        'user-agent': userAgent,
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// Race a promise against a fallback that resolves to `sentinel`
// after `ms`. Used as a belt-and-suspenders around AbortController
// for fetch impls that ignore the signal.
function raceTimeout<T>(p: Promise<T>, ms: number, sentinel: T): Promise<T> {
  return new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(sentinel);
    }, ms);
    p.then(value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }).catch(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(sentinel);
    });
  });
}

type EngineOutcome = {
  source: SerpSource;
  stats: EngineStats;
  candidates: SerpCandidate[];
};

async function probeEngine(
  engine: EngineDef,
  query: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  userAgent: string,
): Promise<EngineOutcome> {
  const timeoutSentinel: EngineOutcome = {
    source: engine.source,
    stats: { hit: false, count: 0, consentWall: false, error: 'timeout' },
    candidates: [],
  };

  const inner = (async (): Promise<EngineOutcome> => {
    try {
      const html = await fetchWithTimeout(
        fetchImpl,
        engine.url(query),
        timeoutMs,
        userAgent,
      );
      const parsed = engine.parse(html);
      return {
        source: engine.source,
        stats: {
          hit: !parsed.consentWall && parsed.candidates.length > 0,
          count: parsed.candidates.length,
          consentWall: parsed.consentWall,
          error: null,
        },
        candidates: parsed.candidates,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        source: engine.source,
        stats: {
          hit: false,
          count: 0,
          consentWall: false,
          error: /abort/i.test(message) ? 'timeout' : message,
        },
        candidates: [],
      };
    }
  })();

  // +500ms slack gives the inner promise a chance to resolve
  // gracefully after its own abort fires before we hard-timeout
  // from the outside.
  return raceTimeout(inner, timeoutMs + 500, timeoutSentinel);
}

function mergeCandidates(all: SerpCandidate[]): MergedCandidate[] {
  const map = new Map<string, MergedCandidate>();
  for (const c of all) {
    const key = canonicalizeUrl(c.url);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        url: key,
        title: c.title,
        snippet: c.snippet,
        bestRank: c.serpRank,
        sources: [c.serpSource],
      });
      continue;
    }
    if (!existing.sources.includes(c.serpSource)) existing.sources.push(c.serpSource);
    if (c.serpRank < existing.bestRank) existing.bestRank = c.serpRank;
    if (c.title && (!existing.title || c.title.length < existing.title.length)) {
      existing.title = c.title;
    }
    if (c.snippet && c.snippet.length > existing.snippet.length) {
      existing.snippet = c.snippet;
    }
  }
  return Array.from(map.values());
}

export async function probeSerps(
  query: string,
  opts: ProbeOptions = {},
): Promise<ProbeResult> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as typeof fetch);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;

  const outcomes = await Promise.all(
    ENGINES.map(e => probeEngine(e, query, fetchImpl, timeoutMs, userAgent)),
  );

  const engines = {
    google: { hit: false, count: 0, consentWall: false, error: null },
    duckduckgo: { hit: false, count: 0, consentWall: false, error: null },
    bing: { hit: false, count: 0, consentWall: false, error: null },
  } as Record<SerpSource, EngineStats>;
  const allCandidates: SerpCandidate[] = [];

  for (const outcome of outcomes) {
    engines[outcome.source] = outcome.stats;
    for (const c of outcome.candidates) allCandidates.push(c);
  }

  return { candidates: mergeCandidates(allCandidates), engines };
}
