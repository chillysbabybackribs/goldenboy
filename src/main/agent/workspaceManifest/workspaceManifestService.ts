import * as path from 'path';
import {
  applyFileDelete,
  applyFileUpsert,
  buildWorkspaceManifest,
  type BuildManifestOptions,
} from './buildManifest';
import type { WorkspaceManifest } from './types';
import { renderDirectoryOverview, type RenderOverviewOptions } from './renderManifest';

export interface ManifestEntry {
  manifest: WorkspaceManifest;
  builtAt: number;
  buildMs: number;
}

export interface WorkspaceManifestServiceOptions {
  /** Build options applied to fresh builds. */
  build?: Partial<Omit<BuildManifestOptions, 'root'>>;
}

/**
 * In-memory cache of workspace manifests keyed by absolute root path. Mirror
 * of `RepoMapService`, but:
 *   - Covers ALL files, not just TypeScript.
 *   - Carries short "purpose" lines per file (from JSDoc / first markdown
 *     heading / frontmatter description / etc.).
 *   - Exposes a sync `getOverviewSync` for in-flight prompt building, plus
 *     async `getManifest` for the first build.
 */
export class WorkspaceManifestService {
  private entries = new Map<string, ManifestEntry>();
  private inflight = new Map<string, Promise<ManifestEntry>>();

  constructor(private readonly options: WorkspaceManifestServiceOptions = {}) {}

  async getManifest(rootAbs: string): Promise<ManifestEntry> {
    const key = path.resolve(rootAbs);
    const existing = this.entries.get(key);
    if (existing) return existing;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const promise = (async () => this.buildEntry(key))();
    this.inflight.set(key, promise);
    try {
      const entry = await promise;
      this.entries.set(key, entry);
      return entry;
    } finally {
      this.inflight.delete(key);
    }
  }

  /**
   * Build immediately and synchronously. Useful during startup pre-warm and
   * tests. Subsequent async callers will see the cached result.
   */
  ensureSync(rootAbs: string): ManifestEntry {
    const key = path.resolve(rootAbs);
    const existing = this.entries.get(key);
    if (existing) return existing;
    const entry = this.buildEntry(key);
    this.entries.set(key, entry);
    return entry;
  }

  async refresh(rootAbs: string): Promise<ManifestEntry> {
    const key = path.resolve(rootAbs);
    this.entries.delete(key);
    return this.getManifest(key);
  }

  clear(): void {
    this.entries.clear();
  }

  /** Synchronous overview render for prompt assembly. Returns null if no manifest is cached yet. */
  getOverviewSync(rootAbs: string, opts?: RenderOverviewOptions): string | null {
    const key = path.resolve(rootAbs);
    const entry = this.entries.get(key);
    if (!entry) return null;
    return renderDirectoryOverview(entry.manifest, opts);
  }

  /** Peek at the cached manifest without building. */
  peek(rootAbs: string): ManifestEntry | null {
    return this.entries.get(path.resolve(rootAbs)) ?? null;
  }

  /**
   * Stable cache-key fragment: changes iff the cached manifest's content has
   * been regenerated or patched. Used by prompt-template caching to bust
   * memoized system prompts when the workspace map has meaningfully changed.
   * Returns `no-manifest` until the first build completes.
   */
  getVersion(rootAbs: string): string {
    const entry = this.entries.get(path.resolve(rootAbs));
    if (!entry) return 'no-manifest';
    return `${entry.manifest.files.length}:${entry.manifest.generatedAt}`;
  }

  noteFileChanged(absFilePath: string): void {
    for (const entry of this.entries.values()) {
      if (!this.isUnderRoot(absFilePath, entry.manifest.root)) continue;
      applyFileUpsert(entry.manifest, absFilePath);
    }
  }

  noteFileDeleted(absFilePath: string): void {
    for (const entry of this.entries.values()) {
      if (!this.isUnderRoot(absFilePath, entry.manifest.root)) continue;
      applyFileDelete(entry.manifest, absFilePath);
    }
  }

  noteFileMoved(fromAbs: string, toAbs: string): void {
    for (const entry of this.entries.values()) {
      const rootAbs = entry.manifest.root;
      if (this.isUnderRoot(fromAbs, rootAbs)) applyFileDelete(entry.manifest, fromAbs);
      if (this.isUnderRoot(toAbs, rootAbs)) applyFileUpsert(entry.manifest, toAbs);
    }
  }

  private isUnderRoot(absPath: string, rootAbs: string): boolean {
    const resolvedRoot = path.resolve(rootAbs);
    const resolvedPath = path.resolve(absPath);
    if (resolvedPath === resolvedRoot) return false;
    const rel = path.relative(resolvedRoot, resolvedPath);
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  }

  private buildEntry(rootAbs: string): ManifestEntry {
    const t = Date.now();
    const manifest = buildWorkspaceManifest({
      root: rootAbs,
      ...(this.options.build ?? {}),
    });
    return { manifest, builtAt: t, buildMs: Date.now() - t };
  }
}

export const workspaceManifestService = new WorkspaceManifestService();
