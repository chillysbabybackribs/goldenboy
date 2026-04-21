import { BookmarkEntry, BrowserHistoryEntry } from '../../shared/types/browser';
import {
  loadActiveTabIndex,
  loadBookmarks,
  loadBrowserHistory,
  loadLastUrls,
  saveBookmarks,
  saveBrowserHistory,
} from './browserSessionStore';

const MAX_HISTORY = 2000;

export class BrowserPersistenceService {
  private history: BrowserHistoryEntry[] = [];
  private bookmarks: BookmarkEntry[] = [];

  load(): { history: BrowserHistoryEntry[]; bookmarks: BookmarkEntry[]; lastUrls: string[]; activeTabIndex: number } {
    this.history = loadBrowserHistory();
    this.bookmarks = loadBookmarks();
    return {
      history: this.getHistory(),
      bookmarks: this.getBookmarks(),
      lastUrls: loadLastUrls(),
      activeTabIndex: loadActiveTabIndex(),
    };
  }

  getHistory(): BrowserHistoryEntry[] {
    return [...this.history];
  }

  getRecentHistory(count: number = 50): BrowserHistoryEntry[] {
    return this.history.slice(-count);
  }

  getBookmarks(): BookmarkEntry[] {
    return [...this.bookmarks];
  }

  addBookmark(entry: BookmarkEntry): BookmarkEntry {
    this.bookmarks.push(entry);
    saveBookmarks(this.bookmarks);
    return { ...entry };
  }

  removeBookmark(bookmarkId: string): boolean {
    const before = this.bookmarks.length;
    this.bookmarks = this.bookmarks.filter(b => b.id !== bookmarkId);
    if (this.bookmarks.length === before) return false;
    saveBookmarks(this.bookmarks);
    return true;
  }

  recordHistoryEntry(url: string, title: string, favicon: string): boolean {
    if (!url || url === 'about:blank' || url.startsWith('devtools://')) return false;
    const last = this.history[this.history.length - 1];
    if (last && last.url === url) return false;
    this.history.push({ url, title: title || url, visitedAt: Date.now(), favicon: favicon || '' });
    if (this.history.length > MAX_HISTORY) this.history = this.history.slice(-MAX_HISTORY);
    return true;
  }

  updateLatestHistoryEntry(url: string, patch: Partial<Pick<BrowserHistoryEntry, 'title' | 'favicon'>>): void {
    const recent = this.history[this.history.length - 1];
    if (!recent || recent.url !== url) return;
    if (typeof patch.title === 'string') recent.title = patch.title;
    if (typeof patch.favicon === 'string') recent.favicon = patch.favicon;
  }

  clearHistory(): void {
    this.history = [];
  }

  persistHistorySnapshot(input: { lastUrls: string[]; activeTabIndex: number }): void {
    saveBrowserHistory(this.history, input.lastUrls, Math.max(0, input.activeTabIndex));
  }
}

