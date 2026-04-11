// ═══════════════════════════════════════════════════════════════════════════
// Chrome Cookie Crypto — Pure decryption and parsing logic (no Electron deps)
// ═══════════════════════════════════════════════════════════════════════════

import * as crypto from 'crypto';

// ─── Decryption ───────────────────────────────────────────────────────────

export function deriveKey(password: string): Buffer {
  return crypto.pbkdf2Sync(password, 'saltysalt', 1, 16, 'sha1');
}

export function decryptValue(
  encryptedHex: string,
  v11Key: Buffer | null,
  dbVersion: number,
  hostKey: string,
): string | null {
  if (!encryptedHex || encryptedHex.length < 6) return null;

  const buf = Buffer.from(encryptedHex, 'hex');
  const prefix = buf.slice(0, 3).toString('utf8');

  let key: Buffer;
  if (prefix === 'v11') {
    if (!v11Key) return null;
    key = v11Key;
  } else if (prefix === 'v10') {
    key = deriveKey('peanuts');
  } else {
    return null;
  }

  try {
    const encrypted = buf.slice(3);
    const iv = Buffer.alloc(16, ' ');
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    decipher.setAutoPadding(false);

    let decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    // Remove PKCS7 padding
    const padding = decrypted[decrypted.length - 1];
    if (padding > 0 && padding <= 16) {
      decrypted = decrypted.slice(0, decrypted.length - padding);
    }

    // DB version >= 24: first 32 bytes are SHA-256 of host_key
    if (dbVersion >= 24) {
      decrypted = decrypted.slice(32);
    }

    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

// Chrome timestamps are microseconds since 1601-01-01
export function chromeTimestampToUnix(chromeTs: number): number {
  if (chromeTs === 0) return 0;
  return (chromeTs / 1_000_000) - 11_644_473_600;
}

// ─── Ad/tracker domain filtering ──────────────────────────────────────────

const TRACKER_PATTERNS = [
  /\.doubleclick\./,  /\.googlesyndication\./,  /\.google-analytics\./,
  /\.googleadservices\./,  /\.googletagmanager\./,  /\.googletagservices\./,
  /\.adsrvr\./,  /\.adnxs\./,  /\.rubiconproject\./,  /\.pubmatic\./,
  /\.casalemedia\./,  /\.demdex\./,  /\.quantserve\./,  /\.scorecardresearch\./,
  /\.taboola\./,  /\.outbrain\./,  /\.criteo\./,  /\.openx\./,
  /\.bidswitch\./,  /\.3lift\./,  /\.360yield\./,  /\.sharethrough\./,
  /\.spotxchange\./,  /\.indexww\./,  /\.rlcdn\./,  /\.bluekai\./,
  /\.exelator\./,  /\.eyeota\./,  /\.turn\./,  /\.mathtag\./,
  /\.serving-sys\./,  /\.sizmek\./,  /\.agkn\./,  /\.crwdcntrl\./,
  /\.contextweb\./,  /\.liadm\./,  /\.adsymptotic\./,  /\.advertising\./,
  /\.ipredictive\./,  /\.everesttech\./,  /\.moatads\./,  /\.bounceexchange\./,
  /\.addthis\./,  /\.intentiq\./,  /\.rkdms\./,  /\.trustmrr\./,
  /\.a-mo\.net/,  /\.6sc\.co/,  /\.prmutv\./,  /\.spot\.im/,
  /\.1rx\.io/,
];

export function isTrackerDomain(host: string): boolean {
  return TRACKER_PATTERNS.some(re => re.test(host));
}

// ─── Row parsing ──────────────────────────────────────────────────────────

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

export function parseRows(output: string): RawCookieRow[] {
  const rows: RawCookieRow[] = [];
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('|');
    if (parts.length < 8) continue;
    rows.push({
      host_key: parts[0],
      name: parts[1],
      path: parts[2],
      encrypted_value_hex: parts[3],
      expires_utc: parseInt(parts[4], 10) || 0,
      is_secure: parseInt(parts[5], 10) || 0,
      is_httponly: parseInt(parts[6], 10) || 0,
      samesite: parseInt(parts[7], 10) || 0,
    });
  }
  return rows;
}
