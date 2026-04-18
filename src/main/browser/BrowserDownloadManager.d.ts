import { WebContents, type Session } from 'electron';
import { BrowserDownloadState } from '../../shared/types/browser';
type Deps = {
    resolveTabIdByWebContentsId: (webContentsId: number) => string | null;
    emitLog: (level: 'info' | 'warn' | 'error', message: string) => void;
    syncState: () => void;
};
export declare class BrowserDownloadManager {
    private activeDownloads;
    private completedDownloads;
    private downloadStartWaiters;
    private sessionAttached;
    private deps;
    constructor(deps: Deps);
    attachSession(sessionInstance: Session): void;
    getActiveDownloads(): BrowserDownloadState[];
    getCompletedDownloads(): BrowserDownloadState[];
    getDownloads(): BrowserDownloadState[];
    downloadFromWebContents(tabId: string, webContents: WebContents, url: string): Promise<{
        started: boolean;
        error: string | null;
        url: string;
        tabId?: string;
        download?: BrowserDownloadState;
        method?: string;
    }>;
    waitForDownload(input?: {
        downloadId?: string;
        filename?: string;
        tabId?: string;
        timeoutMs?: number;
    }): Promise<{
        found: boolean;
        completed: boolean;
        timedOut: boolean;
        download: BrowserDownloadState | null;
    }>;
    cancelDownload(downloadId: string): void;
    clearDownloads(): void;
    dispose(): void;
    private normalizeComparableUrl;
    private resolveDownloadStartWaiters;
}
export {};
