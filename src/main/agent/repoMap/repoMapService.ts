import * as path from 'path';
import {
  applyMutations,
  buildRepoMap,
  type FileMutation,
  type MutationOutcome,
  type RepoFile,
  type RepoMap,
  type RepoSymbol,
} from './buildRepoMap';

export interface RepoMapEntry {
  map: RepoMap;
  builtAt: number;
  buildMs: number;
}

export interface RepoMapServiceOptions {
  /** Treat maps older than this as stale on next access. 0 disables TTL. Default: 0 (refresh on demand only). */
  ttlMs?: number;
  /** Subdirectories under the root to include. If omitted, scans the whole root. */
  includeDirs?: string[];
}

/**
 * In-memory cache of repo maps keyed by absolute root path.
 *
 * Lazy: nothing happens until a tool asks for a slice. Kept in memory across
 * tool calls so repeated slicing is cheap (sub-ms). Invalidated on explicit
 * refresh or (optionally) by TTL.
 */
export class RepoMapService {
  private entries = new Map<string, RepoMapEntry>();
  private inflight = new Map<string, Promise<RepoMapEntry>>();

  constructor(private readonly options: RepoMapServiceOptions = {}) {}

  async getMap(rootAbs: string): Promise<RepoMapEntry> {
    const key = path.resolve(rootAbs);
    const existing = this.entries.get(key);
    if (existing && !this.isStale(existing)) return existing;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const promise = this.buildEntry(key);
    this.inflight.set(key, promise);
    try {
      const entry = await promise;
      this.entries.set(key, entry);
      return entry;
    } finally {
      this.inflight.delete(key);
    }
  }

  async refresh(rootAbs: string): Promise<RepoMapEntry> {
    const key = path.resolve(rootAbs);
    this.entries.delete(key);
    return this.getMap(key);
  }

  clear(): void {
    this.entries.clear();
  }

  /**
   * Incrementally update cached maps for a file that was created or modified.
   * Reparses only the affected file and refreshes graph + PageRank. Cheap
   * enough to call on every filesystem.write/patch.
   */
  noteFileChanged(absFilePath: string): MutationOutcome[] {
    return this.applyToMatchingMaps(absFilePath, [
      { kind: 'upsert', absPath: absFilePath },
    ]);
  }

  /** Incrementally update cached maps for a file that was deleted. */
  noteFileDeleted(absFilePath: string): MutationOutcome[] {
    return this.applyToMatchingMaps(absFilePath, [
      { kind: 'delete', absPath: absFilePath },
    ]);
  }

  /**
   * Incrementally update cached maps for a move/rename. Applies delete(from)
   * and upsert(to); if either path falls outside a cached root it's ignored
   * for that map.
   */
  noteFileMoved(fromAbs: string, toAbs: string): MutationOutcome[] {
    const outcomes: MutationOutcome[] = [];
    for (const [rootKey, entry] of this.entries) {
      const mutations: FileMutation[] = [];
      if (this.isUnderRoot(fromAbs, rootKey)) mutations.push({ kind: 'delete', absPath: fromAbs });
      if (this.isUnderRoot(toAbs, rootKey)) mutations.push({ kind: 'upsert', absPath: toAbs });
      if (mutations.length === 0) continue;
      outcomes.push(applyMutations(entry.map, mutations));
    }
    return outcomes;
  }

  private applyToMatchingMaps(
    absFilePath: string,
    mutations: FileMutation[],
  ): MutationOutcome[] {
    const outcomes: MutationOutcome[] = [];
    for (const [rootKey, entry] of this.entries) {
      if (!this.isUnderRoot(absFilePath, rootKey)) continue;
      outcomes.push(applyMutations(entry.map, mutations));
    }
    return outcomes;
  }

  private isUnderRoot(absFilePath: string, rootAbs: string): boolean {
    const resolvedRoot = path.resolve(rootAbs);
    const resolvedPath = path.resolve(absFilePath);
    if (resolvedPath === resolvedRoot) return false;
    const rel = path.relative(resolvedRoot, resolvedPath);
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  }

  private async buildEntry(rootAbs: string): Promise<RepoMapEntry> {
    const t = Date.now();
    const map = buildRepoMap({ root: rootAbs });
    const buildMs = Date.now() - t;
    return { map, builtAt: t, buildMs };
  }

  private isStale(entry: RepoMapEntry): boolean {
    const ttl = this.options.ttlMs ?? 0;
    if (ttl <= 0) return false;
    return Date.now() - entry.builtAt > ttl;
  }
}

export const repoMapService = new RepoMapService();

export interface SymbolMatch {
  file: string;
  line: number;
  name: string;
  kind: RepoSymbol['kind'];
  signature: string;
  doc?: string;
  fileRank: number;
}

export interface FindSymbolOptions {
  name: string;
  kind?: RepoSymbol['kind'];
  exact?: boolean;
  limit?: number;
  pathPrefix?: string;
}

export function findSymbolsInMap(map: RepoMap, options: FindSymbolOptions): SymbolMatch[] {
  const { name, kind, exact = false, limit = 20, pathPrefix } = options;
  const needle = name.toLowerCase();
  const matches: SymbolMatch[] = [];
  for (const file of map.files) {
    if (pathPrefix && !file.path.startsWith(pathPrefix)) continue;
    for (const sym of file.symbols) {
      if (kind && sym.kind !== kind) continue;
      const n = sym.name.toLowerCase();
      const hit = exact ? n === needle : n.includes(needle);
      if (!hit) continue;
      matches.push({
        file: file.path,
        line: sym.line,
        name: sym.name,
        kind: sym.kind,
        signature: sym.signature,
        doc: sym.doc,
        fileRank: file.score,
      });
    }
  }
  matches.sort((a, b) => {
    const aExact = a.name.toLowerCase() === needle;
    const bExact = b.name.toLowerCase() === needle;
    if (aExact !== bExact) return aExact ? -1 : 1;
    return b.fileRank - a.fileRank;
  });
  return matches.slice(0, limit);
}

export interface NeighborSlice {
  path: string;
  depth: number;
  direction: 'in' | 'out' | 'root';
  rank: number;
  lines: number;
}

export interface NeighborOptions {
  direction?: 'in' | 'out' | 'both';
  depth?: number;
  limit?: number;
}

export function neighborsOfFile(
  map: RepoMap,
  filePath: string,
  options: NeighborOptions = {},
): { root: RepoFile | null; neighbors: NeighborSlice[] } {
  const { direction = 'both', depth = 1, limit = 60 } = options;
  const byPath = new Map(map.files.map((f) => [f.path, f]));
  const root = byPath.get(filePath) ?? null;
  if (!root) return { root: null, neighbors: [] };

  const visited = new Map<string, NeighborSlice>();
  visited.set(root.path, {
    path: root.path,
    depth: 0,
    direction: 'root',
    rank: root.score,
    lines: root.lines,
  });

  const frontier: Array<{ path: string; depth: number; direction: 'in' | 'out' }> = [];
  if (direction === 'out' || direction === 'both') {
    for (const dep of root.imports) frontier.push({ path: dep, depth: 1, direction: 'out' });
  }
  if (direction === 'in' || direction === 'both') {
    for (const user of root.importedBy) frontier.push({ path: user, depth: 1, direction: 'in' });
  }

  while (frontier.length > 0) {
    const node = frontier.shift()!;
    if (visited.has(node.path)) continue;
    const file = byPath.get(node.path);
    if (!file) continue;
    visited.set(node.path, {
      path: file.path,
      depth: node.depth,
      direction: node.direction,
      rank: file.score,
      lines: file.lines,
    });
    if (node.depth >= depth) continue;
    if (node.direction === 'out') {
      for (const dep of file.imports) {
        if (!visited.has(dep)) frontier.push({ path: dep, depth: node.depth + 1, direction: 'out' });
      }
    } else {
      for (const user of file.importedBy) {
        if (!visited.has(user)) frontier.push({ path: user, depth: node.depth + 1, direction: 'in' });
      }
    }
  }

  const neighbors = Array.from(visited.values())
    .filter((n) => n.direction !== 'root')
    .sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      return b.rank - a.rank;
    })
    .slice(0, limit);
  return { root, neighbors };
}

export function describeFileInMap(map: RepoMap, filePath: string): RepoFile | null {
  return map.files.find((f) => f.path === filePath) ?? null;
}
