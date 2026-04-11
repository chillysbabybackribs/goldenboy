import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { BrowserSiteStrategy, BrowserSurfaceEvalFixture } from '../../shared/types/browserIntelligence';

const SITE_STRATEGIES_FILE = 'browser-site-strategies.json';
const SURFACE_FIXTURES_FILE = 'browser-surface-fixtures.jsonl';

function ensureUserDataDir(): string {
  const dir = app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson<T>(filename: string, fallback: T): T {
  try {
    const filePath = path.join(ensureUserDataDir(), filename);
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filename: string, value: unknown): void {
  try {
    const filePath = path.join(ensureUserDataDir(), filename);
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
  } catch (err) {
    console.error(`Failed to persist ${filename}:`, err);
  }
}

function appendJsonl(filename: string, value: unknown): void {
  try {
    const filePath = path.join(ensureUserDataDir(), filename);
    fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf-8');
  } catch (err) {
    console.error(`Failed to append ${filename}:`, err);
  }
}

export function loadSiteStrategies(): BrowserSiteStrategy[] {
  const parsed = readJson<BrowserSiteStrategy[]>(SITE_STRATEGIES_FILE, []);
  return Array.isArray(parsed) ? parsed : [];
}

export function saveSiteStrategies(strategies: BrowserSiteStrategy[]): void {
  writeJson(SITE_STRATEGIES_FILE, strategies);
}

export function appendSurfaceFixture(fixture: BrowserSurfaceEvalFixture): void {
  appendJsonl(SURFACE_FIXTURES_FILE, fixture);
}

export function getSurfaceFixturesPath(): string {
  return path.join(ensureUserDataDir(), SURFACE_FIXTURES_FILE);
}
