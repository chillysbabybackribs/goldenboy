import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { chunkFile, estimateTokens, languageForPath } from './FileChunker';
import { CachedFileChunk, CachedFileRecord, FileCacheAnswer, FileCacheStats, FileSearchResult } from './FileCacheTypes';

type CacheFile = {
  files: CachedFileRecord[];
  chunks: CachedFileChunk[];
  indexedAt: number | null;
};

const CACHE_FILE = 'file-knowledge-cache.json';
const MAX_FILE_BYTES = 500_000;
const MAX_FILES = 2000;
const MAX_SNIPPET_CHARS = 360;
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

  indexWorkspace(root: string = process.cwd(), input?: { limit?: number }): { indexedFiles: number; chunkCount: number; skippedFiles: number; indexedAt: number } {
    const indexedAt = Date.now();
    const filePaths = walkIndexableFiles(root, input?.limit || MAX_FILES);
    this.files.clear();
    this.chunks.clear();
    let skippedFiles = 0;

    for (const filePath of filePaths) {
      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
          skippedFiles++;
          continue;
        }
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
          chunkIds: chunks.map(chunk => chunk.id),
          indexedAt,
        };
        this.files.set(fileId, record);
        for (const chunk of chunks) this.chunks.set(chunk.id, chunk);
      } catch {
        skippedFiles++;
      }
    }

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

    const limit = Math.min(input?.limit || 10, 50);
    const results = Array.from(this.chunks.values())
      .filter(chunk => !input?.pathPrefix || chunk.relativePath.startsWith(input.pathPrefix))
      .filter(chunk => !input?.language || chunk.language === input.language)
      .map(chunk => {
        const haystack = `${chunk.relativePath}\n${chunk.text}`.toLowerCase();
        let score = 0;
        for (const term of terms) {
          const matches = haystack.split(term).length - 1;
          score += matches;
          if (chunk.relativePath.toLowerCase().includes(term)) score += 4;
        }
        return { chunk, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(item => ({
        chunkId: item.chunk.id,
        fileId: item.chunk.fileId,
        path: item.chunk.path,
        relativePath: item.chunk.relativePath,
        language: item.chunk.language,
        startLine: item.chunk.startLine,
        endLine: item.chunk.endLine,
        snippet: makeSnippet(item.chunk.text, terms),
        score: item.score,
        tokenEstimate: item.chunk.tokenEstimate,
      }));

    if (results.length > 0) this.searchHitCount++;
    else this.searchMissCount++;
    return results;
  }

  answerFromCache(query: string, input?: { pathPrefix?: string; language?: string; limit?: number }): FileCacheAnswer {
    const sources = this.search(query, { ...input, limit: input?.limit || 5 });
    const chunks = sources
      .map(source => this.chunks.get(source.chunkId))
      .filter((chunk): chunk is CachedFileChunk => Boolean(chunk));
    const excerpts = chunks.map(chunk => (
      `### ${chunk.relativePath}:${chunk.startLine}\n${chunk.text.slice(0, 1200)}`
    ));
    const answer = excerpts.length > 0
      ? excerpts.join('\n\n')
      : 'No cached file chunks matched the query. Use filesystem.search or filesystem.read as a fallback.';
    return {
      query,
      answer,
      sources,
      tokenEstimate: estimateTokens(answer),
    };
  }

  readChunk(chunkId: string, maxChars = 3000): CachedFileChunk | null {
    const chunk = this.chunks.get(chunkId);
    if (!chunk) return null;
    this.chunkReadCount++;
    return {
      ...chunk,
      text: chunk.text.length > maxChars ? `${chunk.text.slice(0, maxChars)}\n...[file chunk truncated]` : chunk.text,
    };
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
      chunks: Array.from(this.chunks.values()),
      indexedAt: this.indexedAt,
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
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
      if (!INDEX_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      files.push(fullPath);
      if (files.length >= limit) break;
    }
  }
  return files;
}

function makeSnippet(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  const positions = terms.map(term => lower.indexOf(term)).filter(index => index >= 0);
  const first = positions.length > 0 ? Math.min(...positions) : 0;
  const start = Math.max(0, first - 120);
  const snippet = text.slice(start, start + MAX_SNIPPET_CHARS).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '...' : ''}${snippet}${start + MAX_SNIPPET_CHARS < text.length ? '...' : ''}`;
}

export const fileKnowledgeStore = new FileKnowledgeStore();
