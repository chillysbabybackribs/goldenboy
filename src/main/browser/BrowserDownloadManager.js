"use strict";
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
exports.BrowserDownloadManager = void 0;
const fs = __importStar(require("fs"));
const events_1 = require("../../shared/types/events");
const eventBus_1 = require("../events/eventBus");
const ids_1 = require("../../shared/utils/ids");
const browserDownloads_1 = require("./browserDownloads");
function cloneDownload(download) {
    return { ...download };
}
class BrowserDownloadManager {
    activeDownloads = new Map();
    completedDownloads = [];
    downloadStartWaiters = new Map();
    sessionAttached = false;
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    attachSession(sessionInstance) {
        if (this.sessionAttached)
            return;
        this.sessionAttached = true;
        sessionInstance.on('will-download', (_event, item, webContents) => {
            const filename = item.getFilename();
            const savePath = (0, browserDownloads_1.resolveDownloadPath)(filename);
            item.setSavePath(savePath);
            const entry = (0, browserDownloads_1.createDownloadEntry)(item.getURL(), filename, savePath);
            entry.sourceTabId = webContents ? this.deps.resolveTabIdByWebContentsId(webContents.id) : null;
            entry.sourcePageUrl = webContents?.getURL() || null;
            this.activeDownloads.set(entry.id, { entry, item });
            this.resolveDownloadStartWaiters(entry);
            eventBus_1.eventBus.emit(events_1.AppEventType.BROWSER_DOWNLOAD_STARTED, { download: cloneDownload(entry) });
            this.deps.emitLog('info', `Download started: ${filename}`);
            this.deps.syncState();
            item.on('updated', (_e, state) => {
                entry.receivedBytes = item.getReceivedBytes();
                entry.totalBytes = item.getTotalBytes();
                entry.state = state === 'progressing' ? 'progressing' : 'interrupted';
                eventBus_1.eventBus.emit(events_1.AppEventType.BROWSER_DOWNLOAD_UPDATED, { download: cloneDownload(entry) });
                this.deps.syncState();
            });
            item.once('done', (_e, state) => {
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
                    }
                    else {
                        entry.existsOnDisk = false;
                        entry.fileSize = null;
                    }
                }
                catch (err) {
                    entry.existsOnDisk = false;
                    entry.fileSize = null;
                    entry.error = err instanceof Error ? err.message : String(err);
                }
                if (entry.state === 'completed' && entry.existsOnDisk === false && !entry.error) {
                    entry.error = 'Download completed but saved file was not found on disk';
                }
                eventBus_1.eventBus.emit(events_1.AppEventType.BROWSER_DOWNLOAD_COMPLETED, { download: cloneDownload(entry) });
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
    getActiveDownloads() {
        return Array.from(this.activeDownloads.values()).map(({ entry }) => cloneDownload(entry));
    }
    getCompletedDownloads() {
        return this.completedDownloads.map(cloneDownload);
    }
    getDownloads() {
        return [...this.getActiveDownloads(), ...this.getCompletedDownloads()];
    }
    async downloadFromWebContents(tabId, webContents, url) {
        const waiterId = (0, ids_1.generateId)('downloadwait');
        const waitForStart = new Promise((resolve, reject) => {
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
        }
        catch (err) {
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
    async waitForDownload(input = {}) {
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
    cancelDownload(downloadId) {
        const download = this.activeDownloads.get(downloadId);
        if (!download)
            return;
        download.item.cancel();
        this.activeDownloads.delete(downloadId);
        this.deps.syncState();
    }
    clearDownloads() {
        this.completedDownloads = [];
        this.deps.syncState();
    }
    dispose() {
        for (const waiter of this.downloadStartWaiters.values()) {
            clearTimeout(waiter.timer);
            waiter.reject(new Error('Browser download manager disposed'));
        }
        this.downloadStartWaiters.clear();
        this.activeDownloads.clear();
        this.completedDownloads = [];
    }
    normalizeComparableUrl(url) {
        try {
            const parsed = new URL(url);
            parsed.hash = '';
            return parsed.toString();
        }
        catch {
            return url;
        }
    }
    resolveDownloadStartWaiters(download) {
        const downloadUrl = this.normalizeComparableUrl(download.url);
        for (const [waiterId, waiter] of this.downloadStartWaiters.entries()) {
            const waiterUrl = this.normalizeComparableUrl(waiter.url);
            const tabMatches = !waiter.tabId || waiter.tabId === download.sourceTabId;
            if (!tabMatches || waiterUrl !== downloadUrl)
                continue;
            clearTimeout(waiter.timer);
            waiter.resolve(cloneDownload(download));
            this.downloadStartWaiters.delete(waiterId);
        }
    }
}
exports.BrowserDownloadManager = BrowserDownloadManager;
//# sourceMappingURL=BrowserDownloadManager.js.map