import * as path from 'path';
import * as fs from 'fs';
import type { AgentToolDefinition, AgentToolResult } from '../../AgentTypes';
import { APP_WORKSPACE_ROOT } from '../../../workspaceRoot';
import {
  listSubtree,
  locate,
  renderDirectoryOverview,
  workspaceManifestService,
  type LocateMatch,
  type ManifestEntry,
} from '../../workspaceManifest';

function objectInput(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Expected non-empty string input: ${key}`);
  }
  return value.trim();
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
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

function resolveRoot(input: Record<string, unknown>): string {
  const raw = typeof input.root === 'string' && input.root.trim() !== ''
    ? input.root.trim()
    : '.';
  const resolved = path.resolve(APP_WORKSPACE_ROOT, raw);
  if (!fs.existsSync(resolved)) {
    throw new Error(`workspace: root does not exist: ${raw}`);
  }
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`workspace: root must be a directory: ${raw}`);
  }
  return resolved;
}

function manifestMeta(entry: ManifestEntry): Record<string, unknown> {
  return {
    fileCount: entry.manifest.files.length,
    directoryCount: entry.manifest.directories.length,
    buildMs: entry.buildMs,
    ageMs: Date.now() - entry.builtAt,
    builtAt: new Date(entry.builtAt).toISOString(),
    root: entry.manifest.root,
  };
}

function summarizeMatch(match: LocateMatch): string {
  const purpose = match.purpose ? ` — ${match.purpose}` : '';
  return `${match.path}${purpose} (score ${match.score})`;
}

export function createWorkspaceToolDefinitions(): AgentToolDefinition[] {
  return [
    {
      name: 'workspace.locate',
      description:
        'Given a natural-language query or keyword, return the top-N files in the workspace most likely to be relevant. Scores over filename + path + extracted purpose line (first JSDoc / markdown heading / frontmatter description) across ALL files (code, docs, configs, skills). Call this before listing directories or grepping — it is the fastest way to go from prompt to the right file.',
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: {
            type: 'string',
            description: 'Free-form query, e.g. "memory system", "browser tab manager", "source validation policy".',
          },
          limit: {
            type: 'number',
            description: 'Max matches returned. Default 15, max 50.',
          },
          pathPrefix: {
            type: 'string',
            description: 'Restrict matches to paths starting with this prefix (e.g. "src/main/agent").',
          },
          fileTypes: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['code', 'test', 'doc', 'skill', 'config', 'fixture', 'asset', 'other'],
            },
            description: 'Restrict to files of the given types.',
          },
          root: {
            type: 'string',
            description: 'Workspace root to search, relative to the app root. Defaults to ".".',
          },
        },
      },
      async execute(rawInput) {
        const input = objectInput(rawInput);
        const query = requireString(input, 'query');
        const rootAbs = resolveRoot(input);
        const limit = optionalPositiveInt(input, 'limit', 15, 50);
        const pathPrefix = optionalString(input, 'pathPrefix');
        const fileTypesRaw = Array.isArray(input.fileTypes) ? input.fileTypes : undefined;
        const fileTypes = fileTypesRaw
          ? (fileTypesRaw.filter((t): t is string => typeof t === 'string') as LocateMatch['fileType'][])
          : undefined;

        const entry = await workspaceManifestService.getManifest(rootAbs);
        const matches = locate(entry.manifest, {
          query,
          limit,
          pathPrefix,
          fileTypes: fileTypes as Parameters<typeof locate>[1]['fileTypes'],
        });

        const result: AgentToolResult = {
          summary: matches.length === 0
            ? `No workspace files matched "${query}"`
            : `Top ${matches.length} match${matches.length === 1 ? '' : 'es'} for "${query}": ${summarizeMatch(matches[0])}`,
          data: {
            meta: manifestMeta(entry),
            query,
            matches,
          },
        };
        return result;
      },
    },
    {
      name: 'workspace.tree',
      description:
        'List files and directories under a workspace subtree, with extracted purpose lines. Use to orient quickly before reading multiple files. Prefer this over `filesystem.list` when you need purposes and not just names.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory prefix relative to the workspace root. Defaults to "" (whole workspace).',
          },
          depth: {
            type: 'number',
            description: 'Max depth below the prefix. Default 2, max 6.',
          },
          limit: {
            type: 'number',
            description: 'Max entries to return. Default 200, max 1000.',
          },
          root: {
            type: 'string',
            description: 'Workspace root, relative to the app root. Defaults to ".".',
          },
        },
      },
      async execute(rawInput) {
        const input = objectInput(rawInput);
        const rootAbs = resolveRoot(input);
        const prefix = optionalString(input, 'path') ?? '';
        const depthRaw = optionalPositiveInt(input, 'depth', 2, 6);
        const limit = optionalPositiveInt(input, 'limit', 200, 1000);

        const entry = await workspaceManifestService.getManifest(rootAbs);
        const entries = listSubtree(entry.manifest, {
          prefix,
          depth: depthRaw,
          limit,
        });

        return {
          summary: `Listed ${entries.length} entries under "${prefix || '/'}" (depth ${depthRaw})`,
          data: {
            meta: manifestMeta(entry),
            prefix,
            depth: depthRaw,
            entries,
          },
        };
      },
    },
    {
      name: 'workspace.refresh',
      description:
        'Rebuild the workspace manifest from scratch. Auto-invalidation already runs after filesystem.write/patch/delete/move, so call this only after a bulk external change (e.g. git pull, branch switch, large code-gen).',
      inputSchema: {
        type: 'object',
        properties: {
          root: {
            type: 'string',
            description: 'Workspace root, relative to the app root. Defaults to ".".',
          },
        },
      },
      async execute(rawInput) {
        const input = objectInput(rawInput);
        const rootAbs = resolveRoot(input);
        const entry = await workspaceManifestService.refresh(rootAbs);
        return {
          summary: `Rebuilt workspace manifest for ${path.relative(APP_WORKSPACE_ROOT, rootAbs) || '.'} in ${entry.buildMs}ms (${entry.manifest.files.length} files, ${entry.manifest.directories.length} directories)`,
          data: { meta: manifestMeta(entry) },
        };
      },
    },
    {
      name: 'workspace.overview',
      description:
        'Return the compact directory-level overview of the workspace with extracted purpose lines. This is the same overview injected into the system prompt — use it to re-read the map mid-task or to request a deeper depth.',
      inputSchema: {
        type: 'object',
        properties: {
          maxDepth: {
            type: 'number',
            description: 'Max directory depth to render. Default 3, max 6.',
          },
          maxChars: {
            type: 'number',
            description: 'Budget in characters. Default 4000, max 16000.',
          },
          root: {
            type: 'string',
            description: 'Workspace root, relative to the app root. Defaults to ".".',
          },
        },
      },
      async execute(rawInput) {
        const input = objectInput(rawInput);
        const rootAbs = resolveRoot(input);
        const maxDepth = Math.min(optionalPositiveInt(input, 'maxDepth', 3, 6), 6);
        const maxChars = Math.min(optionalPositiveInt(input, 'maxChars', 4000, 16000), 16000);
        const entry = await workspaceManifestService.getManifest(rootAbs);
        const rendered = renderDirectoryOverview(entry.manifest, { maxDepth, maxChars });
        return {
          summary: `Workspace overview: ${entry.manifest.files.length} files, ${entry.manifest.directories.length} directories`,
          data: {
            meta: manifestMeta(entry),
            overview: rendered,
          },
        };
      },
    },
  ];
}
