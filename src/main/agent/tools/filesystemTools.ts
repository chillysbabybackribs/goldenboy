import { AgentToolDefinition } from '../AgentTypes';
import * as fs from 'fs';
import * as path from 'path';
import { agentCache } from '../AgentCache';
import { fileKnowledgeStore } from '../../fileKnowledge/FileKnowledgeStore';
import { appStateStore } from '../../state/appStateStore';
import { ActionType } from '../../state/actions';
import { generateId } from '../../../shared/utils/ids';
import { isPathInArtifactsRoot } from '../../artifacts/storage';
import { APP_WORKSPACE_ROOT } from '../../workspaceRoot';

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

function assertNotManagedArtifactPath(target: string): void {
  if (isPathInArtifactsRoot(target)) {
    throw new Error('Managed artifact paths are reserved for the artifact service.');
  }
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
      name: 'filesystem.search',
      description: 'Fallback file path and text search under a local path. Prefer filesystem.search_file_cache for indexed source lookup when possible.',
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
      description: 'Index a local workspace into compact searchable file chunks. Run this before file-heavy reasoning or after code changes.',
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
      name: 'filesystem.answer_from_cache',
      description: 'Answer a file/code question from cached file chunks with compact excerpts and source chunk ids. Prefer this before full file reads.',
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string' },
          pathPrefix: { type: 'string' },
          language: { type: 'string' },
          limit: { type: 'number' },
        },
      },
      async execute(input) {
        const obj = objectInput(input);
        const query = requireString(obj, 'query');
        const answer = fileKnowledgeStore.answerFromCache(query, {
          pathPrefix: optionalString(obj, 'pathPrefix'),
          language: optionalString(obj, 'language'),
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
      },
    },
    {
      name: 'filesystem.search_file_cache',
      description: 'Search indexed file chunks by query, optional path prefix, and language. Returns snippets and chunk ids for targeted reads.',
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string' },
          pathPrefix: { type: 'string' },
          language: { type: 'string' },
          limit: { type: 'number' },
        },
      },
      async execute(input) {
        const obj = objectInput(input);
        const query = requireString(obj, 'query');
        const results = fileKnowledgeStore.search(query, {
          pathPrefix: optionalString(obj, 'pathPrefix'),
          language: optionalString(obj, 'language'),
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
      description: 'Read one indexed file chunk by chunk id. Use after filesystem.search_file_cache instead of reading whole files.',
      inputSchema: {
        type: 'object',
        required: ['chunkId'],
        properties: {
          chunkId: { type: 'string' },
          maxChars: { type: 'number' },
        },
      },
      async execute(input) {
        const obj = objectInput(input);
        const chunkId = requireString(obj, 'chunkId');
        const chunk = fileKnowledgeStore.readChunk(chunkId, optionalNumber(obj, 'maxChars', 3000));
        if (!chunk) throw new Error(`Cached file chunk not found: ${chunkId}`);
        logFileCache(`Read file chunk ${chunk.relativePath}:${chunk.startLine}-${chunk.endLine}`);
        return {
          summary: `Read cached file chunk ${chunk.relativePath}:${chunk.startLine}-${chunk.endLine}`,
          data: { chunk },
        };
      },
    },
    {
      name: 'filesystem.list_cached_files',
      description: 'List files currently indexed in the file knowledge cache.',
      inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
      async execute(input) {
        const obj = objectInput(input);
        const files = fileKnowledgeStore.listFiles({ limit: optionalNumber(obj, 'limit', 200) });
        return { summary: `Listed ${files.length} cached files`, data: { files } };
      },
    },
    {
      name: 'filesystem.file_cache_stats',
      description: 'Return file knowledge cache size, token estimate, and hit/miss counters.',
      inputSchema: { type: 'object', properties: {} },
      async execute() {
        const stats = fileKnowledgeStore.getStats();
        return { summary: `File cache has ${stats.fileCount} files and ${stats.chunkCount} chunks`, data: { stats } };
      },
    },
    {
      name: 'filesystem.read',
      description: 'Read a UTF-8 file with freshness-aware cache reuse. Prefer indexed chunks when available, and use startLine/endLine/maxChars to keep reads tight.',
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
        assertNotManagedArtifactPath(target);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content, 'utf-8');
        fileKnowledgeStore.refreshFile(target, APP_WORKSPACE_ROOT);
        invalidateFilesystemCaches();
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
        assertNotManagedArtifactPath(target);
        const before = fs.readFileSync(target, 'utf-8');
        if (!before.includes(search)) throw new Error(`Search text not found in ${target}`);
        const after = before.replace(search, replace);
        fs.writeFileSync(target, after, 'utf-8');
        fileKnowledgeStore.refreshFile(target, APP_WORKSPACE_ROOT);
        invalidateFilesystemCaches();
        return { summary: `Patched ${target}`, data: { path: target, changed: before !== after } };
      },
    },
    {
      name: 'filesystem.delete',
      description: 'Delete a local file or directory.',
      inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
      async execute(input) {
        const target = resolveLocalPath(requireString(objectInput(input), 'path'));
        assertNotManagedArtifactPath(target);
        fs.rmSync(target, { recursive: true, force: true });
        const removedRecords = fileKnowledgeStore.removePathTree(target);
        invalidateFilesystemCaches();
        return { summary: `Deleted ${target}`, data: { path: target, removedRecords } };
      },
    },
    {
      name: 'filesystem.mkdir',
      description: 'Create a local directory.',
      inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
      async execute(input) {
        const target = resolveLocalPath(requireString(objectInput(input), 'path'));
        assertNotManagedArtifactPath(target);
        fs.mkdirSync(target, { recursive: true });
        invalidateFilesystemCaches();
        return { summary: `Created directory ${target}`, data: { path: target } };
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
        assertNotManagedArtifactPath(from);
        assertNotManagedArtifactPath(to);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(from, to);
        const stat = fs.statSync(to);
        const removedRecords = fileKnowledgeStore.removePathTree(from);
        if (stat.isFile()) {
          fileKnowledgeStore.refreshFile(to, APP_WORKSPACE_ROOT);
        }
        invalidateFilesystemCaches();
        return {
          summary: `Moved ${from} to ${to}`,
          data: { from, to, removedRecords, refreshed: stat.isFile() },
        };
      },
    },
  ];
}
