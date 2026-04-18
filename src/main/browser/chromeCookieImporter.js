"use strict";
// ═══════════════════════════════════════════════════════════════════════════
// Chrome Cookie Importer — Import logged-in sessions from Chrome browser
// ═══════════════════════════════════════════════════════════════════════════
//
// Reads Chrome's cookie database, decrypts auth-related cookies, and imports
// them into the Electron session so users stay logged in without re-auth.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldImportChromeCookieDomain = shouldImportChromeCookieDomain;
exports.importChromeCookies = importChromeCookies;
exports.isChromeAvailable = isChromeAvailable;
exports.promptCookieImport = promptCookieImport;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const electron_1 = require("electron");
const chromeCookieCrypto_1 = require("./chromeCookieCrypto");
// ─── Chrome profile detection ─────────────────────────────────────────────
const CHROME_PATHS = [
    path.join(electron_1.app.getPath('home'), '.config', 'google-chrome', 'Default', 'Cookies'),
    path.join(electron_1.app.getPath('home'), '.config', 'chromium', 'Default', 'Cookies'),
];
const IMPORT_BLOCKED_DOMAIN_SUFFIXES = [
    'google.com',
    'youtube.com',
    'googlevideo.com',
    'googleusercontent.com',
];
function findChromeDB() {
    for (const p of CHROME_PATHS) {
        if (fs.existsSync(p)) {
            const browser = p.includes('google-chrome') ? 'chrome' : 'chromium';
            return { dbPath: p, browser };
        }
    }
    return null;
}
function normalizeHost(host) {
    return host.replace(/^\./, '').toLowerCase();
}
function shouldImportChromeCookieDomain(host) {
    const normalized = normalizeHost(host);
    return !IMPORT_BLOCKED_DOMAIN_SUFFIXES.some(suffix => normalized === suffix || normalized.endsWith(`.${suffix}`));
}
// ─── Keyring password retrieval ───────────────────────────────────────────
function getKeyringPassword(browser) {
    const label = browser === 'chrome' ? 'Chrome Safe Storage' : 'Chromium Safe Storage';
    try {
        const output = (0, child_process_1.execSync)(`secret-tool search application ${browser} 2>/dev/null || secret-tool lookup label "${label}" 2>/dev/null`, { timeout: 5000, encoding: 'utf-8' });
        // secret-tool search outputs "secret = <value>"
        const match = output.match(/secret\s*=\s*(.+)/);
        if (match)
            return match[1].trim();
        // secret-tool lookup outputs just the raw secret
        if (output.trim() && !output.includes('='))
            return output.trim();
        return null;
    }
    catch {
        return null;
    }
}
// ─── SQL via sqlite3 CLI ──────────────────────────────────────────────────
function queryDB(dbPath, sql) {
    // Copy DB to avoid WAL lock conflicts with running Chrome
    const tmpPath = path.join(electron_1.app.getPath('temp'), 'chrome-cookies-import.db');
    fs.copyFileSync(dbPath, tmpPath);
    // Also copy WAL and SHM if they exist (ensures recent cookies are included)
    for (const ext of ['-wal', '-shm']) {
        const src = dbPath + ext;
        if (fs.existsSync(src))
            fs.copyFileSync(src, tmpPath + ext);
    }
    try {
        return (0, child_process_1.execSync)(`sqlite3 "${tmpPath}" "${sql}"`, { timeout: 10000, encoding: 'utf-8' });
    }
    finally {
        try {
            fs.unlinkSync(tmpPath);
        }
        catch { }
        try {
            fs.unlinkSync(tmpPath + '-wal');
        }
        catch { }
        try {
            fs.unlinkSync(tmpPath + '-shm');
        }
        catch { }
    }
}
function getDBVersion(dbPath) {
    const tmpPath = path.join(electron_1.app.getPath('temp'), 'chrome-cookies-import.db');
    fs.copyFileSync(dbPath, tmpPath);
    try {
        const out = (0, child_process_1.execSync)(`sqlite3 "${tmpPath}" "SELECT value FROM meta WHERE key='version'"`, {
            timeout: 5000, encoding: 'utf-8',
        });
        return parseInt(out.trim(), 10) || 0;
    }
    catch {
        return 0;
    }
    finally {
        try {
            fs.unlinkSync(tmpPath);
        }
        catch { }
    }
}
/**
 * Detect which domains have active login sessions in Chrome.
 * Heuristic: domains with httponly + secure + non-session cookies.
 */
function findAuthDomains(dbPath, includeGoogle) {
    const sql = `SELECT DISTINCT host_key FROM cookies WHERE is_httponly = 1 AND is_secure = 1 AND expires_utc > 0`;
    const output = queryDB(dbPath, sql);
    return output.split('\n')
        .map(s => s.trim())
        .filter(s => s && !(0, chromeCookieCrypto_1.isTrackerDomain)(s) && (includeGoogle || shouldImportChromeCookieDomain(s)));
}
/**
 * Import all cookies for the given domains from Chrome into an Electron session.
 *
 * @param includeGoogle When true, also imports Google-family cookies (used
 *   after the user completes Google sign-in in the system browser).
 */
async function importChromeCookies(ses, includeGoogle = false) {
    const chromeInfo = findChromeDB();
    if (!chromeInfo) {
        return { imported: 0, failed: 0, domains: [] };
    }
    const { dbPath, browser } = chromeInfo;
    const dbVersion = getDBVersion(dbPath);
    // Get decryption key
    const keyringPassword = getKeyringPassword(browser);
    const v11Key = keyringPassword ? (0, chromeCookieCrypto_1.deriveKey)(keyringPassword) : null;
    // Find domains with login sessions
    const authDomains = findAuthDomains(dbPath, includeGoogle);
    if (authDomains.length === 0) {
        return { imported: 0, failed: 0, domains: [] };
    }
    // Build SQL to fetch ALL cookies for those domains
    const domainList = authDomains.map(d => `'${d.replace(/'/g, "''")}'`).join(',');
    const sql = `SELECT host_key, name, path, hex(encrypted_value), expires_utc, is_secure, is_httponly, samesite FROM cookies WHERE host_key IN (${domainList})`;
    const output = queryDB(dbPath, sql);
    const rows = (0, chromeCookieCrypto_1.parseRows)(output);
    let imported = 0;
    let failed = 0;
    const importedDomains = new Set();
    for (const row of rows) {
        if (!includeGoogle && !shouldImportChromeCookieDomain(row.host_key)) {
            continue;
        }
        const value = (0, chromeCookieCrypto_1.decryptValue)(row.encrypted_value_hex, v11Key, dbVersion, row.host_key);
        if (value === null) {
            failed++;
            continue;
        }
        const sameSiteMap = {
            [-1]: 'unspecified',
            0: 'no_restriction',
            1: 'lax',
            2: 'strict',
        };
        const url = `http${row.is_secure ? 's' : ''}://${row.host_key.replace(/^\./, '')}${row.path}`;
        const expirationDate = row.expires_utc > 0 ? (0, chromeCookieCrypto_1.chromeTimestampToUnix)(row.expires_utc) : undefined;
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
        }
        catch {
            failed++;
        }
    }
    return { imported, failed, domains: Array.from(importedDomains) };
}
/**
 * Check if Chrome is available and has cookies to import.
 */
function isChromeAvailable() {
    return findChromeDB() !== null;
}
/**
 * Show a one-time dialog asking the user if they want to import Chrome sessions.
 * Returns true if user opts in.
 */
async function promptCookieImport(parentWindow) {
    const options = {
        type: 'question',
        buttons: ['Import Sessions', 'No Thanks'],
        defaultId: 0,
        cancelId: 1,
        title: 'Import Browser Sessions',
        message: 'Import logged-in sessions from Chrome?',
        detail: 'This will transfer your active login sessions (Google, GitHub, etc.) ' +
            'from your Chrome browser so you don\'t need to sign in again.\n\n' +
            'Sessions will stay in sync each time the app starts.',
    };
    const result = parentWindow
        ? await electron_1.dialog.showMessageBox(parentWindow, options)
        : await electron_1.dialog.showMessageBox(options);
    return result.response === 0;
}
//# sourceMappingURL=chromeCookieImporter.js.map