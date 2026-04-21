import type { ManifestDirectory, ManifestFile, WorkspaceManifest } from './types';

export interface RenderOverviewOptions {
  /** Max directory depth to list. Default 3. */
  maxDepth?: number;
  /** Max characters in the whole rendered overview. Default 4000. */
  maxChars?: number;
  /** Max directories rendered at any single depth (safety cap). Default 120. */
  maxDirs?: number;
  /** Include up to this many notable files directly in the overview per directory. Default 3. */
  notableFilesPerDir?: number;
}

/**
 * Compact, human-readable workspace map grouped by directory. Safe to inject
 * into the system prompt. Meant to let the model self-locate without grepping
 * the tree.
 */
export function renderDirectoryOverview(
  manifest: WorkspaceManifest,
  options: RenderOverviewOptions = {},
): string {
  const {
    maxDepth = 3,
    maxChars = 4000,
    maxDirs = 120,
    notableFilesPerDir = 3,
  } = options;

  const filesByDir = groupFilesByDir(manifest.files);
  const dirsSorted = [...manifest.directories]
    .filter((d) => depthOf(d.path) <= maxDepth)
    .sort((a, b) => a.path.localeCompare(b.path))
    .slice(0, maxDirs);

  const lines: string[] = [];
  lines.push(`Workspace: ${manifest.files.length} files across ${manifest.directories.length} directories (depth ≤ ${maxDepth} shown)`);
  lines.push('');

  for (const dir of dirsSorted) {
    const indent = '  '.repeat(depthOf(dir.path));
    const label = dir.path === '' ? '/' : `${dir.path}/`;
    const counts = `(${dir.fileCount} files${dir.subdirCount > 0 ? `, ${dir.subdirCount} subdirs` : ''})`;
    const purpose = dir.purpose ? ` — ${dir.purpose}` : '';
    lines.push(`${indent}${label} ${counts}${purpose}`);

    const notables = pickNotableFiles(filesByDir.get(dir.path) ?? [], notableFilesPerDir);
    for (const f of notables) {
      const fileLine = f.purpose ? `${f.path} — ${f.purpose}` : f.path;
      lines.push(`${indent}  - ${fileLine}`);
    }
  }

  const joined = lines.join('\n');
  if (joined.length <= maxChars) return joined;

  // Budget-aware truncation: keep early lines, cut tail.
  const truncated = joined.slice(0, maxChars - 32);
  const lastNewline = truncated.lastIndexOf('\n');
  return `${truncated.slice(0, lastNewline > 0 ? lastNewline : truncated.length)}\n… (truncated)`;
}

/**
 * Full file-level listing ordered by path. Not meant for prompt injection.
 * Used as a corpus for `locate` and as the response payload for
 * `workspace.tree`/`workspace.manifest` tool calls.
 */
export function renderFullFileListing(
  manifest: WorkspaceManifest,
  options: { limit?: number } = {},
): string[] {
  const { limit = manifest.files.length } = options;
  return manifest.files
    .slice(0, limit)
    .map((f) => (f.purpose ? `${f.path} — ${f.purpose}` : f.path));
}

/** Subtree listing for a given directory prefix, paths only. */
export function listSubtree(
  manifest: WorkspaceManifest,
  options: { prefix?: string; depth?: number; limit?: number } = {},
): Array<{ path: string; purpose?: string; fileType: ManifestFile['fileType'] }> {
  const { prefix = '', depth = Infinity, limit = 500 } = options;
  const normalizedPrefix = prefix.endsWith('/') ? prefix : prefix === '' ? '' : `${prefix}/`;
  const prefixDepth = depthOf(normalizedPrefix === '' ? '' : normalizedPrefix.slice(0, -1));
  const out: Array<{ path: string; purpose?: string; fileType: ManifestFile['fileType'] }> = [];
  for (const f of manifest.files) {
    if (normalizedPrefix && !f.path.startsWith(normalizedPrefix)) continue;
    if (!Number.isFinite(depth)) {
      out.push({ path: f.path, purpose: f.purpose, fileType: f.fileType });
    } else {
      const fDepth = depthOf(f.path);
      if (fDepth - prefixDepth - (normalizedPrefix === '' ? 0 : 1) < depth) {
        out.push({ path: f.path, purpose: f.purpose, fileType: f.fileType });
      }
    }
    if (out.length >= limit) break;
  }
  return out;
}

function groupFilesByDir(files: ManifestFile[]): Map<string, ManifestFile[]> {
  const map = new Map<string, ManifestFile[]>();
  for (const f of files) {
    const parent = parentDir(f.path);
    const arr = map.get(parent);
    if (arr) arr.push(f);
    else map.set(parent, [f]);
  }
  return map;
}

function pickNotableFiles(files: ManifestFile[], n: number): ManifestFile[] {
  if (files.length === 0 || n <= 0) return [];
  const scored = files.map((f) => ({ f, score: scoreNotability(f) }));
  scored.sort((a, b) => b.score - a.score || a.f.path.localeCompare(b.f.path));
  return scored.slice(0, n).map((s) => s.f);
}

function scoreNotability(f: ManifestFile): number {
  let s = 0;
  const basename = f.path.split('/').pop() ?? '';
  const lower = basename.toLowerCase();
  if (['readme.md', 'agents.md', 'claude.md', 'index.md'].includes(lower)) s += 10;
  if (lower === 'index.ts' || lower === 'index.tsx' || lower === 'index.js') s += 8;
  if (lower === 'package.json') s += 6;
  if (lower.endsWith('.test.ts') || lower.endsWith('.test.tsx') || lower.endsWith('.spec.ts')) s -= 4;
  if (f.fileType === 'fixture') s -= 6;
  if (f.fileType === 'asset') s -= 8;
  if (f.purpose) s += 2;
  return s;
}

function depthOf(p: string): number {
  if (p === '') return 0;
  return p.split('/').length;
}

function parentDir(rel: string): string {
  const idx = rel.lastIndexOf('/');
  return idx < 0 ? '' : rel.slice(0, idx);
}

export function formatDirectoryEntry(dir: ManifestDirectory): string {
  const label = dir.path === '' ? '/' : `${dir.path}/`;
  const counts = `(${dir.fileCount} files${dir.subdirCount > 0 ? `, ${dir.subdirCount} subdirs` : ''})`;
  const purpose = dir.purpose ? ` — ${dir.purpose}` : '';
  return `${label} ${counts}${purpose}`;
}
