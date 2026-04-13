import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { app } from 'electron';
import { chunkFile, estimateTokens, languageForPath } from './FileChunker';
import { CachedFileChunk, CachedFileRecord, FileCacheAnswer, FileCacheStats, FileSearchResult } from './FileCacheTypes';
import { APP_WORKSPACE_ROOT } from '../workspaceRoot';

type CacheFile = {
  files: CachedFileRecord[];
  chunks: CachedFileChunk[];
  indexedAt: number | null;
};

type ReadWindowResult = {
  path: string;
  relativePath: string;
  content: string;
  truncated: boolean;
  startLine: number;
  endLine: number;
  totalLines: number;
  chunkCount: number;
};

const CACHE_FILE = 'file-knowledge-cache.json';
const MAX_FILE_BYTES = 500_000;
const MAX_FILES = 2000;
const MAX_SNIPPET_CHARS = 360;
const MAX_RG_BUFFER = 8 * 1024 * 1024;
const MAX_RG_ARG_CHARS = 12_000;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.next', 'coverage', '.cache']);
const INDEX_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.css', '.html', '.yml', '.yaml', '.txt',
]);

function cachePath(): string {
  return path.join(app.getPath('userData'), CACHE_FILE);
}

function hash(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 16);
}

function normalizeQuery(query: string): string[] {
  return query.toLowerCase().split(/[^a-z0-9_.$/-]+/).filter(token => token.length >= 2);
}

function fileIdFor(relativePath: string, contentHash: string): string {
  return `file_${hash(`${relativePath}:${contentHash}`)}`;
}

function normalizePathKey(filePath: string): string {
  return path.resolve(filePath);
}

function isIndexableFile(filePath: string): boolean {
  return INDEX_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function clampReadChars(maxChars: number): number {
  return Math.max(200, Math.min(Math.floor(maxChars), 20_000));
}

function makeSnippetFromLine(lineText: string, terms: string[]): string {
  const lower = lineText.toLowerCase();
  const positions = terms.map(term => lower.indexOf(term)).filter(index => index >= 0);
  const first = positions.length > 0 ? Math.min(...positions) : 0;
  const start = Math.max(0, first - 120);
  const snippet = lineText.slice(start, start + MAX_SNIPPET_CHARS).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '...' : ''}${snippet}${start + MAX_SNIPPET_CHARS < lineText.length ? '...' : ''}`;
}

function trimContent(content: string, maxChars: number): { content: string; truncated: boolean } {
  if (content.length <= maxChars) return { content, truncated: false };
  return {
    content: `${content.slice(0, maxChars)}\n...[file truncated]`,
    truncated: true,
  };
}

function readLinesFromDisk(filePath: string, startLine: number, endLine: number, maxChars: number): {
  content: string;
  truncated: boolean;
  totalLines: number;
} {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n');
  const normalizedStart = Math.min(Math.max(startLine, 1), Math.max(lines.length, 1));
  const normalizedEnd = Math.min(Math.max(endLine, normalizedStart), lines.length);
  const text = lines.slice(normalizedStart - 1, normalizedEnd).join('\n');
  const trimmed = trimContent(text, maxChars);
  return {
    content: trimmed.content,
    truncated: trimmed.truncated,
    totalLines: lines.length,
  };
}

export class FileKnowledgeStore {
  private files = new Map<string, CachedFileRecord>();
  private chunks = new Map<string, CachedFileChunk>();
  private indexedAt: number | null = null;
  private searchCount = 0;
  private searchHitCount = 0;
  private searchMissCount = 0;
  private chunkReadCount = 0;

  constructor() {
    this.load();
  }

  indexWorkspace(root: string = APP_WORKSPACE_ROOT, input?: { limit?: number }): { indexedFiles: number; chunkCount: number; skippedFiles: number; indexedAt: number } {
    const indexedAt = Date.now();
    const filePaths = walkIndexableFiles(root, input?.limit || MAX_FILES);
    const nextFiles = new Map<string, CachedFileRecord>();
    const nextChunks = new Map<string, CachedFileChunk>();
    const existingByPath = new Map<string, CachedFileRecord>(
      Array.from(this.files.values()).map(record => [normalizePathKey(record.path), record]),
    );
    let skippedFiles = 0;

    for (const filePath of filePaths) {
      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
          skippedFiles++;
          continue;
        }
        const relativePath = path.relative(root, filePath);
        const existing = existingByPath.get(normalizePathKey(filePath));
        if (
          existing
          && existing.relativePath === relativePath
          && existing.sizeBytes === stat.size
          && existing.mtimeMs === stat.mtimeMs
        ) {
          const reused = this.cloneExistingRecord(existing, {
            path: filePath,
            relativePath,
            indexedAt,
          });
          if (reused) {
            nextFiles.set(reused.record.id, reused.record);
            for (const chunk of reused.chunks) nextChunks.set(chunk.id, chunk);
            continue;
          }
        }

        const built = this.buildRecord(filePath, root, stat, indexedAt);
        if (!built) {
          skippedFiles++;
          continue;
        }
        nextFiles.set(built.record.id, built.record);
        for (const chunk of built.chunks) nextChunks.set(chunk.id, chunk);
      } catch {
        skippedFiles++;
      }
    }

    this.files = nextFiles;
    this.chunks = nextChunks;
    this.indexedAt = indexedAt;
    this.save();
    return {
      indexedFiles: this.files.size,
      chunkCount: this.chunks.size,
      skippedFiles,
      indexedAt,
    };
  }

  listFiles(input?: { limit?: number }): CachedFileRecord[] {
    return Array.from(this.files.values())
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
      .slice(0, input?.limit || 200)
      .map(file => ({ ...file }));
  }

  search(query: string, input?: { pathPrefix?: string; language?: string; limit?: number }): FileSearchResult[] {
    this.searchCount++;
    const terms = normalizeQuery(query);
    if (terms.length === 0) {
      this.searchMissCount++;
      return [];
    }

    const candidates = Array.from(this.files.values())
      .filter(record => !input?.pathPrefix || record.relativePath.startsWith(input.pathPrefix))
      .filter(record => !input?.language || record.language === input.language);
    if (candidates.length === 0) {
      this.searchMissCount++;
      return [];
    }

    const matches = this.runSearch(terms, candidates.map(record => record.path));
    const candidateMap = new Map<string, CachedFileRecord>(
      candidates.map(record => [normalizePathKey(record.path), record]),
    );
    const byChunk = new Map<string, FileSearchResult>();

    for (const match of matches) {
      const current = candidateMap.get(normalizePathKey(match.path));
      const record = current || this.refreshFile(match.path)?.record || null;
      if (!record) continue;
      if (!candidateMap.has(normalizePathKey(record.path))) continue;
      const chunk = this.findChunkForLine(record, match.lineNumber);
      if (!chunk) continue;
      const score = this.scoreMatch(record, match.lineText, terms);
      const existing = byChunk.get(chunk.id);
      const snippet = makeSnippetFromLine(match.lineText, terms);
      const next: FileSearchResult = {
        chunkId: chunk.id,
        fileId: record.id,
        path: record.path,
        relativePath: record.relativePath,
        language: record.language,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        snippet,
        score,
        tokenEstimate: Math.min(chunk.tokenEstimate, estimateTokens(snippet)),
      };
      if (!existing || next.score > existing.score) {
        byChunk.set(chunk.id, next);
      }
    }

    const limit = Math.min(input?.limit || 10, 50);
    const results = Array.from(byChunk.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (results.length > 0) this.searchHitCount++;
    else this.searchMissCount++;
    return results;
  }

  answerFromCache(query: string, input?: { pathPrefix?: string; language?: string; limit?: number }): FileCacheAnswer {
    const sources = this.search(query, { ...input, limit: input?.limit || 5 });
    const excerpts = sources
      .map(source => this.readChunk(source.chunkId, 1200))
      .filter((chunk): chunk is CachedFileChunk => Boolean(chunk))
      .map(chunk => `### ${chunk.relativePath}:${chunk.startLine}\n${chunk.text || ''}`);
    const answer = excerpts.length > 0
      ? excerpts.join('\n\n')
      : 'No indexed file matches were found. Use filesystem.search or filesystem.read as a fallback.';
    return {
      query,
      answer,
      sources,
      tokenEstimate: estimateTokens(answer),
    };
  }

  readChunk(chunkId: string, maxChars = 3000): CachedFileChunk | null {
    const chunk = this.resolveFreshChunk(chunkId);
    if (!chunk) return null;
    this.chunkReadCount++;
    const window = readLinesFromDisk(chunk.path, chunk.startLine, chunk.endLine, clampReadChars(maxChars));
    return {
      ...chunk,
      text: window.content,
      tokenEstimate: estimateTokens(window.content),
    };
  }

  readWindowForPath(filePath: string, input?: { startLine?: number; endLine?: number; maxChars?: number }): ReadWindowResult | null {
    const record = this.findFreshRecordByPath(filePath) || this.refreshFile(filePath)?.record || null;
    if (!record) return null;

    const maxChars = clampReadChars(input?.maxChars ?? 6_000);
    const startLine = Math.max(input?.startLine || 1, 1);
    const selectedChunks = this.selectChunksForWindow(record, {
      startLine,
      endLine: input?.endLine,
      maxChars,
    });
    if (selectedChunks.length === 0) return null;

    const rangeStart = input?.startLine || selectedChunks[0].startLine;
    const rangeEnd = input?.endLine || selectedChunks[selectedChunks.length - 1].endLine;
    const window = readLinesFromDisk(record.path, rangeStart, rangeEnd, maxChars);
    return {
      path: record.path,
      relativePath: record.relativePath,
      content: window.content,
      truncated: window.truncated,
      startLine: rangeStart,
      endLine: rangeEnd,
      totalLines: window.totalLines,
      chunkCount: selectedChunks.length,
    };
  }

  getFreshChunksForPath(filePath: string): CachedFileChunk[] | null {
    const record = this.findFreshRecordByPath(filePath) || this.refreshFile(filePath)?.record || null;
    if (!record) return null;
    const chunks = record.chunkIds
      .map(chunkId => this.chunks.get(chunkId))
      .filter((chunk): chunk is CachedFileChunk => Boolean(chunk));
    if (chunks.length !== record.chunkIds.length) return null;
    return chunks.map(chunk => ({ ...chunk }));
  }

  refreshFile(filePath: string, root: string = APP_WORKSPACE_ROOT): { record: CachedFileRecord; chunks: CachedFileChunk[]; reused: boolean } | null {
    const normalizedPath = normalizePathKey(filePath);
    const existing = this.findRecordByPath(normalizedPath);
    try {
      const stat = fs.statSync(normalizedPath);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES || !isIndexableFile(normalizedPath)) {
        this.removeFile(normalizedPath);
        return null;
      }

      const relativePath = path.relative(root, normalizedPath);
      if (
        existing
        && existing.relativePath === relativePath
        && existing.sizeBytes === stat.size
        && existing.mtimeMs === stat.mtimeMs
      ) {
        const reused = this.cloneExistingRecord(existing, {
          path: normalizedPath,
          relativePath,
          indexedAt: Date.now(),
        });
        if (reused) {
          this.replaceRecord(normalizedPath, reused.record, reused.chunks);
          return {
            record: { ...reused.record },
            chunks: reused.chunks.map(chunk => ({ ...chunk })),
            reused: true,
          };
        }
      }

      const built = this.buildRecord(normalizedPath, root, stat, Date.now());
      if (!built) {
        this.removeFile(normalizedPath);
        return null;
      }
      this.replaceRecord(normalizedPath, built.record, built.chunks);
      return {
        record: { ...built.record },
        chunks: built.chunks.map(chunk => ({ ...chunk })),
        reused: false,
      };
    } catch {
      this.removeFile(normalizedPath);
      return null;
    }
  }

  removeFile(filePath: string): boolean {
    const existing = this.findRecordByPath(filePath);
    if (!existing) return false;
    this.deleteRecord(existing);
    this.save();
    return true;
  }

  removePathTree(filePath: string): number {
    const normalizedPath = normalizePathKey(filePath);
    const prefix = `${normalizedPath}${path.sep}`;
    const matches = Array.from(this.files.values())
      .filter((record) => {
        const recordPath = normalizePathKey(record.path);
        return recordPath === normalizedPath || recordPath.startsWith(prefix);
      });
    if (matches.length === 0) return 0;
    for (const record of matches) {
      this.deleteRecord(record);
    }
    this.save();
    return matches.length;
  }

  getStats(): FileCacheStats {
    const chunks = Array.from(this.chunks.values());
    return {
      fileCount: this.files.size,
      chunkCount: this.chunks.size,
      totalTokenEstimate: chunks.reduce((sum, chunk) => sum + chunk.tokenEstimate, 0),
      indexedAt: this.indexedAt,
      searchCount: this.searchCount,
      searchHitCount: this.searchHitCount,
      searchMissCount: this.searchMissCount,
      chunkReadCount: this.chunkReadCount,
    };
  }

  private load(): void {
    try {
      const filePath = cachePath();
      if (!fs.existsSync(filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CacheFile;
      this.indexedAt = parsed.indexedAt || null;
      for (const file of parsed.files || []) this.files.set(file.id, file);
      for (const chunk of parsed.chunks || []) this.chunks.set(chunk.id, chunk);
    } catch {
      this.files.clear();
      this.chunks.clear();
      this.indexedAt = null;
    }
  }

  private save(): void {
    const filePath = cachePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const payload: CacheFile = {
      files: Array.from(this.files.values()),
      chunks: Array.from(this.chunks.values()).map(chunk => {
        const { text: _text, ...rest } = chunk;
        return rest;
      }),
      indexedAt: this.indexedAt,
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  }

  private buildRecord(
    filePath: string,
    root: string,
    stat: fs.Stats,
    indexedAt: number,
  ): { record: CachedFileRecord; chunks: CachedFileChunk[] } | null {
    if (!isIndexableFile(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    const contentHash = hash(content);
    const relativePath = path.relative(root, filePath);
    const fileId = fileIdFor(relativePath, contentHash);
    const language = languageForPath(filePath);
    const chunks = chunkFile({
      fileId,
      path: filePath,
      relativePath,
      language,
      content,
      contentHash,
      indexedAt,
    });
    const record: CachedFileRecord = {
      id: fileId,
      path: filePath,
      relativePath,
      language,
      contentHash,
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs,
      chunkIds: chunks.map(chunk => chunk.id),
      indexedAt,
    };
    return { record, chunks };
  }

  private cloneExistingRecord(
    existing: CachedFileRecord,
    input: { path: string; relativePath: string; indexedAt: number },
  ): { record: CachedFileRecord; chunks: CachedFileChunk[] } | null {
    const chunks = existing.chunkIds
      .map(chunkId => this.chunks.get(chunkId))
      .filter((chunk): chunk is CachedFileChunk => Boolean(chunk))
      .map(chunk => ({
        ...chunk,
        path: input.path,
        relativePath: input.relativePath,
        indexedAt: input.indexedAt,
      }));
    if (chunks.length !== existing.chunkIds.length) return null;
    return {
      record: {
        ...existing,
        path: input.path,
        relativePath: input.relativePath,
        indexedAt: input.indexedAt,
      },
      chunks,
    };
  }

  private replaceRecord(filePath: string, record: CachedFileRecord, chunks: CachedFileChunk[]): void {
    const existing = this.findRecordByPath(filePath);
    if (existing) this.deleteRecord(existing);
    this.files.set(record.id, record);
    for (const chunk of chunks) this.chunks.set(chunk.id, chunk);
    this.indexedAt = Date.now();
    this.save();
  }

  private deleteRecord(record: CachedFileRecord): void {
    this.files.delete(record.id);
    for (const chunkId of record.chunkIds) this.chunks.delete(chunkId);
  }

  private findRecordByPath(filePath: string): CachedFileRecord | null {
    const normalizedPath = normalizePathKey(filePath);
    for (const record of this.files.values()) {
      if (normalizePathKey(record.path) === normalizedPath) return record;
    }
    return null;
  }

  private findFreshRecordByPath(filePath: string): CachedFileRecord | null {
    const record = this.findRecordByPath(filePath);
    if (!record) return null;
    try {
      const stat = fs.statSync(normalizePathKey(filePath));
      if (!stat.isFile()) return null;
      return stat.size === record.sizeBytes && stat.mtimeMs === record.mtimeMs
        ? record
        : null;
    } catch {
      return null;
    }
  }

  private resolveFreshChunk(chunkId: string): CachedFileChunk | null {
    const chunk = this.chunks.get(chunkId);
    if (!chunk) return null;
    const record = this.findFreshRecordByPath(chunk.path) || this.refreshFile(chunk.path)?.record || null;
    if (!record) return null;
    const freshChunk = this.findChunkByOrdinal(record, chunk.ordinal);
    return freshChunk ? { ...freshChunk } : null;
  }

  private findChunkForLine(record: CachedFileRecord, lineNumber: number): CachedFileChunk | null {
    for (const chunkId of record.chunkIds) {
      const chunk = this.chunks.get(chunkId);
      if (chunk && lineNumber >= chunk.startLine && lineNumber <= chunk.endLine) {
        return chunk;
      }
    }
    return null;
  }

  private findChunkByOrdinal(record: CachedFileRecord, ordinal: number): CachedFileChunk | null {
    for (const chunkId of record.chunkIds) {
      const chunk = this.chunks.get(chunkId);
      if (chunk && chunk.ordinal === ordinal) return chunk;
    }
    return null;
  }

  private selectChunksForWindow(
    record: CachedFileRecord,
    input: { startLine: number; endLine?: number; maxChars: number },
  ): CachedFileChunk[] {
    const selected: CachedFileChunk[] = [];
    let accumulatedChars = 0;
    for (const chunkId of record.chunkIds) {
      const chunk = this.chunks.get(chunkId);
      if (!chunk) continue;
      if (chunk.endLine < input.startLine) continue;
      selected.push(chunk);
      accumulatedChars += chunk.charCount;
      if (input.endLine && chunk.endLine >= input.endLine) break;
      if (!input.endLine && accumulatedChars >= input.maxChars) break;
    }
    return selected;
  }

  private scoreMatch(record: CachedFileRecord, lineText: string, terms: string[]): number {
    const haystack = lineText.toLowerCase();
    let score = 0;
    for (const term of terms) {
      const matches = haystack.split(term).length - 1;
      score += matches;
      if (record.relativePath.toLowerCase().includes(term)) score += 4;
    }
    return score;
  }

  private runSearch(terms: string[], candidatePaths: string[]): Array<{ path: string; lineNumber: number; lineText: string }> {
    try {
      return this.runRipgrep(terms, candidatePaths);
    } catch {
      return this.fallbackSearchCandidates(terms, candidatePaths);
    }
  }

  private runRipgrep(terms: string[], candidatePaths: string[]): Array<{ path: string; lineNumber: number; lineText: string }> {
    if (candidatePaths.length === 0) return [];
    const matches: Array<{ path: string; lineNumber: number; lineText: string }> = [];
    for (const batch of chunkPathsForArgBudget(candidatePaths, MAX_RG_ARG_CHARS)) {
      const searchArgs = batch.map(filePath => toSearchArg(filePath));
      const args = [
        '--json',
        '--line-number',
        '--ignore-case',
        '--fixed-strings',
        '--color',
        'never',
        ...terms.flatMap(term => ['-e', term]),
        ...searchArgs,
      ];
      const result = spawnSync('rg', args, {
        cwd: APP_WORKSPACE_ROOT,
        encoding: 'utf-8',
        maxBuffer: MAX_RG_BUFFER,
      });
      if (result.error) {
        const code = (result.error as NodeJS.ErrnoException).code;
        if (code === 'E2BIG') {
          throw result.error;
        }
        continue;
      }
      if (result.status !== 0 && result.status !== 1) continue;
      const lines = (result.stdout || '').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as {
            type?: string;
            data?: {
              path?: { text?: string };
              line_number?: number;
              lines?: { text?: string };
            };
          };
          if (parsed.type !== 'match') continue;
          const filePath = parsed.data?.path?.text;
          const lineNumber = parsed.data?.line_number;
          const lineText = parsed.data?.lines?.text;
          if (!filePath || typeof lineNumber !== 'number' || typeof lineText !== 'string') continue;
          matches.push({
            path: path.resolve(filePath),
            lineNumber,
            lineText: lineText.replace(/\n$/, ''),
          });
        } catch {
          // Ignore malformed rg lines.
        }
      }
    }
    return matches;
  }

  private fallbackSearchCandidates(terms: string[], candidatePaths: string[]): Array<{ path: string; lineNumber: number; lineText: string }> {
    const matches: Array<{ path: string; lineNumber: number; lineText: string }> = [];
    for (const filePath of candidatePaths) {
      try {
        const text = fs.readFileSync(filePath, 'utf-8');
        const lines = text.split('\n');
        for (let index = 0; index < lines.length; index++) {
          const lineText = lines[index];
          const lower = lineText.toLowerCase();
          if (terms.every(term => lower.includes(term)) || terms.some(term => lower.includes(term))) {
            matches.push({
              path: filePath,
              lineNumber: index + 1,
              lineText,
            });
          }
        }
      } catch {
        // Ignore unreadable files and continue.
      }
    }
    return matches;
  }
}

function walkIndexableFiles(root: string, limit: number): string[] {
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0 && files.length < limit) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!isIndexableFile(fullPath)) continue;
      files.push(fullPath);
      if (files.length >= limit) break;
    }
  }
  return files;
}

function chunkPathsForArgBudget(items: string[], maxArgChars: number): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  let currentChars = 0;
  for (const item of items) {
    const nextArg = toSearchArg(item);
    if (current.length > 0 && currentChars + nextArg.length > maxArgChars) {
      out.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(item);
    currentChars += nextArg.length;
  }
  if (current.length > 0) {
    out.push(current);
  }
  return out;
}

function toSearchArg(filePath: string): string {
  const relative = path.relative(APP_WORKSPACE_ROOT, filePath);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative;
  }
  return filePath;
}

export const fileKnowledgeStore = new FileKnowledgeStore();
