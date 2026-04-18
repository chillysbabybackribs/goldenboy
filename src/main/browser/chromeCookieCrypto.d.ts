export declare function deriveKey(password: string): Buffer;
export declare function decryptValue(encryptedHex: string, v11Key: Buffer | null, dbVersion: number, hostKey: string): string | null;
export declare function chromeTimestampToUnix(chromeTs: number): number;
export declare function isTrackerDomain(host: string): boolean;
export type RawCookieRow = {
    host_key: string;
    name: string;
    path: string;
    encrypted_value_hex: string;
    expires_utc: number;
    is_secure: number;
    is_httponly: number;
    samesite: number;
};
export declare function parseRows(output: string): RawCookieRow[];
