// ═══════════════════════════════════════════════════════════════════════════
// Chrome Cookie Importer — Import logged-in sessions from Chrome browser
// ═══════════════════════════════════════════════════════════════════════════
//
// Reads Chrome's cookie database, decrypts auth-related cookies, and imports
// them into the Electron session so users stay logged in without re-auth.

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { app, dialog, BrowserWindow } from 'electron';
import { deriveKey, decryptValue, chromeTimestampToUnix, isTrackerDomain, parseRows } from './chromeCookieCrypto';

// ─── Chrome profile detection ─────────────────────────────────────────────

const CHROME_PATHS = [
  path.join(app.getPath('home'), '.config', 'google-chrome', 'Default', 'Cookies'),
  path.join(app.getPath('home'), '.config', 'chromium', 'Default', 'Cookies'),
];

const IMPORT_BLOCKED_DOMAIN_SUFFIXES = [
  'google.com',
  'youtube.com',
  'googlevideo.com',
  'googleusercontent.com',
];

function findChromeDB(): { dbPath: string; browser: 'chrome' | 'chromium' } | null {
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) {
      const browser = p.includes('google-chrome') ? 'chrome' : 'chromium';
      return { dbPath: p, browser };
    }
  }
  return null;
}

function normalizeHost(host: string): string {
  return host.replace(/^\./, '').toLowerCase();
}

export function shouldImportChromeCookieDomain(host: string): boolean {
  const normalized = normalizeHost(host);
  return !IMPORT_BLOCKED_DOMAIN_SUFFIXES.some(suffix => normalized === suffix || normalized.endsWith(`.${suffix}`));
}

// ─── Keyring password retrieval ───────────────────────────────────────────

function getKeyringPassword(browser: 'chrome' | 'chromium'): string | null {
  const label = browser === 'chrome' ? 'Chrome Safe Storage' : 'Chromium Safe Storage';
  try {
    const output = execSync(
      `secret-tool search application ${browser} 2>/dev/null || secret-tool lookup label "${label}" 2>/dev/null`,
      { timeout: 5000, encoding: 'utf-8' },
    );
    // secret-tool search outputs "secret = <value>"
    const match = output.match(/secret\s*=\s*(.+)/);
    if (match) return match[1].trim();
    // secret-tool lookup outputs just the raw secret
    if (output.trim() && !output.includes('=')) return output.trim();
    return null;
  } catch {
    return null;
  }
}

// ─── SQL via sqlite3 CLI ──────────────────────────────────────────────────

function queryDB(dbPath: string, sql: string): string {
  // Copy DB to avoid WAL lock conflicts with running Chrome
  const tmpPath = path.join(app.getPath('temp'), 'chrome-cookies-import.db');
  fs.copyFileSync(dbPath, tmpPath);
  // Also copy WAL and SHM if they exist (ensures recent cookies are included)
  for (const ext of ['-wal', '-shm']) {
    const src = dbPath + ext;
    if (fs.existsSync(src)) fs.copyFileSync(src, tmpPath + ext);
  }
  try {
    return execSync(`sqlite3 "${tmpPath}" "${sql}"`, { timeout: 10000, encoding: 'utf-8' });
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
    try { fs.unlinkSync(tmpPath + '-wal'); } catch {}
    try { fs.unlinkSync(tmpPath + '-shm'); } catch {}
  }
}

function getDBVersion(dbPath: string): number {
  const tmpPath = path.join(app.getPath('temp'), 'chrome-cookies-import.db');
  fs.copyFileSync(dbPath, tmpPath);
  try {
    const out = execSync(`sqlite3 "${tmpPath}" "SELECT value FROM meta WHERE key='version'"`, {
      timeout: 5000, encoding: 'utf-8',
    });
    return parseInt(out.trim(), 10) || 0;
  } catch {
    return 0;
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

// ─── Main import function ─────────────────────────────────────────────────

export type CookieImportResult = {
  imported: number;
  failed: number;
  domains: string[];
};

/**
 * Detect which domains have active login sessions in Chrome.
 * Heuristic: domains with httponly + secure + non-session cookies.
 */
function findAuthDomains(dbPath: string): string[] {
  const sql = `SELECT DISTINCT host_key FROM cookies WHERE is_httponly = 1 AND is_secure = 1 AND expires_utc > 0`;
  const output = queryDB(dbPath, sql);
  return output.split('\n')
    .map(s => s.trim())
    .filter(s => s && !isTrackerDomain(s) && shouldImportChromeCookieDomain(s));
}

/**
 * Import all cookies for the given domains from Chrome into an Electron session.
 */
export async function importChromeCookies(
  ses: Electron.Session,
): Promise<CookieImportResult> {
  const chromeInfo = findChromeDB();
  if (!chromeInfo) {
    return { imported: 0, failed: 0, domains: [] };
  }

  const { dbPath, browser } = chromeInfo;
  const dbVersion = getDBVersion(dbPath);

  // Get decryption key
  const keyringPassword = getKeyringPassword(browser);
  const v11Key = keyringPassword ? deriveKey(keyringPassword) : null;

  // Find domains with login sessions
  const authDomains = findAuthDomains(dbPath);
  if (authDomains.length === 0) {
    return { imported: 0, failed: 0, domains: [] };
  }

  // Build SQL to fetch ALL cookies for those domains
  const domainList = authDomains.map(d => `'${d.replace(/'/g, "''")}'`).join(',');
  const sql = `SELECT host_key, name, path, hex(encrypted_value), expires_utc, is_secure, is_httponly, samesite FROM cookies WHERE host_key IN (${domainList})`;
  const output = queryDB(dbPath, sql);
  const rows = parseRows(output);

  let imported = 0;
  let failed = 0;
  const importedDomains = new Set<string>();

  for (const row of rows) {
    if (!shouldImportChromeCookieDomain(row.host_key)) {
      continue;
    }

    const value = decryptValue(row.encrypted_value_hex, v11Key, dbVersion, row.host_key);
    if (value === null) {
      failed++;
      continue;
    }

    const sameSiteMap: Record<number, 'unspecified' | 'no_restriction' | 'lax' | 'strict'> = {
      [-1]: 'unspecified',
      0: 'no_restriction',
      1: 'lax',
      2: 'strict',
    };

    const url = `http${row.is_secure ? 's' : ''}://${row.host_key.replace(/^\./, '')}${row.path}`;
    const expirationDate = row.expires_utc > 0 ? chromeTimestampToUnix(row.expires_utc) : undefined;

    try {
      await ses.cookies.set({
        url,
        name: row.name,
        value,
        domain: row.host_key,
        path: row.path,
        secure: row.is_secure === 1,
        httpOnly: row.is_httponly === 1,
        sameSite: sameSiteMap[row.samesite] || 'unspecified',
        expirationDate,
      });
      imported++;
      importedDomains.add(row.host_key);
    } catch {
      failed++;
    }
  }

  return { imported, failed, domains: Array.from(importedDomains) };
}

/**
 * Check if Chrome is available and has cookies to import.
 */
export function isChromeAvailable(): boolean {
  return findChromeDB() !== null;
}

/**
 * Show a one-time dialog asking the user if they want to import Chrome sessions.
 * Returns true if user opts in.
 */
export async function promptCookieImport(parentWindow: BrowserWindow | null): Promise<boolean> {
  const options: Electron.MessageBoxOptions = {
    type: 'question',
    buttons: ['Import Sessions', 'No Thanks'],
    defaultId: 0,
    cancelId: 1,
    title: 'Import Browser Sessions',
    message: 'Import logged-in sessions from Chrome?',
    detail:
      'This will transfer your active login sessions (Google, GitHub, etc.) ' +
      'from your Chrome browser so you don\'t need to sign in again.\n\n' +
      'Sessions will stay in sync each time the app starts.',
  };
  const result = parentWindow
    ? await dialog.showMessageBox(parentWindow, options)
    : await dialog.showMessageBox(options);
  return result.response === 0;
}
