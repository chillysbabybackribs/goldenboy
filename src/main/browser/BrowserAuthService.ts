import { shell, type Session, type WebContents } from 'electron';
import { importChromeCookies } from './chromeCookieImporter';
import type { BrowserAuthDiagnostics } from '../../shared/types/browser';

const GOOGLE_AUTH_MISMATCH_PATH = '/CookieMismatch';
const GOOGLE_AUTH_START_URL = 'https://accounts.google.com/';
const GOOGLE_COOKIE_DOMAIN_SUFFIXES = [
  'google.com',
  'youtube.com',
  'googleusercontent.com',
];
const GOOGLE_OAUTH_PATH_PATTERNS = [
  '/o/oauth2/',
  '/signin/oauth',
  '/AccountChooser',
  '/ServiceLogin',
  '/v3/signin/',
  '/signin/v2/',
];
const OAUTH_RELAY_TIMEOUT_MS = 5 * 60 * 1000;
const ALLOWED_POPUP_PROTOCOLS = new Set(['http:', 'https:']);
const ALLOWED_NAVIGATION_PROTOCOLS = new Set(['http:', 'https:', 'file:']);

type BrowserAuthLogLevel = 'info' | 'warn' | 'error';

type BrowserAuthServiceDeps = {
  emitLog: (level: BrowserAuthLogLevel, message: string) => void;
};

function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return ALLOWED_POPUP_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

function isSafeNavigationUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed === 'about:blank') return false;
  try {
    const parsed = new URL(trimmed);
    return ALLOWED_NAVIGATION_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

function isGoogleCookieDomain(domain: string): boolean {
  const normalized = domain.replace(/^\./, '').toLowerCase();
  return GOOGLE_COOKIE_DOMAIN_SUFFIXES.some(suffix => normalized === suffix || normalized.endsWith(`.${suffix}`));
}

export class BrowserAuthService {
  private oauthRelayTimer: ReturnType<typeof setTimeout> | null = null;
  private lastGoogleCookieMismatchAt: number | null = null;

  constructor(private readonly deps: BrowserAuthServiceDeps) {}

  getLastGoogleCookieMismatchAt(): number | null {
    return this.lastGoogleCookieMismatchAt;
  }

  isGoogleOAuthUrl(rawUrl: string): boolean {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return false;
    }
    if (parsed.hostname !== 'accounts.google.com') return false;
    return GOOGLE_OAUTH_PATH_PATTERNS.some(p => parsed.pathname.startsWith(p));
  }

  async handleGoogleAuthNavigation(
    sessionInstance: Session,
    tabWebContents: WebContents,
    rawUrl: string,
  ): Promise<void> {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return;
    }

    if (parsed.hostname !== 'accounts.google.com' || parsed.pathname !== GOOGLE_AUTH_MISMATCH_PATH) {
      return;
    }

    this.lastGoogleCookieMismatchAt = Date.now();
    const cleared = await this.clearGoogleAuthCookies(sessionInstance);
    this.deps.emitLog(
      'warn',
      `Detected Google CookieMismatch; cleared ${cleared} Google-family cookies and restarted auth flow`,
    );

    if (!tabWebContents.isDestroyed()) {
      tabWebContents.loadURL(GOOGLE_AUTH_START_URL);
    }
  }

  async clearGoogleAuthCookies(sessionInstance: Session): Promise<number> {
    const cookies = await sessionInstance.cookies.get({});
    let cleared = 0;

    for (const cookie of cookies) {
      if (!cookie.domain || !cookie.name || !isGoogleCookieDomain(cookie.domain)) {
        continue;
      }

      const url = `http${cookie.secure ? 's' : ''}://${cookie.domain.replace(/^\./, '')}${cookie.path}`;
      try {
        await sessionInstance.cookies.remove(url, cookie.name);
        cleared++;
      } catch {
        // Ignore individual removal failures and continue clearing the jar.
      }
    }

    return cleared;
  }

  async openGoogleSignInExternally(
    sessionInstance: Session,
    tabWebContents: WebContents,
    oauthUrl: string,
  ): Promise<void> {
    this.stopOAuthRelay();

    let continueUrl: string | null = null;
    try {
      const parsed = new URL(oauthUrl);
      continueUrl = parsed.searchParams.get('continue')
        || parsed.searchParams.get('redirect_uri')
        || null;
    } catch {
      // Ignore URL parse errors; continueUrl stays null.
    }

    if (!tabWebContents.isDestroyed()) {
      tabWebContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(
        `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;
justify-content:center;height:100vh;margin:0;background:#0a0a0a;color:#ccc}
.card{text-align:center;padding:40px}
h2{margin-bottom:8px;color:#fff}
p{color:#888;max-width:340px;line-height:1.6}
.spinner{width:24px;height:24px;border:2px solid #333;border-top-color:#aaa;
border-radius:50%;animation:spin 0.8s linear infinite;margin:16px auto 0}
@keyframes spin{to{transform:rotate(360deg)}}
</style></head><body><div class="card">
<h2>Sign in with Google</h2>
<p>Your system browser has been opened. Complete sign-in there, then return here — this page will update automatically.</p>
<div class="spinner"></div>
</div></body></html>`,
      )}`);
    }

    if (!isSafeExternalUrl(oauthUrl)) {
      this.deps.emitLog('warn', `Blocked unsafe OAuth URL for external launch: ${oauthUrl}`);
      return;
    }

    void shell.openExternal(oauthUrl);

    const POLL_INTERVAL = 3000;
    let elapsed = 0;

    const poll = async () => {
      elapsed += POLL_INTERVAL;
      if (elapsed > OAUTH_RELAY_TIMEOUT_MS) {
        this.stopOAuthRelay();
        this.deps.emitLog('warn', 'Google sign-in polling timed out after 5 minutes');
        return;
      }

      try {
        const result = await importChromeCookies(sessionInstance, true);
        const hasGoogleCookies = result.domains.some(d => {
          const norm = d.replace(/^\./, '').toLowerCase();
          return GOOGLE_COOKIE_DOMAIN_SUFFIXES.some(s => norm === s || norm.endsWith(`.${s}`));
        });

        if (hasGoogleCookies && result.imported > 0) {
          this.deps.emitLog('info', `Google sign-in complete: imported ${result.imported} cookies (${result.domains.length} domains)`);
          this.stopOAuthRelay();

          const destination = (continueUrl && isSafeNavigationUrl(continueUrl))
            ? continueUrl
            : 'https://myaccount.google.com/';
          if (!tabWebContents.isDestroyed()) {
            tabWebContents.loadURL(destination);
          }
          return;
        }
      } catch (err) {
        this.deps.emitLog('warn', `OAuth poll: ${err instanceof Error ? err.message : String(err)}`);
      }

      this.oauthRelayTimer = setTimeout(() => void poll(), POLL_INTERVAL);
    };

    this.oauthRelayTimer = setTimeout(() => void poll(), POLL_INTERVAL);
  }

  stopOAuthRelay(): void {
    if (this.oauthRelayTimer) {
      clearTimeout(this.oauthRelayTimer);
      this.oauthRelayTimer = null;
    }
  }

  async getAuthDiagnostics(
    sessionInstance: Session | null,
    activeTabUserAgent: string,
    importChromeCookies: boolean | null,
  ): Promise<BrowserAuthDiagnostics> {
    const cookies = sessionInstance ? await sessionInstance.cookies.get({}) : [];
    return {
      totalCookies: cookies.length,
      googleCookieCount: cookies.filter(cookie => cookie.domain && isGoogleCookieDomain(cookie.domain)).length,
      importChromeCookies,
      googleAuthCompatibilityActive: true,
      lastGoogleCookieMismatchAt: this.lastGoogleCookieMismatchAt,
      activeTabUserAgent,
      activeTabHasElectronUA: /Electron\/[\d.]+/i.test(activeTabUserAgent),
    };
  }
}

