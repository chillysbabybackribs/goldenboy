import { DownloadItem, Event as ElectronEvent, WebContents, type Session } from 'electron';
import * as fs from 'fs';
import { BrowserDownloadState } from '../../shared/types/browser';
import { AppEventType } from '../../shared/types/events';
import { eventBus } from '../events/eventBus';
import { generateId } from '../../shared/utils/ids';
import { createDownloadEntry, resolveDownloadPath } from './browserDownloads';

type DownloadStartWaiter = {
  id: string;
  tabId: string | null;
  url: string;
  resolve: (download: BrowserDownloadState) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type Deps = {
  resolveTabIdByWebContentsId: (webContentsId: number) => string | null;
  emitLog: (level: 'info' | 'warn' | 'error', message: string) => void;
  syncState: () => void;
};

function cloneDownload(download: BrowserDownloadState): BrowserDownloadState {
  return { ...download };
}

export class BrowserDownloadManager {
  private activeDownloads = new Map<string, { entry: BrowserDownloadState; item: DownloadItem }>();
  private completedDownloads: BrowserDownloadState[] = [];
  private downloadStartWaiters = new Map<string, DownloadStartWaiter>();
  private sessionAttached = false;
  private deps: Deps;

  constructor(deps: Deps) {
    this.deps = deps;
  }

  attachSession(sessionInstance: Session): void {
    if (this.sessionAttached) return;
    this.sessionAttached = true;

    sessionInstance.on('will-download', (_event: ElectronEvent, item: DownloadItem, webContents) => {
      const filename = item.getFilename();
      const savePath = resolveDownloadPath(filename);
      item.setSavePath(savePath);
      const entry = createDownloadEntry(item.getURL(), filename, savePath);
      entry.sourceTabId = webContents ? this.deps.resolveTabIdByWebContentsId(webContents.id) : null;
      entry.sourcePageUrl = webContents?.getURL() || null;
      this.activeDownloads.set(entry.id, { entry, item });
      this.resolveDownloadStartWaiters(entry);
      eventBus.emit(AppEventType.BROWSER_DOWNLOAD_STARTED, { download: cloneDownload(entry) });
      this.deps.emitLog('info', `Download started: ${filename}`);
      this.deps.syncState();

      item.on('updated', (_e: ElectronEvent, state: string) => {
        entry.receivedBytes = item.getReceivedBytes();
        entry.totalBytes = item.getTotalBytes();
        entry.state = state === 'progressing' ? 'progressing' : 'interrupted';
        eventBus.emit(AppEventType.BROWSER_DOWNLOAD_UPDATED, { download: cloneDownload(entry) });
        this.deps.syncState();
      });

      item.once('done', (_e: ElectronEvent, state: string) => {
        entry.receivedBytes = item.getReceivedBytes();
        entry.totalBytes = item.getTotalBytes();
        entry.state = state === 'completed'
          ? 'completed'
          : state === 'interrupted'
            ? 'interrupted'
            : 'cancelled';
        entry.completedAt = Date.now();
        try {
          if (fs.existsSync(savePath)) {
            const stats = fs.statSync(savePath);
            entry.existsOnDisk = stats.isFile();
            entry.fileSize = stats.isFile() ? stats.size : null;
          } else {
            entry.existsOnDisk = false;
            entry.fileSize = null;
          }
        } catch (err) {
          entry.existsOnDisk = false;
          entry.fileSize = null;
          entry.error = err instanceof Error ? err.message : String(err);
        }
        if (entry.state === 'completed' && entry.existsOnDisk === false && !entry.error) {
          entry.error = 'Download completed but saved file was not found on disk';
        }
        eventBus.emit(AppEventType.BROWSER_DOWNLOAD_COMPLETED, { download: cloneDownload(entry) });
        this.deps.emitLog(entry.state === 'completed' ? 'info' : 'warn', `Download ${entry.state}: ${filename}`);
        this.activeDownloads.delete(entry.id);
        this.completedDownloads.push(cloneDownload(entry));
        if (this.completedDownloads.length > 100) {
          this.completedDownloads = this.completedDownloads.slice(-100);
        }
        this.deps.syncState();
      });
    });
  }

  getActiveDownloads(): BrowserDownloadState[] {
    return Array.from(this.activeDownloads.values()).map(({ entry }) => cloneDownload(entry));
  }

  getCompletedDownloads(): BrowserDownloadState[] {
    return this.completedDownloads.map(cloneDownload);
  }

  getDownloads(): BrowserDownloadState[] {
    return [...this.getActiveDownloads(), ...this.getCompletedDownloads()];
  }

  async downloadFromWebContents(
    tabId: string,
    webContents: WebContents,
    url: string,
  ): Promise<{
    started: boolean;
    error: string | null;
    url: string;
    tabId?: string;
    download?: BrowserDownloadState;
    method?: string;
  }> {
    const waiterId = generateId('downloadwait');
    const waitForStart = new Promise<BrowserDownloadState>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.downloadStartWaiters.delete(waiterId);
        reject(new Error(`Timed out waiting for browser download event for ${url}`));
      }, 5000);
      this.downloadStartWaiters.set(waiterId, {
        id: waiterId,
        tabId,
        url,
        resolve,
        reject,
        timer,
      });
    });

    try {
      webContents.downloadURL(url);
      const download = await waitForStart;
      return {
        started: true,
        error: null,
        url,
        tabId,
        download,
        method: 'webContents.downloadURL',
      };
    } catch (err) {
      const waiter = this.downloadStartWaiters.get(waiterId);
      if (waiter) {
        clearTimeout(waiter.timer);
        this.downloadStartWaiters.delete(waiterId);
      }
      return {
        started: false,
        error: err instanceof Error ? err.message : String(err),
        url,
        tabId,
        method: 'webContents.downloadURL',
      };
    }
  }

  async waitForDownload(input: {
    downloadId?: string;
    filename?: string;
    tabId?: string;
    timeoutMs?: number;
  } = {}): Promise<{
    found: boolean;
    completed: boolean;
    timedOut: boolean;
    download: BrowserDownloadState | null;
  }> {
    const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 15_000, 250), 60_000);
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const downloads = this.getDownloads();
      const candidates = downloads
        .filter(download => !input.downloadId || download.id === input.downloadId)
        .filter(download => !input.filename || download.filename === input.filename)
        .filter(download => !input.tabId || download.sourceTabId === input.tabId)
        .sort((a, b) => b.startedAt - a.startedAt);
      const match = candidates[0] || null;
      if (match) {
        const completed = match.state === 'completed' || match.state === 'cancelled' || match.state === 'interrupted';
        if (completed) {
          return {
            found: true,
            completed: match.state === 'completed',
            timedOut: false,
            download: match,
          };
        }
      }
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    const finalMatch = this.getDownloads()
      .filter(download => !input.downloadId || download.id === input.downloadId)
      .filter(download => !input.filename || download.filename === input.filename)
      .filter(download => !input.tabId || download.sourceTabId === input.tabId)
      .sort((a, b) => b.startedAt - a.startedAt)[0] || null;
    return {
      found: Boolean(finalMatch),
      completed: finalMatch?.state === 'completed',
      timedOut: true,
      download: finalMatch,
    };
  }

  cancelDownload(downloadId: string): void {
    const download = this.activeDownloads.get(downloadId);
    if (!download) return;
    download.item.cancel();
    this.activeDownloads.delete(downloadId);
    this.deps.syncState();
  }

  clearDownloads(): void {
    this.completedDownloads = [];
    this.deps.syncState();
  }

  dispose(): void {
    for (const waiter of this.downloadStartWaiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('Browser download manager disposed'));
    }
    this.downloadStartWaiters.clear();
    this.activeDownloads.clear();
    this.completedDownloads = [];
  }

  private normalizeComparableUrl(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return url;
    }
  }

  private resolveDownloadStartWaiters(download: BrowserDownloadState): void {
    const downloadUrl = this.normalizeComparableUrl(download.url);
    for (const [waiterId, waiter] of this.downloadStartWaiters.entries()) {
      const waiterUrl = this.normalizeComparableUrl(waiter.url);
      const tabMatches = !waiter.tabId || waiter.tabId === download.sourceTabId;
      if (!tabMatches || waiterUrl !== downloadUrl) continue;
      clearTimeout(waiter.timer);
      waiter.resolve(cloneDownload(download));
      this.downloadStartWaiters.delete(waiterId);
    }
  }
}
