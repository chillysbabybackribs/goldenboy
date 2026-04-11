import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';

type SearchEngine = 'google' | 'duckduckgo' | 'bing';

const SEARCH_ENGINES: Record<SearchEngine, string> = {
  google: 'https://www.google.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  bing: 'https://www.bing.com/search?q=',
};

const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//;
const IPV4_WITH_PORT_RE = /^(\d{1,3})(?:\.(\d{1,3})){3}(?::\d{1,5})?$/;
const LOCALHOST_WITH_PORT_RE = /^localhost(?::\d{1,5})?$/i;
const BRACKETED_IPV6_WITH_PORT_RE = /^\[[0-9a-f:.]+\](?::\d{1,5})?$/i;
const DOMAIN_WITH_PORT_RE = /^(?:[a-z0-9-]+\.)+[a-z0-9-]{2,}(?::\d{1,5})?$/i;

export type NavigationTargetKind = 'direct-url' | 'search' | 'local-file';

export type NormalizedNavigationTarget = {
  url: string;
  kind: NavigationTargetKind;
};

export function normalizeNavigationTarget(
  rawInput: string,
  input: {
    searchEngine: SearchEngine;
    cwd?: string;
  },
): NormalizedNavigationTarget {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {
      url: SEARCH_ENGINES[input.searchEngine] || SEARCH_ENGINES.google,
      kind: 'search',
    };
  }

  if (URL_SCHEME_RE.test(trimmed)) {
    return { url: trimmed, kind: 'direct-url' };
  }

  const localFileUrl = normalizeLocalFileUrl(trimmed, input.cwd || process.cwd());
  if (localFileUrl) {
    return {
      url: localFileUrl,
      kind: 'local-file',
    };
  }

  if (!/\s/.test(trimmed) && looksLikeHostOrDomain(trimmed)) {
    const scheme = shouldUseHttp(trimmed) ? 'http://' : 'https://';
    return {
      url: `${scheme}${trimmed}`,
      kind: 'direct-url',
    };
  }

  const prefix = SEARCH_ENGINES[input.searchEngine] || SEARCH_ENGINES.google;
  return {
    url: `${prefix}${encodeURIComponent(trimmed)}`,
    kind: 'search',
  };
}

function normalizeLocalFileUrl(rawInput: string, cwd: string): string | null {
  const resolved = resolvePathLikeInput(rawInput, cwd);
  if (!resolved || !fs.existsSync(resolved)) return null;
  return pathToFileURL(resolved).href;
}

function resolvePathLikeInput(rawInput: string, cwd: string): string | null {
  if (rawInput.startsWith('~/')) {
    return path.join(os.homedir(), rawInput.slice(2));
  }
  if (path.isAbsolute(rawInput)) {
    return rawInput;
  }
  if (rawInput.startsWith('./') || rawInput.startsWith('../')) {
    return path.resolve(cwd, rawInput);
  }
  const relativePathLike = rawInput.includes('/') || rawInput.includes('\\') || path.extname(rawInput) !== '';
  if (relativePathLike) {
    return path.resolve(cwd, rawInput);
  }
  return null;
}

function looksLikeHostOrDomain(value: string): boolean {
  const host = hostToken(value);
  if (!host) return false;
  if (LOCALHOST_WITH_PORT_RE.test(host)) return true;
  if (BRACKETED_IPV6_WITH_PORT_RE.test(host)) return true;
  if (isIpv4WithOptionalPort(host)) return true;
  if (host.startsWith('www.')) return true;
  return DOMAIN_WITH_PORT_RE.test(host);
}

function shouldUseHttp(value: string): boolean {
  const host = hostToken(value).toLowerCase();
  if (LOCALHOST_WITH_PORT_RE.test(host)) return true;
  if (BRACKETED_IPV6_WITH_PORT_RE.test(host)) return true;
  return isIpv4WithOptionalPort(host);
}

function hostToken(value: string): string {
  return value.split(/[/?#]/, 1)[0] || '';
}

function isIpv4WithOptionalPort(value: string): boolean {
  if (!IPV4_WITH_PORT_RE.test(value)) return false;
  const [host] = value.split(':', 1);
  return host.split('.').every((part) => {
    const n = Number(part);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}
