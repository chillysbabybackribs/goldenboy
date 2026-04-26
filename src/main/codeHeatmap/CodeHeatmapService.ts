import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { eventBus } from '../events/eventBus';
import { AppEventType } from '../../shared/types/events';
import { APP_WORKSPACE_ROOT } from '../workspaceRoot';
import type { CodeHeatmapEditEvent, CodeHeatmapNode, CodeHeatmapSnapshot } from '../../shared/types/codeHeatmap';

const DATA_FILE = 'code-heatmap.json';
const MAX_RECENT_EDITS = 120;
const MAX_HOT_NODES = 24;
const UPDATE_DEBOUNCE_MS = 180;
const IGNORED_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  '.vite',
  'coverage',
]);
const IGNORED_FILE_SUFFIXES = [
  '.log',
  '.tmp',
  '.tsbuildinfo',
];

type HeatRecord = {
  editCount: number;
  lastEditedAt: number;
};

type PersistedHeatmap = {
  fileRecords: Array<[string, HeatRecord]>;
  recentEdits: CodeHeatmapEditEvent[];
  startedAt: number | null;
  updatedAt: number | null;
  totalEdits: number;
};

export class CodeHeatmapService {
  private watchers = new Map<string, fs.FSWatcher>();
  private fileRecords = new Map<string, HeatRecord>();
  private recentEdits: CodeHeatmapEditEvent[] = [];
  private startedAt: number | null = null;
  private updatedAt: number | null = null;
  private totalEdits = 0;
  private updateTimer: ReturnType<typeof setTimeout> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private watching = false;

  init(): void {
    this.loadPersisted();
    this.start();
  }

  dispose(): void {
    this.stop();
    this.persistNow();
  }

  getSnapshot(): CodeHeatmapSnapshot {
    const hottestFiles = this.buildHottestFiles();
    const hottestDirectories = this.buildHottestDirectories();
    return {
      root: APP_WORKSPACE_ROOT,
      watching: this.watching,
      startedAt: this.startedAt,
      updatedAt: this.updatedAt,
      totalEdits: this.totalEdits,
      watchedDirectoryCount: this.watchers.size,
      ignoredPaths: Array.from(IGNORED_DIR_NAMES.values()),
      hottestFiles,
      hottestDirectories,
      recentEdits: [...this.recentEdits],
    };
  }

  private start(): void {
    if (this.watching) return;
    this.startedAt = this.startedAt ?? Date.now();
    this.watchDirectoryRecursive(APP_WORKSPACE_ROOT);
    this.watching = true;
    this.emitUpdate();
  }

  private stop(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
    this.watching = false;
  }

  private watchDirectoryRecursive(dirPath: string): void {
    if (this.shouldIgnoreAbsolutePath(dirPath)) return;
    if (this.watchers.has(dirPath)) return;

    try {
      const watcher = fs.watch(dirPath, (_eventType, filename) => {
        const targetPath = typeof filename === 'string' && filename.length > 0
          ? path.join(dirPath, filename)
          : dirPath;
        this.handleFsEvent(targetPath, dirPath);
      });
      this.watchers.set(dirPath, watcher);
      watcher.on('error', () => {
        this.watchers.delete(dirPath);
      });
    } catch {
      return;
    }

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (IGNORED_DIR_NAMES.has(entry.name)) continue;
      this.watchDirectoryRecursive(path.join(dirPath, entry.name));
    }
  }

  private handleFsEvent(targetPath: string, parentDir: string): void {
    if (this.shouldIgnoreAbsolutePath(targetPath)) return;

    let stat: fs.Stats | null = null;
    try {
      stat = fs.statSync(targetPath);
    } catch {
      stat = null;
    }

    if (stat?.isDirectory()) {
      this.watchDirectoryRecursive(targetPath);
      this.scheduleWatcherCleanup();
      return;
    }

    if (targetPath === parentDir) {
      this.scheduleWatcherRescan(parentDir);
      return;
    }

    this.recordEdit(targetPath);
  }

  private scheduleWatcherRescan(dirPath: string): void {
    setTimeout(() => {
      if (!fs.existsSync(dirPath)) {
        this.removeWatcherTree(dirPath);
        return;
      }
      this.watchDirectoryRecursive(dirPath);
    }, 60);
  }

  private scheduleWatcherCleanup(): void {
    setTimeout(() => {
      for (const watchedDir of Array.from(this.watchers.keys())) {
        if (!fs.existsSync(watchedDir)) {
          this.removeWatcherTree(watchedDir);
        }
      }
    }, 80);
  }

  private removeWatcherTree(rootPath: string): void {
    for (const [watchedDir, watcher] of this.watchers.entries()) {
      if (watchedDir === rootPath || watchedDir.startsWith(`${rootPath}${path.sep}`)) {
        watcher.close();
        this.watchers.delete(watchedDir);
      }
    }
  }

  private recordEdit(filePath: string): void {
    if (this.shouldIgnoreAbsolutePath(filePath)) return;
    const relPath = this.toRelativeWorkspacePath(filePath);
    if (!relPath) return;

    const now = Date.now();
    const current = this.fileRecords.get(relPath) ?? { editCount: 0, lastEditedAt: now };
    current.editCount += 1;
    current.lastEditedAt = now;
    this.fileRecords.set(relPath, current);
    this.recentEdits.unshift({ path: relPath, timestamp: now });
    this.recentEdits = this.recentEdits.slice(0, MAX_RECENT_EDITS);
    this.totalEdits += 1;
    this.updatedAt = now;
    this.scheduleEmitUpdate();
    this.schedulePersist();
  }

  private scheduleEmitUpdate(): void {
    if (this.updateTimer) clearTimeout(this.updateTimer);
    this.updateTimer = setTimeout(() => {
      this.updateTimer = null;
      this.emitUpdate();
    }, UPDATE_DEBOUNCE_MS);
  }

  private emitUpdate(): void {
    eventBus.emit(AppEventType.CODE_HEATMAP_UPDATED, { snapshot: this.getSnapshot() });
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistNow();
    }, 400);
  }

  private persistNow(): void {
    const filePath = this.getDataPath();
    const payload: PersistedHeatmap = {
      fileRecords: Array.from(this.fileRecords.entries()),
      recentEdits: this.recentEdits,
      startedAt: this.startedAt,
      updatedAt: this.updatedAt,
      totalEdits: this.totalEdits,
    };
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
    } catch {
      // Ignore persistence failures; live updates still work.
    }
  }

  private loadPersisted(): void {
    const filePath = this.getDataPath();
    try {
      if (!fs.existsSync(filePath)) return;
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedHeatmap;
      this.fileRecords = new Map(
        Array.isArray(parsed.fileRecords)
          ? parsed.fileRecords.filter((entry): entry is [string, HeatRecord] => (
              Array.isArray(entry)
              && typeof entry[0] === 'string'
              && typeof entry[1]?.editCount === 'number'
              && typeof entry[1]?.lastEditedAt === 'number'
            ))
          : [],
      );
      this.recentEdits = Array.isArray(parsed.recentEdits) ? parsed.recentEdits.slice(0, MAX_RECENT_EDITS) : [];
      this.startedAt = typeof parsed.startedAt === 'number' ? parsed.startedAt : null;
      this.updatedAt = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : null;
      this.totalEdits = typeof parsed.totalEdits === 'number' ? parsed.totalEdits : 0;
    } catch {
      this.fileRecords.clear();
      this.recentEdits = [];
      this.startedAt = null;
      this.updatedAt = null;
      this.totalEdits = 0;
    }
  }

  private buildHottestFiles(): CodeHeatmapNode[] {
    const maxCount = this.maxEditCount();
    return Array.from(this.fileRecords.entries())
      .sort((a, b) => b[1].editCount - a[1].editCount || b[1].lastEditedAt - a[1].lastEditedAt)
      .slice(0, MAX_HOT_NODES)
      .map(([filePath, record]) => ({
        kind: 'file',
        path: filePath,
        editCount: record.editCount,
        lastEditedAt: record.lastEditedAt,
        intensity: maxCount > 0 ? record.editCount / maxCount : 0,
      }));
  }

  private buildHottestDirectories(): CodeHeatmapNode[] {
    const directoryRecords = new Map<string, HeatRecord>();
    for (const [filePath, record] of this.fileRecords.entries()) {
      const segments = filePath.split('/').slice(0, -1);
      let current = '';
      for (const segment of segments) {
        current = current ? `${current}/${segment}` : segment;
        const existing = directoryRecords.get(current) ?? { editCount: 0, lastEditedAt: 0 };
        existing.editCount += record.editCount;
        existing.lastEditedAt = Math.max(existing.lastEditedAt, record.lastEditedAt);
        directoryRecords.set(current, existing);
      }
    }

    const maxCount = Array.from(directoryRecords.values()).reduce((max, record) => Math.max(max, record.editCount), 0);
    return Array.from(directoryRecords.entries())
      .sort((a, b) => b[1].editCount - a[1].editCount || b[1].lastEditedAt - a[1].lastEditedAt)
      .slice(0, MAX_HOT_NODES)
      .map(([dirPath, record]) => ({
        kind: 'directory',
        path: dirPath,
        editCount: record.editCount,
        lastEditedAt: record.lastEditedAt,
        intensity: maxCount > 0 ? record.editCount / maxCount : 0,
      }));
  }

  private maxEditCount(): number {
    let max = 0;
    for (const record of this.fileRecords.values()) {
      max = Math.max(max, record.editCount);
    }
    return max;
  }

  private shouldIgnoreAbsolutePath(targetPath: string): boolean {
    const normalized = path.resolve(targetPath);
    if (!normalized.startsWith(APP_WORKSPACE_ROOT)) return true;
    const relPath = path.relative(APP_WORKSPACE_ROOT, normalized);
    if (relPath.startsWith('..')) return true;
    if (!relPath) return false;
    const segments = relPath.split(path.sep);
    if (segments.some((segment) => IGNORED_DIR_NAMES.has(segment))) return true;
    return IGNORED_FILE_SUFFIXES.some((suffix) => relPath.endsWith(suffix));
  }

  private toRelativeWorkspacePath(targetPath: string): string | null {
    const relPath = path.relative(APP_WORKSPACE_ROOT, path.resolve(targetPath));
    if (!relPath || relPath.startsWith('..')) return null;
    return relPath.split(path.sep).join('/');
  }

  private getDataPath(): string {
    return path.join(app.getPath('userData'), DATA_FILE);
  }
}

export const codeHeatmapService = new CodeHeatmapService();
