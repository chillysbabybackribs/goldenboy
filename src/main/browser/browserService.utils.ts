import path from 'path';
import type { WebContentsView } from 'electron';

type BrowserTabEntryLike = {
  view: WebContentsView;
};

export type ViewBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const ALLOWED_POPUP_PROTOCOLS = new Set(['http:', 'https:']);
const ALLOWED_NAVIGATION_PROTOCOLS = new Set(['http:', 'https:', 'file:']);
const GOOGLE_COOKIE_DOMAIN_SUFFIXES = [
  'google.com',
  'youtube.com',
  'googleusercontent.com',
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

export function getBrowserTabPreloadPath(): string {
  return path.join(__dirname, '..', '..', '..', 'preload', 'preload', 'browserTabPreload.js');
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

export function isGoogleCookieDomain(domain: string): boolean {
  const normalized = domain.replace(/^\./, '').toLowerCase();
  return GOOGLE_COOKIE_DOMAIN_SUFFIXES.some(suffix => normalized === suffix || normalized.endsWith(`.${suffix}`));
}

export function areViewBoundsEqual(a: ViewBounds, b: ViewBounds): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function isTabEntryViewAlive(entry: BrowserTabEntryLike | undefined): boolean {
  if (!entry) return false;
  try {
    return !entry.view.webContents.isDestroyed();
  } catch {
    return false;
  }
}

export type BrowserSourceDocumentInput = {
  url: string;
  source: string;
  title: string;
  meta: string;
  contentType: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildSourceDocument(input: BrowserSourceDocumentInput): string {
  const escapedTitle = escapeHtml(input.title);
  const escapedUrl = escapeHtml(input.url);
  const escapedMeta = escapeHtml(input.meta);
  const escapedContentType = escapeHtml(input.contentType);
  const escapedSource = escapeHtml(input.source);

  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'" />
    <title>${escapedTitle}</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      body {
        margin: 0;
        background: #111827;
        color: #e5e7eb;
      }
      header {
        padding: 12px 16px;
        border-bottom: 1px solid #374151;
        background: #0f172a;
      }
      h1 {
        margin: 0 0 6px;
        font-size: 14px;
        font-weight: 600;
      }
      p {
        margin: 2px 0;
        font-size: 12px;
        color: #9ca3af;
        word-break: break-all;
      }
      pre {
        margin: 0;
        padding: 16px;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 12px;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <header>
      <h1>${escapedTitle}</h1>
      <p>${escapedUrl}</p>
      <p>${escapedMeta}</p>
      <p>Content-Type: ${escapedContentType}</p>
    </header>
    <pre>${escapedSource}</pre>
  </body>
</html>`)}`;
}
