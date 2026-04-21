import * as fs from 'fs';
import * as path from 'path';
import type {
  FileType,
  ManifestDirectory,
  ManifestFile,
  WorkspaceManifest,
} from './types';

export interface BuildManifestOptions {
  /** Absolute directory to scan. */
  root: string;
  /** Directory names to skip anywhere in the tree. */
  skipDirs?: Iterable<string>;
  /** File basenames/globs to skip. */
  skipFiles?: Iterable<string>;
  /** Max files to include (safety cap). Default 5000. */
  maxFiles?: number;
  /** Max bytes to read per file while extracting purpose. Default 4096. */
  purposeReadBytes?: number;
  /** Max files per directory before the contents are rolled up (still counted but not listed individually). Default 400. */
  maxFilesPerDir?: number;
}

const DEFAULT_SKIP_DIRS = new Set<string>([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  '.cache',
  '.next',
  '.turbo',
  '.yarn',
  '.pnpm-store',
  '.parcel-cache',
  '.vite',
  '.nyc_output',
  '.vscode-test',
  '__pycache__',
  '.venv',
  'venv',
  '.idea',
  '.DS_Store',
]);

const DEFAULT_SKIP_FILES = new Set<string>([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  '.DS_Store',
  'Thumbs.db',
]);

const BINARY_EXTENSIONS = new Set<string>([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.mp4',
  '.mp3',
  '.wav',
  '.zip',
  '.gz',
  '.tgz',
  '.tar',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.exe',
  '.dll',
  '.dylib',
  '.so',
  '.bin',
  '.wasm',
]);

const LANGUAGE_BY_EXT: Record<string, string> = {
  '.ts': 'ts',
  '.tsx': 'tsx',
  '.js': 'js',
  '.jsx': 'jsx',
  '.mjs': 'js',
  '.cjs': 'js',
  '.py': 'py',
  '.rb': 'rb',
  '.go': 'go',
  '.rs': 'rs',
  '.java': 'java',
  '.kt': 'kt',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.hpp': 'cpp',
  '.cs': 'cs',
  '.swift': 'swift',
  '.sh': 'sh',
  '.bash': 'sh',
  '.zsh': 'sh',
  '.md': 'md',
  '.mdx': 'md',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.json': 'json',
  '.json5': 'json',
  '.xml': 'xml',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.proto': 'proto',
};

export function buildWorkspaceManifest(options: BuildManifestOptions): WorkspaceManifest {
  const absRoot = path.resolve(options.root);
  const skipDirs = new Set<string>([...DEFAULT_SKIP_DIRS, ...(options.skipDirs ?? [])]);
  const skipFiles = new Set<string>([...DEFAULT_SKIP_FILES, ...(options.skipFiles ?? [])]);
  const maxFiles = options.maxFiles ?? 5000;
  const purposeReadBytes = options.purposeReadBytes ?? 4096;

  const files: ManifestFile[] = [];
  const directoryMap = new Map<string, { fileCount: number; subdirs: Set<string> }>();
  ensureDir(directoryMap, '');

  walk(absRoot, absRoot, skipDirs, skipFiles, purposeReadBytes, files, directoryMap, maxFiles);

  files.sort((a, b) => a.path.localeCompare(b.path));

  const directories: ManifestDirectory[] = Array.from(directoryMap.entries()).map(
    ([dirPath, info]) => {
      const purpose = inferDirectoryPurpose(absRoot, dirPath, files);
      return {
        path: dirPath,
        fileCount: info.fileCount,
        subdirCount: info.subdirs.size,
        purpose,
      };
    },
  );
  directories.sort((a, b) => a.path.localeCompare(b.path));

  return {
    root: absRoot,
    generatedAt: new Date().toISOString(),
    files,
    directories,
  };
}

function walk(
  root: string,
  dir: string,
  skipDirs: Set<string>,
  skipFiles: Set<string>,
  purposeReadBytes: number,
  files: ManifestFile[],
  dirMap: Map<string, { fileCount: number; subdirs: Set<string> }>,
  maxFiles: number,
): void {
  if (files.length >= maxFiles) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (files.length >= maxFiles) return;
    if (entry.name.startsWith('.') && entry.name !== '.' && entry.name !== '..') {
      // Skip most dotfiles/dotdirs but allow a few well-known ones
      if (!isAllowedDotEntry(entry.name)) continue;
    }
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const relDir = toRelPosix(root, full);
      const parentRel = toRelPosix(root, dir);
      ensureDir(dirMap, relDir);
      dirMap.get(parentRel)!.subdirs.add(relDir);
      walk(root, full, skipDirs, skipFiles, purposeReadBytes, files, dirMap, maxFiles);
      continue;
    }
    if (!entry.isFile()) continue;
    if (skipFiles.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = toRelPosix(root, full);
    const parentRel = toRelPosix(root, dir);
    ensureDir(dirMap, parentRel);
    dirMap.get(parentRel)!.fileCount += 1;

    const ext = path.extname(entry.name).toLowerCase();
    const fileType = classifyFile(rel, entry.name, ext);
    const language = LANGUAGE_BY_EXT[ext];
    let sizeBytes = 0;
    try {
      sizeBytes = fs.statSync(full).size;
    } catch {
      sizeBytes = 0;
    }
    const purpose = BINARY_EXTENSIONS.has(ext)
      ? undefined
      : extractPurpose(full, ext, entry.name, purposeReadBytes);

    files.push({
      path: rel,
      fileType,
      language,
      purpose,
      sizeBytes,
    });
  }
}

function ensureDir(
  dirMap: Map<string, { fileCount: number; subdirs: Set<string> }>,
  relDir: string,
): void {
  if (!dirMap.has(relDir)) dirMap.set(relDir, { fileCount: 0, subdirs: new Set() });
}

function isAllowedDotEntry(name: string): boolean {
  // We skip most dot-entries to keep the manifest focused on meaningful workspace content.
  // Allow a small allow-list of commonly useful ones.
  const ALLOWED = new Set(['.github', '.cursor', '.claude', '.codex', '.env.example']);
  return ALLOWED.has(name);
}

function toRelPosix(root: string, full: string): string {
  const rel = path.relative(root, full);
  if (!rel) return '';
  return rel.split(path.sep).join('/');
}

function classifyFile(rel: string, basename: string, ext: string): FileType {
  const lowerBase = basename.toLowerCase();
  const lowerRel = rel.toLowerCase();
  if (lowerBase === 'skill.md') return 'skill';
  if (lowerRel.startsWith('skills/') || lowerRel.includes('/skills/')) return 'skill';
  if (lowerRel.includes('/__tests__/') || lowerRel.startsWith('__tests__/')) return 'test';
  if (/\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs|py)$/.test(lowerBase)) return 'test';
  if (lowerRel.includes('/fixtures/') || lowerRel.includes('/__fixtures__/')) return 'fixture';
  if (BINARY_EXTENSIONS.has(ext)) return 'asset';
  if (ext === '.svg') return 'asset';
  if (['.md', '.mdx', '.rst', '.txt'].includes(ext)) return 'doc';
  if (
    ['.json', '.json5', '.yaml', '.yml', '.toml', '.ini', '.conf'].includes(ext)
    || /^(tsconfig|jest|vitest|babel|eslint|prettier|vite|webpack|rollup)\b/i.test(basename)
    || lowerBase === 'package.json'
    || lowerBase === '.gitignore'
    || lowerBase === '.editorconfig'
    || lowerBase === 'dockerfile'
  ) {
    return 'config';
  }
  if (
    [
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.mjs',
      '.cjs',
      '.py',
      '.rb',
      '.go',
      '.rs',
      '.java',
      '.kt',
      '.c',
      '.cpp',
      '.h',
      '.hpp',
      '.cs',
      '.swift',
      '.sh',
      '.bash',
      '.zsh',
      '.css',
      '.scss',
      '.html',
      '.graphql',
      '.sql',
      '.proto',
    ].includes(ext)
  ) {
    return 'code';
  }
  return 'other';
}

function extractPurpose(
  fullPath: string,
  ext: string,
  basename: string,
  maxBytes: number,
): string | undefined {
  let text: string;
  try {
    const fd = fs.openSync(fullPath, 'r');
    try {
      const buf = Buffer.alloc(maxBytes);
      const n = fs.readSync(fd, buf, 0, maxBytes, 0);
      text = buf.slice(0, n).toString('utf-8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return undefined;
  }
  if (!text || /\u0000/.test(text.slice(0, 1024))) return undefined;

  if (ext === '.md' || ext === '.mdx') return purposeFromMarkdown(text);
  if (ext === '.json' || ext === '.json5') return purposeFromJson(text, basename);
  if (ext === '.yaml' || ext === '.yml') return purposeFromYamlOrFrontmatter(text);
  if (isCodeExt(ext)) return purposeFromCodeComment(text);
  return undefined;
}

function isCodeExt(ext: string): boolean {
  return [
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.py',
    '.rb',
    '.go',
    '.rs',
    '.java',
    '.kt',
    '.c',
    '.cpp',
    '.h',
    '.hpp',
    '.cs',
    '.swift',
    '.sh',
    '.bash',
    '.zsh',
    '.css',
    '.scss',
  ].includes(ext);
}

function purposeFromMarkdown(text: string): string | undefined {
  const withoutFrontmatter = stripYamlFrontmatter(text);
  const frontDesc = extractYamlFrontmatterDescription(text);
  const headingMatch = /^\s*#{1,6}\s+(.+?)\s*$/m.exec(withoutFrontmatter);
  const heading = headingMatch ? clean(headingMatch[1]) : undefined;
  if (frontDesc && heading && frontDesc.toLowerCase() !== heading.toLowerCase()) {
    return trimTo(`${heading} — ${frontDesc}`, 180);
  }
  return frontDesc ?? heading;
}

function purposeFromJson(text: string, basename: string): string | undefined {
  const lower = basename.toLowerCase();
  if (lower === 'package.json') {
    try {
      const parsed = JSON.parse(text);
      const desc = typeof parsed?.description === 'string' ? parsed.description : undefined;
      const name = typeof parsed?.name === 'string' ? parsed.name : undefined;
      if (desc) return trimTo(desc, 180);
      if (name) return `package: ${name}`;
    } catch {
      // fall through
    }
    return 'npm package manifest';
  }
  if (/^tsconfig.*\.json$/i.test(basename)) return 'TypeScript compiler config';
  if (/^\.?eslintrc/i.test(basename) || lower === '.eslintrc.json') return 'ESLint config';
  if (/^\.?prettierrc/i.test(basename)) return 'Prettier config';
  if (/^vitest\.config/i.test(basename) || /^jest\.config/i.test(basename)) return 'Test runner config';
  return undefined;
}

function purposeFromYamlOrFrontmatter(text: string): string | undefined {
  const desc = /^\s*description\s*:\s*(.+?)\s*$/im.exec(text);
  if (desc) return clean(desc[1]);
  const name = /^\s*name\s*:\s*(.+?)\s*$/im.exec(text);
  if (name) return `yaml: ${clean(name[1])}`;
  return undefined;
}

function purposeFromCodeComment(text: string): string | undefined {
  // Prefer a top-of-file JSDoc block.
  const topJsDoc = /^\s*\/\*\*([\s\S]*?)\*\//.exec(text);
  if (topJsDoc) {
    const firstLine = extractFirstDocLine(topJsDoc[1]);
    if (firstLine) return trimTo(firstLine, 180);
  }
  // Or top-of-file /* non-JSDoc */ block (but not JSDoc matched above).
  const topBlock = /^\s*\/\*(?!\*)([\s\S]*?)\*\//.exec(text);
  if (topBlock) {
    const firstLine = extractFirstDocLine(topBlock[1]);
    if (firstLine) return trimTo(firstLine, 180);
  }
  const topLineComments = extractTopLineComments(text);
  if (topLineComments) return trimTo(topLineComments, 180);

  // Scan exported declarations in order; use the FIRST exported symbol whose
  // JSDoc is directly adjacent (only whitespace between `*/` and `export`).
  // Skips nested field docs inside interfaces / classes.
  const adjacentExport = findAdjacentExportJsDoc(text);
  if (adjacentExport) {
    const firstLine = extractFirstDocLine(adjacentExport);
    if (firstLine) return trimTo(firstLine, 180);
  }

  // Python-style module docstring.
  const pyDoc = /^(?:from[^\n]*\n|import[^\n]*\n|\s*\n)*\s*"""([\s\S]*?)"""/m.exec(text);
  if (pyDoc) {
    const firstLine = clean(pyDoc[1].split('\n').map((l) => l.trim()).filter(Boolean)[0] ?? '');
    if (firstLine) return trimTo(firstLine, 180);
  }
  return undefined;
}

function findAdjacentExportJsDoc(text: string): string | undefined {
  // Find each JSDoc block individually (tempered pattern so the body can't
  // cross a `*/`), then check whether it is immediately followed by `export`
  // separated only by whitespace/newline. This avoids regex backtracking
  // that would otherwise span multiple nested field-level JSDocs.
  const re = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/([\t ]*)(\r?\n[\t ]*)*/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const tail = text.slice(m.index + m[0].length);
    if (/^export\b/.test(tail)) return m[1];
  }
  return undefined;
}

function extractFirstDocLine(docBody: string): string | undefined {
  const lines = docBody
    .split('\n')
    .map((l) => l.replace(/^\s*\*?\s?/, '').trim())
    .filter((l) => l.length > 0 && !/^@\w+/.test(l));
  if (lines.length === 0) return undefined;
  return clean(lines[0]);
}

function extractTopLineComments(text: string): string | undefined {
  const lines = text.split('\n');
  const buf: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t === '') {
      if (buf.length > 0) break;
      continue;
    }
    const m = /^\/\/\s?(.*)$/.exec(t) ?? /^#\s?(.*)$/.exec(t);
    if (m) {
      buf.push(m[1].trim());
      continue;
    }
    break;
  }
  if (buf.length === 0) return undefined;
  return clean(buf[0]);
}

function stripYamlFrontmatter(text: string): string {
  if (!text.startsWith('---')) return text;
  const end = text.indexOf('\n---', 3);
  if (end < 0) return text;
  return text.slice(end + 4);
}

function extractYamlFrontmatterDescription(text: string): string | undefined {
  if (!text.startsWith('---')) return undefined;
  const end = text.indexOf('\n---', 3);
  if (end < 0) return undefined;
  const fm = text.slice(3, end);
  const match = /^\s*description\s*:\s*(.+?)\s*$/im.exec(fm);
  if (!match) return undefined;
  return clean(match[1]);
}

function inferDirectoryPurpose(
  root: string,
  relDir: string,
  files: ManifestFile[],
): string | undefined {
  // Prefer an in-dir README/AGENTS.md/CLAUDE.md.
  const prefix = relDir === '' ? '' : `${relDir}/`;
  const inDir = files.filter((f) => f.path.startsWith(prefix) && !f.path.slice(prefix.length).includes('/'));
  const docCandidates = ['README.md', 'AGENTS.md', 'CLAUDE.md', 'index.md', 'SKILL.md'];
  for (const cand of docCandidates) {
    const hit = inDir.find((f) => f.path.toLowerCase().endsWith(cand.toLowerCase()));
    if (hit?.purpose) return hit.purpose;
  }
  // Fall back to a package.json description if present.
  const pkg = inDir.find((f) => f.path.toLowerCase().endsWith('package.json'));
  if (pkg?.purpose) return pkg.purpose;
  // Fall back to an index.ts purpose.
  const index = inDir.find((f) => /\/(index)\.(ts|tsx|js|jsx)$/i.test(`/${f.path}`));
  if (index?.purpose) return index.purpose;
  // Ignore root to avoid spamming.
  if (relDir === '') return undefined;
  // Heuristic from directory naming (last segment only).
  const tail = relDir.split('/').pop() ?? relDir;
  return humanize(tail);
}

function humanize(s: string): string {
  return s
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function trimTo(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Patch an existing manifest in place for a single file that was created
 * or modified on disk. Returns true if the manifest changed.
 */
export function applyFileUpsert(
  manifest: WorkspaceManifest,
  absPath: string,
  purposeReadBytes = 4096,
): boolean {
  const rel = toRelPosix(manifest.root, path.resolve(absPath));
  if (!rel || rel.startsWith('..')) return false;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  const ext = path.extname(rel).toLowerCase();
  const basename = path.basename(rel);
  const fileType = classifyFile(rel, basename, ext);
  const language = LANGUAGE_BY_EXT[ext];
  const purpose = BINARY_EXTENSIONS.has(ext)
    ? undefined
    : extractPurpose(absPath, ext, basename, purposeReadBytes);
  const next: ManifestFile = {
    path: rel,
    fileType,
    language,
    purpose,
    sizeBytes: stat.size,
  };
  const existing = manifest.files.findIndex((f) => f.path === rel);
  if (existing >= 0) {
    manifest.files[existing] = next;
    refreshDirectoryPurposes(manifest, rel);
    return true;
  }
  manifest.files.push(next);
  manifest.files.sort((a, b) => a.path.localeCompare(b.path));
  ensureDirectoryChain(manifest, rel);
  refreshDirectoryPurposes(manifest, rel);
  manifest.generatedAt = new Date().toISOString();
  return true;
}

/** Remove a file entry. Returns true if it was present. */
export function applyFileDelete(manifest: WorkspaceManifest, absPath: string): boolean {
  const rel = toRelPosix(manifest.root, path.resolve(absPath));
  if (!rel) return false;
  const idx = manifest.files.findIndex((f) => f.path === rel);
  if (idx < 0) return false;
  manifest.files.splice(idx, 1);
  decrementDirectoryChain(manifest, rel);
  refreshDirectoryPurposes(manifest, rel);
  manifest.generatedAt = new Date().toISOString();
  return true;
}

function ensureDirectoryChain(manifest: WorkspaceManifest, rel: string): void {
  const parts = rel.split('/');
  parts.pop();
  const chain: string[] = [''];
  for (let i = 0; i < parts.length; i += 1) {
    chain.push(parts.slice(0, i + 1).join('/'));
  }
  const byPath = new Map(manifest.directories.map((d) => [d.path, d]));
  for (const dirPath of chain) {
    let dir = byPath.get(dirPath);
    if (!dir) {
      dir = { path: dirPath, fileCount: 0, subdirCount: 0 };
      manifest.directories.push(dir);
      byPath.set(dirPath, dir);
    }
  }
  // Recompute counts.
  recomputeDirectoryCounts(manifest);
  manifest.directories.sort((a, b) => a.path.localeCompare(b.path));
}

function decrementDirectoryChain(manifest: WorkspaceManifest, _rel: string): void {
  recomputeDirectoryCounts(manifest);
}

function recomputeDirectoryCounts(manifest: WorkspaceManifest): void {
  const counts = new Map<string, { fileCount: number; subdirs: Set<string> }>();
  for (const dir of manifest.directories) {
    counts.set(dir.path, { fileCount: 0, subdirs: new Set() });
  }
  for (const file of manifest.files) {
    const parent = parentDir(file.path);
    let info = counts.get(parent);
    if (!info) {
      info = { fileCount: 0, subdirs: new Set() };
      counts.set(parent, info);
    }
    info.fileCount += 1;
  }
  for (const dir of manifest.directories) {
    if (dir.path === '') continue;
    const parent = parentDir(dir.path);
    let info = counts.get(parent);
    if (!info) {
      info = { fileCount: 0, subdirs: new Set() };
      counts.set(parent, info);
    }
    info.subdirs.add(dir.path);
  }
  for (const dir of manifest.directories) {
    const info = counts.get(dir.path);
    if (!info) continue;
    dir.fileCount = info.fileCount;
    dir.subdirCount = info.subdirs.size;
  }
}

function parentDir(rel: string): string {
  const idx = rel.lastIndexOf('/');
  return idx < 0 ? '' : rel.slice(0, idx);
}

function refreshDirectoryPurposes(manifest: WorkspaceManifest, rel: string): void {
  // Only refresh the direct ancestors of the changed file.
  const parts = rel.split('/');
  const chain: string[] = [''];
  for (let i = 0; i < parts.length - 1; i += 1) {
    chain.push(parts.slice(0, i + 1).join('/'));
  }
  for (const dirPath of chain) {
    const dir = manifest.directories.find((d) => d.path === dirPath);
    if (!dir) continue;
    dir.purpose = inferDirectoryPurpose(manifest.root, dirPath, manifest.files);
  }
}
