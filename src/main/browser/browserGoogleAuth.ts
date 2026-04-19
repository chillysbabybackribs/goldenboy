import { importChromeCookies } from './chromeCookieImporter';
import { isGoogleCookieDomain } from './browserService.utils';

export type BrowserGoogleAuthLogLevel = 'info' | 'warn' | 'error';

export type BrowserGoogleAuthTab = {
  id: string;
  view: {
    webContents: Electron.WebContents;
  };
};

export type BrowserGoogleAuthManagerDeps = {
  emitLog: (level: BrowserGoogleAuthLogLevel, message: string) => void;
  isSafeExternalUrl: (url: string) => boolean;
  isSafeNavigationUrl: (url: string) => boolean;
  getSession: () => Electron.Session | null;
  loadUrlInTab: (tab: BrowserGoogleAuthTab, url: string) => void;
  openExternal: (url: string) => void | Promise<void>;
};

const GOOGLE_AUTH_MISMATCH_PATH = '/CookieMismatch';
const GOOGLE_AUTH_START_URL = 'https://accounts.google.com/';
const OAUTH_RELAY_TIMEOUT_MS = 5 * 60 * 1000;
const OAUTH_RELAY_POLL_INTERVAL_MS = 3_000;
const GOOGLE_OAUTH_PATH_PATTERNS = [
  '/o/oauth2/',
  '/signin/oauth',
  '/AccountChooser',
  '/ServiceLogin',
  '/v3/signin/',
  '/signin/v2/',
];

function getGoogleSignInPlaceholderHtml(): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
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
</div></body></html>`;
}

function getGoogleSignInPlaceholderDataUrl(): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(getGoogleSignInPlaceholderHtml())}`;
}

export class BrowserGoogleAuthManager {
  private oauthRelayTimer: ReturnType<typeof setTimeout> | null = null;
  private lastGoogleCookieMismatchAt: number | null = null;

  constructor(private readonly deps: BrowserGoogleAuthManagerDeps) {}

  isGoogleOAuthUrl(rawUrl: string): boolean {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return false;
    }
    if (parsed.hostname !== 'accounts.google.com') return false;
    return GOOGLE_OAUTH_PATH_PATTERNS.some((path) => parsed.pathname.startsWith(path));
  }

  getLastGoogleCookieMismatchAt(): number | null {
    return this.lastGoogleCookieMismatchAt;
  }

  async handleGoogleAuthNavigation(tab: BrowserGoogleAuthTab, rawUrl: string): Promise<void> {
    if (!this.deps.getSession()) return;

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
    const cleared = await this.clearGoogleAuthCookies();
    this.deps.emitLog(
      'warn',
      `Detected Google CookieMismatch; cleared ${cleared} Google-family cookies and restarted auth flow`,
    );

    if (!tab.view.webContents.isDestroyed()) {
      tab.view.webContents.loadURL(GOOGLE_AUTH_START_URL);
    }
  }

  async clearGoogleAuthCookies(): Promise<number> {
    const ses = this.deps.getSession();
    if (!ses) return 0;

    const cookies = await ses.cookies.get({});
    let cleared = 0;

    for (const cookie of cookies) {
      if (!cookie.domain || !cookie.name || !isGoogleCookieDomain(cookie.domain)) {
        continue;
      }

      const url = `http${cookie.secure ? 's' : ''}://${cookie.domain.replace(/^\./, '')}${cookie.path}`;
      try {
        await ses.cookies.remove(url, cookie.name);
        cleared += 1;
      } catch {
        // Ignore individual removal failures and continue clearing the jar.
      }
    }

    return cleared;
  }

  async openGoogleSignInExternally(tab: BrowserGoogleAuthTab, oauthUrl: string): Promise<void> {
    const ses = this.deps.getSession();
    if (!ses) return;

    // Prevent duplicate relays
    this.stopOAuthRelay();

    // Extract the original destination the user was trying to reach
    let continueUrl: string | null = null;
    try {
      const parsed = new URL(oauthUrl);
      continueUrl = parsed.searchParams.get('continue')
        || parsed.searchParams.get('redirect_uri')
        || null;
    } catch {
      // Ignore malformed URLs.
    }

    // Show a placeholder while user authenticates in the browser
    if (!tab.view.webContents.isDestroyed()) {
      this.deps.loadUrlInTab(tab, getGoogleSignInPlaceholderDataUrl());
    }

    if (!this.deps.isSafeExternalUrl(oauthUrl)) {
      this.deps.emitLog('warn', `Blocked unsafe OAuth URL for external launch: ${oauthUrl}`);
      return;
    }

    // Open the original OAuth URL in the system browser
    void this.deps.openExternal(oauthUrl);

    let elapsed = 0;
    const poll = async () => {
      elapsed += OAUTH_RELAY_POLL_INTERVAL_MS;
      if (elapsed > OAUTH_RELAY_TIMEOUT_MS) {
        this.stopOAuthRelay();
        this.deps.emitLog('warn', 'Google sign-in polling timed out after 5 minutes');
        return;
      }

      try {
        const result = await importChromeCookies(ses, true);
        const hasGoogleCookies = result.domains.some((domain) => isGoogleCookieDomain(domain));
        if (hasGoogleCookies && result.imported > 0) {
          this.deps.emitLog(
            'info',
            `Google sign-in complete: imported ${result.imported} cookies (${result.domains.length} domains)`,
          );
          this.stopOAuthRelay();
          const destination = (continueUrl && this.deps.isSafeNavigationUrl(continueUrl))
            ? continueUrl
            : 'https://myaccount.google.com/';
          if (!tab.view.webContents.isDestroyed()) {
            this.deps.loadUrlInTab(tab, destination);
          }
          return;
        }
      } catch (err) {
        this.deps.emitLog('warn', `OAuth poll: ${err instanceof Error ? err.message : String(err)}`);
      }

      this.oauthRelayTimer = setTimeout(() => {
        void poll();
      }, OAUTH_RELAY_POLL_INTERVAL_MS);
    };

    // Start polling after initial delay to let the system browser load
    this.oauthRelayTimer = setTimeout(() => {
      void poll();
    }, OAUTH_RELAY_POLL_INTERVAL_MS);
  }

  stopOAuthRelay(): void {
    if (!this.oauthRelayTimer) return;
    clearTimeout(this.oauthRelayTimer);
    this.oauthRelayTimer = null;
  }
}
