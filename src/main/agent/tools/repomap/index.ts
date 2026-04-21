import * as path from 'path';
import * as fs from 'fs';
import type { AgentToolDefinition, AgentToolResult } from '../../AgentTypes';
import { APP_WORKSPACE_ROOT } from '../../../workspaceRoot';
import {
  describeFileInMap,
  findSymbolsInMap,
  neighborsOfFile,
  repoMapService,
} from '../../repoMap';
import type {
  RepoFile,
  RepoMap,
  RepoMapEntry,
  SymbolKind,
  SymbolMatch,
} from '../../repoMap';
import { renderRepoMap } from '../../repoMap/renderRepoMap';

const DEFAULT_SCAN_ROOT = 'src';
const VALID_SYMBOL_KINDS = new Set<SymbolKind>([
  'class',
  'function',
  'interface',
  'type',
  'const',
  'enum',
]);

function objectInput(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null
    ? (input as Record<string, unknown>)
    : {};
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Expected non-empty string input: ${key}`);
  }
  return value.trim();
}

function optionalString(
  input: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function optionalPositiveInt(
  input: Record<string, unknown>,
  key: string,
  fallback: number,
  max = 500,
): number {
  const value = input[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const n = Math.floor(value);
  if (n < 1) return fallback;
  return Math.min(n, max);
}

function resolveScanRoot(input: Record<string, unknown>): string {
  const raw = typeof input.root === 'string' && input.root.trim() !== ''
    ? input.root.trim()
    : DEFAULT_SCAN_ROOT;
  const resolved = path.resolve(APP_WORKSPACE_ROOT, raw);
  if (!fs.existsSync(resolved)) {
    throw new Error(`repomap: root does not exist: ${raw}`);
  }
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`repomap: root must be a directory: ${raw}`);
  }
  return resolved;
}

function mapMeta(entry: RepoMapEntry): Record<string, unknown> {
  return {
    fileCount: entry.map.fileCount,
    totalLines: entry.map.totalLines,
    buildMs: entry.buildMs,
    ageMs: Date.now() - entry.builtAt,
    builtAt: new Date(entry.builtAt).toISOString(),
    root: entry.map.root,
  };
}

function summarizeSymbolMatch(match: SymbolMatch): string {
  return `${match.file}:${match.line}  ${match.signature}`;
}

function summarizeFile(file: RepoFile): {
  path: string;
  rank: number;
  lines: number;
  importCount: number;
  importedByCount: number;
  symbols: Array<{
    name: string;
    kind: SymbolKind;
    line: number;
    signature: string;
    doc?: string;
  }>;
} {
  return {
    path: file.path,
    rank: Number(file.score.toFixed(4)),
    lines: file.lines,
    importCount: file.imports.length,
    importedByCount: file.importedBy.length,
    symbols: file.symbols.map((s) => ({
      name: s.name,
      kind: s.kind,
      line: s.line,
      signature: s.signature,
      doc: s.doc,
    })),
  };
}

function parseSymbolKind(raw: unknown): SymbolKind | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim().toLowerCase() as SymbolKind;
  return VALID_SYMBOL_KINDS.has(v) ? v : undefined;
}

export function createRepoMapToolDefinitions(): AgentToolDefinition[] {
  return [
    {
      name: 'repomap.overview',
      description:
        'Return a ranked, structural overview of the workspace. Files are ordered by PageRank over the TypeScript import graph, so the top entries are the hubs every change flows through. Prefer this over listing/grepping the repo when you need to plan a change or choose where to look first. Output includes a compact markdown map suitable for reasoning and a structured list of top files.',
      inputSchema: {
        type: 'object',
        properties: {
          root: {
            type: 'string',
            description:
              'Directory to scan, relative to the workspace root. Defaults to "src".',
          },
          maxFiles: {
            type: 'number',
            description: 'Truncate to top-N files by PageRank. Default 20.',
          },
          maxSymbolsPerFile: {
            type: 'number',
            description: 'Max top-level symbols rendered per file. Default 8.',
          },
        },
      },
      async execute(rawInput) {
        const input = objectInput(rawInput);
        const rootAbs = resolveScanRoot(input);
        const maxFiles = optionalPositiveInt(input, 'maxFiles', 20, 200);
        const maxSymbolsPerFile = optionalPositiveInt(
          input,
          'maxSymbolsPerFile',
          8,
          40,
        );

        const entry = await repoMapService.getMap(rootAbs);
        const rendered = renderRepoMap(entry.map, {
          maxFiles,
          maxSymbolsPerFile,
        });

        const topFiles = entry.map.files.slice(0, maxFiles).map(summarizeFile);

        const result: AgentToolResult = {
          summary: `Repo map for ${path.relative(APP_WORKSPACE_ROOT, rootAbs) || '.'}: ${entry.map.fileCount} files, ${entry.map.totalLines} lines (top ${topFiles.length} shown)`,
          data: {
            meta: mapMeta(entry),
            map: rendered,
            topFiles,
          },
        };
        return result;
      },
    },
    {
      name: 'repomap.find_symbol',
      description:
        'Locate a top-level symbol (class, function, interface, type, const, enum) by name across the workspace and return file:line hits ranked by exact-match then file importance. Use this instead of filesystem.search when you already know the symbol name; it is faster and more precise.',
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: {
            type: 'string',
            description: 'Symbol name (or case-insensitive substring).',
          },
          exact: {
            type: 'boolean',
            description: 'If true, require exact (case-insensitive) match. Default false.',
          },
          kind: {
            type: 'string',
            enum: ['class', 'function', 'interface', 'type', 'const', 'enum'],
          },
          pathPrefix: {
            type: 'string',
            description: 'Restrict matches to files whose path starts with this prefix (relative to scan root).',
          },
          root: {
            type: 'string',
            description: 'Directory to scan, relative to the workspace root. Defaults to "src".',
          },
          limit: {
            type: 'number',
            description: 'Max results to return. Default 20.',
          },
        },
      },
      async execute(rawInput) {
        const input = objectInput(rawInput);
        const name = requireString(input, 'name');
        const rootAbs = resolveScanRoot(input);
        const exact = input.exact === true;
        const kind = parseSymbolKind(input.kind);
        const pathPrefix = optionalString(input, 'pathPrefix');
        const limit = optionalPositiveInt(input, 'limit', 20, 100);

        const entry = await repoMapService.getMap(rootAbs);
        const matches = findSymbolsInMap(entry.map, {
          name,
          kind,
          exact,
          limit,
          pathPrefix,
        });

        return {
          summary: matches.length === 0
            ? `No symbols matched "${name}"${kind ? ` (kind=${kind})` : ''}`
            : `Found ${matches.length} symbol match${matches.length === 1 ? '' : 'es'} for "${name}"; top: ${summarizeSymbolMatch(matches[0])}`,
          data: {
            meta: mapMeta(entry),
            query: { name, exact, kind, pathPrefix, limit },
            matches,
          },
        };
      },
    },
    {
      name: 'repomap.describe_file',
      description:
        'Return the full exported-symbol listing, imports, and direct dependents for a single file. Use before reading or editing a file so you know its role in the graph without opening it.',
      inputSchema: {
        type: 'object',
        required: ['path'],
        properties: {
          path: {
            type: 'string',
            description: 'File path relative to the scan root (e.g. "main/agent/taskProfile.ts").',
          },
          root: {
            type: 'string',
            description: 'Directory to scan, relative to the workspace root. Defaults to "src".',
          },
        },
      },
      async execute(rawInput) {
        const input = objectInput(rawInput);
        const rootAbs = resolveScanRoot(input);
        const relPath = requireString(input, 'path');
        const entry = await repoMapService.getMap(rootAbs);
        const file = describeFileInMap(entry.map, relPath);
        if (!file) {
          const suggestions = entry.map.files
            .filter((f) => f.path.includes(path.basename(relPath)))
            .slice(0, 5)
            .map((f) => f.path);
          return {
            summary: `No file at ${relPath}${suggestions.length ? `; did you mean: ${suggestions.join(', ')}` : ''}`,
            data: {
              meta: mapMeta(entry),
              path: relPath,
              found: false,
              suggestions,
            },
          };
        }
        return {
          summary: `${file.path}: ${file.symbols.length} symbols, ${file.importedBy.length} dependents, ${file.imports.length} imports`,
          data: {
            meta: mapMeta(entry),
            found: true,
            file: {
              ...summarizeFile(file),
              imports: file.imports,
              importedBy: file.importedBy,
              externalImports: file.externalImports,
            },
          },
        };
      },
    },
    {
      name: 'repomap.neighbors',
      description:
        'Walk the import graph around a file up to a given depth. Use direction="in" to answer "what will break if I change this?", direction="out" to answer "what does this file depend on?", direction="both" for a full blast-radius view. Returns paths ranked by depth then PageRank.',
      inputSchema: {
        type: 'object',
        required: ['path'],
        properties: {
          path: {
            type: 'string',
            description: 'File path relative to the scan root.',
          },
          direction: {
            type: 'string',
            enum: ['in', 'out', 'both'],
            description: 'in=dependents, out=dependencies, both=union. Default "both".',
          },
          depth: {
            type: 'number',
            description: 'BFS depth. Default 1, max 4.',
          },
          limit: {
            type: 'number',
            description: 'Max neighbors returned. Default 60.',
          },
          root: {
            type: 'string',
            description: 'Directory to scan, relative to the workspace root. Defaults to "src".',
          },
        },
      },
      async execute(rawInput) {
        const input = objectInput(rawInput);
        const rootAbs = resolveScanRoot(input);
        const relPath = requireString(input, 'path');
        const directionRaw =
          typeof input.direction === 'string' ? input.direction.toLowerCase() : 'both';
        const direction: 'in' | 'out' | 'both' =
          directionRaw === 'in' || directionRaw === 'out' ? directionRaw : 'both';
        const depth = Math.min(
          Math.max(optionalPositiveInt(input, 'depth', 1, 4), 1),
          4,
        );
        const limit = optionalPositiveInt(input, 'limit', 60, 300);

        const entry = await repoMapService.getMap(rootAbs);
        const { root: rootFile, neighbors } = neighborsOfFile(entry.map, relPath, {
          direction,
          depth,
          limit,
        });
        if (!rootFile) {
          return {
            summary: `No file at ${relPath}`,
            data: {
              meta: mapMeta(entry),
              path: relPath,
              found: false,
            },
          };
        }
        return {
          summary: `${rootFile.path}: ${neighbors.length} neighbor${neighbors.length === 1 ? '' : 's'} within depth ${depth} (${direction})`,
          data: {
            meta: mapMeta(entry),
            found: true,
            root: {
              path: rootFile.path,
              rank: Number(rootFile.score.toFixed(4)),
              lines: rootFile.lines,
            },
            direction,
            depth,
            neighbors,
          },
        };
      },
    },
    {
      name: 'repomap.refresh',
      description:
        'Invalidate and rebuild the cached repo map. Call after large file edits, moves, or renames so subsequent repomap.* calls reflect the new structure.',
      inputSchema: {
        type: 'object',
        properties: {
          root: {
            type: 'string',
            description: 'Directory to rebuild, relative to the workspace root. Defaults to "src".',
          },
        },
      },
      async execute(rawInput) {
        const input = objectInput(rawInput);
        const rootAbs = resolveScanRoot(input);
        const entry = await repoMapService.refresh(rootAbs);
        return {
          summary: `Rebuilt repo map for ${path.relative(APP_WORKSPACE_ROOT, rootAbs) || '.'} in ${entry.buildMs}ms (${entry.map.fileCount} files, ${entry.map.totalLines} lines)`,
          data: { meta: mapMeta(entry) },
        };
      },
    },
  ];
}
