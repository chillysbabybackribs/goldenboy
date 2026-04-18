import { BrowserWindow } from 'electron';
export declare function shouldImportChromeCookieDomain(host: string): boolean;
export type CookieImportResult = {
    imported: number;
    failed: number;
    domains: string[];
};
/**
 * Import all cookies for the given domains from Chrome into an Electron session.
 *
 * @param includeGoogle When true, also imports Google-family cookies (used
 *   after the user completes Google sign-in in the system browser).
 */
export declare function importChromeCookies(ses: Electron.Session, includeGoogle?: boolean): Promise<CookieImportResult>;
/**
 * Check if Chrome is available and has cookies to import.
 */
export declare function isChromeAvailable(): boolean;
/**
 * Show a one-time dialog asking the user if they want to import Chrome sessions.
 * Returns true if user opts in.
 */
export declare function promptCookieImport(parentWindow: BrowserWindow | null): Promise<boolean>;
