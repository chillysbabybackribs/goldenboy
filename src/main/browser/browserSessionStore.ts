// ═══════════════════════════════════════════════════════════════════════════
// Browser Session Store — Persistent browser data across sessions
// History, bookmarks, settings, and tab state
// ═══════════════════════════════════════════════════════════════════════════

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { BrowserHistoryEntry, BookmarkEntry, BrowserSettings, createDefaultSettings } from '../../shared/types/browser';

const DATA_FILE = 'browser-data.json';
const MAX_HISTORY_ENTRIES = 2000;

function getDataPath(): string {
  return path.join(app.getPath('userData'), DATA_FILE);
}

type PersistedBrowserData = {
  history: BrowserHistoryEntry[];
  bookmarks: BookmarkEntry[];
  settings: BrowserSettings;
  lastUrls: string[];   // URLs of open tabs at last close
  activeTabIndex: number;
};

function loadData(): PersistedBrowserData {
  try {
    const filePath = getDataPath();
    if (!fs.existsSync(filePath)) {
      // Check for legacy file and migrate
      const legacyPath = path.join(app.getPath('userData'), 'browser-history.json');
      if (fs.existsSync(legacyPath)) {
        const raw = fs.readFileSync(legacyPath, 'utf-8');
        const legacy = JSON.parse(raw);
        const migrated: PersistedBrowserData = {
          history: Array.isArray(legacy.history) ? legacy.history : [],
          bookmarks: [],
          settings: createDefaultSettings(),
          lastUrls: legacy.lastUrl ? [legacy.lastUrl] : [],
          activeTabIndex: 0,
        };
        // Add favicon field to old entries
        migrated.history = migrated.history.map(h => ({ ...h, favicon: (h as any).favicon || '' }));
        saveData(migrated);
        return migrated;
      }
      return { history: [], bookmarks: [], settings: createDefaultSettings(), lastUrls: [], activeTabIndex: 0 };
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as PersistedBrowserData;
    return {
      history: Array.isArray(parsed.history) ? parsed.history.slice(-MAX_HISTORY_ENTRIES) : [],
      bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks : [],
      settings: parsed.settings ? { ...createDefaultSettings(), ...parsed.settings } : createDefaultSettings(),
      lastUrls: Array.isArray(parsed.lastUrls) ? parsed.lastUrls : [],
      activeTabIndex: typeof parsed.activeTabIndex === 'number' ? parsed.activeTabIndex : 0,
    };
  } catch {
    return { history: [], bookmarks: [], settings: createDefaultSettings(), lastUrls: [], activeTabIndex: 0 };
  }
}

function saveData(data: PersistedBrowserData): void {
  try {
    const filePath = getDataPath();
    data.history = data.history.slice(-MAX_HISTORY_ENTRIES);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to persist browser data:', err);
  }
}

// Cached in memory, written to disk on save
let cached: PersistedBrowserData | null = null;

function getData(): PersistedBrowserData {
  if (!cached) cached = loadData();
  return cached;
}

// ─── History ────────────────────────────────────────────────────────────────

export function loadBrowserHistory(): BrowserHistoryEntry[] {
  return [...getData().history];
}

export function loadLastUrls(): string[] {
  return [...getData().lastUrls];
}

export function loadActiveTabIndex(): number {
  return getData().activeTabIndex;
}

export function saveBrowserHistory(history: BrowserHistoryEntry[], lastUrls: string[], activeTabIndex: number): void {
  const data = getData();
  data.history = history;
  data.lastUrls = lastUrls;
  data.activeTabIndex = activeTabIndex;
  cached = data;
  saveData(data);
}

// ─── Bookmarks ──────────────────────────────────────────────────────────────

export function loadBookmarks(): BookmarkEntry[] {
  return [...getData().bookmarks];
}

export function saveBookmarks(bookmarks: BookmarkEntry[]): void {
  const data = getData();
  data.bookmarks = bookmarks;
  cached = data;
  saveData(data);
}

// ─── Settings ───────────────────────────────────────────────────────────────

export function loadSettings(): BrowserSettings {
  return { ...getData().settings };
}

export function saveSettings(settings: BrowserSettings): void {
  const data = getData();
  data.settings = settings;
  cached = data;
  saveData(data);
}

// ─── Flush ──────────────────────────────────────────────────────────────────

export function flushAll(): void {
  if (cached) saveData(cached);
}
