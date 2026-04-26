import { AgentToolDefinition } from '../../AgentTypes';
import * as fs from 'fs';
import * as path from 'path';
import { agentCache } from '../../AgentCache';
import { fileKnowledgeStore } from '../../../fileKnowledge/FileKnowledgeStore';
import { appStateStore } from '../../../state/appStateStore';
import { ActionType } from '../../../state/actions';
import { generateId } from '../../../../shared/utils/ids';
import { APP_WORKSPACE_ROOT } from '../../../workspaceRoot';
import { repoMapService } from '../../repoMap';
import { workspaceManifestService } from '../../workspaceManifest';

const DEFAULT_FILE_READ_MAX_CHARS = 6_000;
const MAX_FILE_READ_MAX_CHARS = 20_000;

function objectInput(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Expected non-empty string input: ${key}`);
  }
  return value;
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function optionalNumber(input: Record<string, unknown>, key: string, fallback: number): number {
  const value = input[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optionalPositiveInteger(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function resolveLocalPath(rawPath: string): string {
  return path.resolve(APP_WORKSPACE_ROOT, rawPath);
}

function logFileCache(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
  appStateStore.dispatch({
    type: ActionType.ADD_LOG,
    log: {
      id: generateId('log'),
      timestamp: Date.now(),
      level,
      source: 'system',
      message,
    },
  });
}

function invalidateFilesystemCaches(): void {
  agentCache.invalidateByToolPrefix('filesystem.');
}

function clampReadChars(value: number): number {
  return Math.max(200, Math.min(Math.floor(value), MAX_FILE_READ_MAX_CHARS));
}

function selectLines(lines: string[], startLine?: number, endLine?: number): {
  text: string;
  startLine: number;
  endLine: number;
  totalLines: number;
} {
  const totalLines = lines.length;
  const normalizedStart = Math.min(Math.max(startLine || 1, 1), Math.max(totalLines, 1));
  const normalizedEnd = Math.min(Math.max(endLine || totalLines, normalizedStart), totalLines);
  return {
    text: lines.slice(normalizedStart - 1, normalizedEnd).join('\n'),
    startLine: normalizedStart,
    endLine: normalizedEnd,
    totalLines,
  };
}

function trimContent(content: string, maxChars: number): { content: string; truncated: boolean } {
  if (content.length <= maxChars) return { content, truncated: false };
  return {
    content: `${content.slice(0, maxChars)}\n...[file truncated]`,
    truncated: true,
  };
}

function globToRegex(pattern: string): RegExp {
  let src = '^';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        src += '.*';
        i += 2;
        if (pattern[i] === '/') i += 1;
      } else {
        src += '[^/]*';
        i += 1;
      }
    } else if (ch === '?') {
      src += '[^/]';
      i += 1;
    } else if (ch === '{') {
      const end = pattern.indexOf('}', i);
      if (end === -1) { src += '\\{'; i += 1; continue; }
      const parts = pattern.slice(i + 1, end).split(',').map(part => part.replace(/[.+^$()|[\]\\]/g, '\\$&'));
      src += `(?:${parts.join('|')})`;
      i = end + 1;
    } else if ('.+^$()|[]\\'.includes(ch)) {
      src += `\\${ch}`;
      i += 1;
    } else {
      src += ch;
      i += 1;
    }
  }
  src += '$';
  return new RegExp(src);
}

function walkFiles(root: string, limit: number): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0 && out.length < limit) {
    const current = stack.pop()!;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else {
        out.push(fullPath);
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}

export function createFilesystemToolDefinitions(): AgentToolDefinition[] {
  return [
    {
      name: 'filesystem.list',
      description: 'List files and directories under a local path.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      async execute(input) {
        const target = resolveLocalPath(String(objectInput(input).path || '.'));
        const entries = fs.readdirSync(target, { withFileTypes: true }).map(entry => ({
          name: entry.name,
          path: path.join(target, entry.name),
          type: entry.isDirectory() ? 'directory' : 'file',
        }));
        return { summary: `Listed ${entries.length} entries`, data: { path: target, entries } };
      },
    },
    {
      name: 'filesystem.glob',
      description: 'Match files by glob pattern relative to a root. Supports **, *, ?, and {a,b} alternates. Returns up to limit matches sorted by path.',
      inputSchema: {
        type: 'object',
        required: ['pattern'],
        properties: {
          pattern: { type: 'string' },
          path: { type: 'string' },
          limit: { type: 'number' },
        },
      },
      async execute(input) {
        const obj = objectInput(input);
        const pattern = requireString(obj, 'pattern');
        const root = resolveLocalPath(String(obj.path || '.'));
        const limit = Math.max(1, Math.min(optionalNumber(obj, 'limit', 200), 2000));
        const regex = globToRegex(pattern);
        const matches: string[] = [];
        for (const file of walkFiles(root, limit * 20)) {
          const rel = path.relative(root, file).split(path.sep).join('/');
          if (regex.test(rel)) {
            matches.push(file);
            if (matches.length >= limit) break;
          }
        }
        matches.sort();
        return { summary: `Matched ${matches.length} files for ${pattern}`, data: { root, pattern, matches } };
      },
    },
    {
      name: 'filesystem.search',
      description: 'Fallback path+text search under a local path. Prefer filesystem.search_file_cache for indexed source lookup.',
      inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, path: { type: 'string' }, limit: { type: 'number' } } },
      async execute(input) {
        const obj = objectInput(input);
        const query = requireString(obj, 'query').toLowerCase();
        const root = resolveLocalPath(String(obj.path || '.'));
        const limit = typeof obj.limit === 'number' ? obj.limit : 50;
        const matches: Array<{ path: string; reason: 'path' | 'content' }> = [];

        for (const file of walkFiles(root, Math.max(limit * 20, 200))) {
          const rel = path.relative(APP_WORKSPACE_ROOT, file);
          if (rel.toLowerCase().includes(query)) {
            matches.push({ path: file, reason: 'path' });
          } else {
            try {
              const text = fs.readFileSync(file, 'utf-8');
              if (text.toLowerCase().includes(query)) {
                matches.push({ path: file, reason: 'content' });
              }
            } catch {
              // Ignore binary or unreadable files.
            }
          }
          if (matches.length >= limit) break;
        }

        return { summary: `Found ${matches.length} matches`, data: { matches } };
      },
    },
    {
      name: 'filesystem.index_workspace',
      description: 'Index a local workspace into searchable file chunks. Run before file-heavy reasoning or after code changes.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          limit: { type: 'number' },
        },
      },
      async execute(input) {
        const obj = objectInput(input);
        const root = resolveLocalPath(String(obj.path || '.'));
        const limit = optionalNumber(obj, 'limit', 2000);
        const result = fileKnowledgeStore.indexWorkspace(root, { limit });
        invalidateFilesystemCaches();
        logFileCache(`Indexed ${result.indexedFiles} files into ${result.chunkCount} file chunks`);
        return {
          summary: `Indexed ${result.indexedFiles} files into ${result.chunkCount} chunks`,
          data: { root, ...result },
        };
      },
    },
    {
      name: 'filesystem.search_file_cache',
      description: 'Search indexed file chunks by query, optional path prefix, and language. mode="answer" additionally returns compact excerpts grouped by source.',
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string' },
          mode: { type: 'string', enum: ['snippets', 'answer'] },
          pathPrefix: { type: 'string' },
          language: { type: 'string' },
          limit: { type: 'number' },
        },
      },
      async execute(input) {
        const obj = objectInput(input);
        const query = requireString(obj, 'query');
        const pathPrefix = optionalString(obj, 'pathPrefix');
        const language = optionalString(obj, 'language');
        const mode = typeof obj.mode === 'string' ? obj.mode : 'snippets';
        if (mode === 'answer') {
          const answer = fileKnowledgeStore.answerFromCache(query, {
            pathPrefix,
            language,
            limit: optionalNumber(obj, 'limit', 5),
          });
          logFileCache(
            `File cache answer ${answer.sources.length > 0 ? 'hit' : 'miss'} for "${query}" (${answer.sources.length} sources)`,
            answer.sources.length > 0 ? 'info' : 'warn',
          );
          return {
            summary: `Found ${answer.sources.length} cached file sources`,
            data: answer,
          };
        }
        const results = fileKnowledgeStore.search(query, {
          pathPrefix,
          language,
          limit: optionalNumber(obj, 'limit', 10),
        });
        logFileCache(
          `File cache search ${results.length > 0 ? 'hit' : 'miss'} for "${query}" (${results.length} matches)`,
          results.length > 0 ? 'info' : 'warn',
        );
        return {
          summary: `Found ${results.length} cached file chunks`,
          data: { query, results },
        };
      },
    },
    {
      name: 'filesystem.read_file_chunk',
      description: 'Read one indexed file chunk by id. Use after filesystem.search_file_cache to avoid whole-file reads.',
      inputSchema: {
        type: 'object',
        properties: {
          chunkId: { type: 'string' },
          chunkIds: { type: 'array', items: { type: 'string' } },
          maxChars: { type: 'number' },
        },
      },
      async execute(input) {
        const obj = objectInput(input);
        const maxChars = optionalNumber(obj, 'maxChars', 3000);
        const requestedChunkIds = Array.isArray(obj.chunkIds)
          ? Array.from(new Set(obj.chunkIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)))
          : [];

        if (requestedChunkIds.length > 0) {
          const chunks = requestedChunkIds
            .map((chunkId) => fileKnowledgeStore.readChunk(chunkId, maxChars))
            .filter((chunk): chunk is NonNullable<typeof chunk> => chunk !== null);
          const foundIds = new Set(chunks.map((chunk) => chunk.id));
          const missing = requestedChunkIds.filter((chunkId) => !foundIds.has(chunkId));
          if (chunks.length === 0) {
            throw new Error(`Cached file chunk not found: ${requestedChunkIds.join(', ')}`);
          }
          logFileCache(`Read ${chunks.length}/${requestedChunkIds.length} cached file chunks`);
          return {
            summary: `Read ${chunks.length}/${requestedChunkIds.length} cached file chunks`,
            data: { chunks, missing },
          };
        }

        const chunkId = typeof obj.chunkId === 'string' ? obj.chunkId.trim() : '';
        if (!chunkId) {
          throw new Error('filesystem.read_file_chunk requires chunkId or chunkIds.');
        }
        const chunk = fileKnowledgeStore.readChunk(chunkId, maxChars);
        if (!chunk) throw new Error(`Cached file chunk not found: ${chunkId}`);
        logFileCache(`Read file chunk ${chunk.relativePath}:${chunk.startLine}-${chunk.endLine}`);
        return {
          summary: `Read cached file chunk ${chunk.relativePath}:${chunk.startLine}-${chunk.endLine}`,
          data: { chunks: [chunk], missing: [] },
        };
      },
    },
    {
      name: 'filesystem.cache_inventory',
      description: 'Report file knowledge cache state. scope="stats" (default) returns totals and hit/miss counters; scope="files" lists indexed files.',
      inputSchema: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['stats', 'files'] },
          limit: { type: 'number' },
        },
      },
      async execute(input) {
        const obj = objectInput(input);
        const scope = typeof obj.scope === 'string' ? obj.scope : 'stats';
        if (scope === 'files') {
          const files = fileKnowledgeStore.listFiles({ limit: optionalNumber(obj, 'limit', 200) });
          return { summary: `Listed ${files.length} cached files`, data: { files } };
        }
        const stats = fileKnowledgeStore.getStats();
        return { summary: `File cache has ${stats.fileCount} files and ${stats.chunkCount} chunks`, data: { stats } };
      },
    },
    {
      name: 'filesystem.read',
      description: 'Read a UTF-8 file with freshness-aware cache reuse. Prefer indexed chunks; use startLine/endLine/maxChars to keep reads tight.',
      inputSchema: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string' },
          startLine: { type: 'number' },
          endLine: { type: 'number' },
          maxChars: { type: 'number' },
        },
      },
      async execute(input) {
        const obj = objectInput(input);
        const target = resolveLocalPath(requireString(obj, 'path'));
        const startLine = optionalPositiveInteger(obj, 'startLine');
        const endLine = optionalPositiveInteger(obj, 'endLine');
        if (startLine && endLine && endLine < startLine) {
          throw new Error('endLine must be greater than or equal to startLine');
        }
        const maxChars = clampReadChars(optionalNumber(obj, 'maxChars', DEFAULT_FILE_READ_MAX_CHARS));
        const cachedRead = fileKnowledgeStore.readWindowForPath(target, { startLine, endLine, maxChars });
        if (cachedRead) {
          logFileCache(`Served targeted file read (${cachedRead.content.length} chars, ${cachedRead.chunkCount} chunks): ${target}`);
          return {
            summary: `Read ${cachedRead.content.length} characters from indexed file window`,
            data: {
              ...cachedRead,
              source: 'indexed-window',
            },
          };
        }

        const raw = fs.readFileSync(target, 'utf-8');
        const selection = selectLines(raw.split('\n'), startLine, endLine);
        const trimmed = trimContent(selection.text, maxChars);
        logFileCache(`Broad file read fallback used (${trimmed.content.length} chars): ${target}`, 'warn');
        return {
          summary: `Read ${trimmed.content.length} characters from disk`,
          data: {
            path: target,
            relativePath: path.relative(APP_WORKSPACE_ROOT, target),
            content: trimmed.content,
            source: 'disk',
            truncated: trimmed.truncated,
            startLine: selection.startLine,
            endLine: selection.endLine,
            totalLines: selection.totalLines,
          },
        };
      },
    },
    {
      name: 'filesystem.write',
      description: 'Write UTF-8 content to a local file.',
      inputSchema: { type: 'object', required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string' } } },
      async execute(input) {
        const obj = objectInput(input);
        const target = resolveLocalPath(requireString(obj, 'path'));
        const content = requireString(obj, 'content');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content, 'utf-8');
        fileKnowledgeStore.refreshFile(target, APP_WORKSPACE_ROOT);
        fileKnowledgeStore.notePatch(target);
        invalidateFilesystemCaches();
        repoMapService.noteFileChanged(target);
        workspaceManifestService.noteFileChanged(target);
        return { summary: `Wrote ${content.length} characters`, data: { path: target } };
      },
    },
    {
      name: 'filesystem.patch',
      description: 'Patch a local file by replacing exact text.',
      inputSchema: { type: 'object', required: ['path', 'search', 'replace'], properties: { path: { type: 'string' }, search: { type: 'string' }, replace: { type: 'string' } } },
      async execute(input) {
        const obj = objectInput(input);
        const target = resolveLocalPath(requireString(obj, 'path'));
        const search = requireString(obj, 'search');
        const replace = String(obj.replace ?? '');
        const before = fs.readFileSync(target, 'utf-8');
        if (!before.includes(search)) throw new Error(`Search text not found in ${target}`);
        const after = before.replace(search, replace);
        fs.writeFileSync(target, after, 'utf-8');
        fileKnowledgeStore.refreshFile(target, APP_WORKSPACE_ROOT);
        fileKnowledgeStore.notePatch(target);
        invalidateFilesystemCaches();
        repoMapService.noteFileChanged(target);
        workspaceManifestService.noteFileChanged(target);
        return { summary: `Patched ${target}`, data: { path: target, changed: before !== after } };
      },
    },
    {
      name: 'filesystem.delete',
      description: 'Delete a local file or directory.',
      inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
      async execute(input) {
        const target = resolveLocalPath(requireString(objectInput(input), 'path'));
        fs.rmSync(target, { recursive: true, force: true });
        const removedRecords = fileKnowledgeStore.removePathTree(target);
        invalidateFilesystemCaches();
        repoMapService.noteFileDeleted(target);
        workspaceManifestService.noteFileDeleted(target);
        return { summary: `Deleted ${target}`, data: { path: target, removedRecords } };
      },
    },
    {
      name: 'filesystem.move',
      description: 'Move or rename a local file or directory.',
      inputSchema: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' } } },
      async execute(input) {
        const obj = objectInput(input);
        const from = resolveLocalPath(requireString(obj, 'from'));
        const to = resolveLocalPath(requireString(obj, 'to'));
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(from, to);
        const stat = fs.statSync(to);
        const removedRecords = fileKnowledgeStore.removePathTree(from);
        if (stat.isFile()) {
          fileKnowledgeStore.refreshFile(to, APP_WORKSPACE_ROOT);
          fileKnowledgeStore.notePatch(to);
        }
        invalidateFilesystemCaches();
        repoMapService.noteFileMoved(from, to);
        workspaceManifestService.noteFileMoved(from, to);
        return {
          summary: `Moved ${from} to ${to}`,
          data: { from, to, removedRecords, refreshed: stat.isFile() },
        };
      },
    },
  ];
}
