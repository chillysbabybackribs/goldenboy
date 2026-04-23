import type { BrowserConsoleEvent } from '../../shared/types/browserIntelligence';

const ALLOWED_POPUP_PROTOCOLS = new Set(['http:', 'https:']);
const ALLOWED_NAVIGATION_PROTOCOLS = new Set(['http:', 'https:', 'file:']);
const NOISY_THIRD_PARTY_HOST_SUFFIXES = [
  'googlesyndication.com',
  'doubleclick.net',
  'googletagservices.com',
  'sharethrough.com',
  'loopme.me',
  '3lift.com',
  'mgid.com',
  'smaato.net',
  'adform.net',
  'media.net',
  'omnitagjs.com',
  'vistarsagency.com',
  'prebid.org',
];
const TRACKING_PATH_PATTERNS: RegExp[] = [
  /\/setuid\b/i,
  /\/sync\b/i,
  /\/user-sync\b/i,
  /\/cookie[_-]?sync\b/i,
  /\/checksync\b/i,
];
const NOISY_BLOCKABLE_RESOURCE_TYPES = new Set([
  'script',
  'image',
  'subFrame',
  'xhr',
  'fetch',
  'ping',
  'media',
  'object',
]);
const NOISY_CONSOLE_MESSAGE_PATTERNS: RegExp[] = [
  /allow-scripts and allow-same-origin/i,
  /failed to execute 'write' on 'document'/i,
  /slot\.setsafeframeconfig is deprecated/i,
  /\badgb - not initialized\b/i,
  /\byenabler is not defined\b/i,
  /preloaded using link preload but not used/i,
  /yDestinationContentUUIDList.+exceeded the max length/i,
  /videojs\.mergeoptions is deprecated/i,
];

export function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return ALLOWED_POPUP_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

export function isSafeNavigationUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed === 'about:blank') return false;
  try {
    const parsed = new URL(trimmed);
    return ALLOWED_NAVIGATION_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

export function isSafeUrlForTabOpen(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  if (trimmed === 'about:blank') return true;
  return isSafeNavigationUrl(trimmed);
}

export function sanitizeBrowserUserAgent(userAgent: string): string {
  return userAgent
    .replace(/\s*Electron\/[\d.]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function isGoogleOrYouTubeRequest(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();
    return hostname === 'google.com'
      || hostname.endsWith('.google.com')
      || hostname === 'youtube.com'
      || hostname.endsWith('.youtube.com');
  } catch {
    return false;
  }
}

export function shouldBlockNoisyThirdPartyRequest(rawUrl: string, resourceType: string): boolean {
  if (!NOISY_BLOCKABLE_RESOURCE_TYPES.has(resourceType)) return false;
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();
    if (NOISY_THIRD_PARTY_HOST_SUFFIXES.some(suffix => hostname === suffix || hostname.endsWith(`.${suffix}`))) {
      return true;
    }
    return TRACKING_PATH_PATTERNS.some(pattern => pattern.test(parsed.pathname));
  } catch {
    return false;
  }
}

function isNoisyThirdPartyHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return NOISY_THIRD_PARTY_HOST_SUFFIXES.some(suffix => normalized === suffix || normalized.endsWith(`.${suffix}`));
}

function extractHostname(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function shouldSuppressConsoleNoise(event: BrowserConsoleEvent): boolean {
  const message = String(event.message || '').trim();
  if (!message) return false;
  const patternMatch = NOISY_CONSOLE_MESSAGE_PATTERNS.some(pattern => pattern.test(message));
  if (!patternMatch) return false;
  const sourceId = String(event.sourceId || '');
  if (sourceId === 'console-api' || sourceId === 'inline') return true;
  const host = extractHostname(sourceId);
  return host ? isNoisyThirdPartyHost(host) : false;
}
