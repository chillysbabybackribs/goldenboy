import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  RepoMapService,
  describeFileInMap,
  findSymbolsInMap,
  neighborsOfFile,
} from './repoMapService';
import { applyMutations } from './buildRepoMap';

function makeTempRepo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repomap-svc-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, 'utf8');
  }
  return root;
}

describe('RepoMapService', () => {
  it('caches the map across calls and refreshes on demand', async () => {
    const root = makeTempRepo({
      'a.ts': 'export const a = 1;',
    });
    try {
      const svc = new RepoMapService();
      const first = await svc.getMap(root);
      const second = await svc.getMap(root);
      expect(second).toBe(first);

      fs.writeFileSync(path.join(root, 'b.ts'), 'export const b = 2;\n', 'utf8');
      const stillCached = await svc.getMap(root);
      expect(stillCached.map.fileCount).toBe(1);

      const refreshed = await svc.refresh(root);
      expect(refreshed.map.fileCount).toBe(2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('deduplicates concurrent builds for the same root', async () => {
    const root = makeTempRepo({ 'a.ts': 'export const a = 1;' });
    try {
      const svc = new RepoMapService();
      const [a, b, c] = await Promise.all([
        svc.getMap(root),
        svc.getMap(root),
        svc.getMap(root),
      ]);
      expect(a).toBe(b);
      expect(b).toBe(c);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('expires after TTL', async () => {
    const root = makeTempRepo({ 'a.ts': 'export const a = 1;' });
    try {
      const svc = new RepoMapService({ ttlMs: 1 });
      const first = await svc.getMap(root);
      await new Promise((r) => setTimeout(r, 5));
      const second = await svc.getMap(root);
      expect(second).not.toBe(first);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('findSymbolsInMap', () => {
  it('prefers exact (case-insensitive) matches over substring matches', async () => {
    const root = makeTempRepo({
      'a.ts': 'export function build(): void {}',
      'b.ts': 'export function buildTaskProfile(): void {}',
    });
    try {
      const svc = new RepoMapService();
      const entry = await svc.getMap(root);
      const matches = findSymbolsInMap(entry.map, { name: 'build' });
      expect(matches[0].name).toBe('build');
      expect(matches.map((m) => m.name)).toEqual(
        expect.arrayContaining(['build', 'buildTaskProfile']),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('filters by kind and pathPrefix', async () => {
    const root = makeTempRepo({
      'pkg1/a.ts': 'export interface Thing {} export const thing = 1;',
      'pkg2/a.ts': 'export interface Thing {} export const thing = 2;',
    });
    try {
      const svc = new RepoMapService();
      const entry = await svc.getMap(root);
      const only = findSymbolsInMap(entry.map, {
        name: 'Thing',
        kind: 'interface',
        pathPrefix: 'pkg1/',
      });
      expect(only).toHaveLength(1);
      expect(only[0].file).toBe('pkg1/a.ts');
      expect(only[0].kind).toBe('interface');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('neighborsOfFile', () => {
  it('BFS walks the import graph by direction and depth', async () => {
    const root = makeTempRepo({
      'leaf.ts': 'export const leaf = 1;',
      'mid.ts': "import { leaf } from './leaf'; export const mid = leaf + 1;",
      'top.ts': "import { mid } from './mid'; export const top = mid + 1;",
    });
    try {
      const svc = new RepoMapService();
      const entry = await svc.getMap(root);
      const { root: rootFile, neighbors } = neighborsOfFile(entry.map, 'leaf.ts', {
        direction: 'in',
        depth: 2,
      });
      expect(rootFile?.path).toBe('leaf.ts');
      const paths = neighbors.map((n) => n.path).sort();
      expect(paths).toEqual(['mid.ts', 'top.ts']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns null root when file is not in the map', async () => {
    const root = makeTempRepo({ 'a.ts': 'export const a = 1;' });
    try {
      const svc = new RepoMapService();
      const entry = await svc.getMap(root);
      const { root: rootFile, neighbors } = neighborsOfFile(entry.map, 'nope.ts');
      expect(rootFile).toBeNull();
      expect(neighbors).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('describeFileInMap', () => {
  it('returns the file record or null', async () => {
    const root = makeTempRepo({ 'a.ts': 'export const a = 1;' });
    try {
      const svc = new RepoMapService();
      const entry = await svc.getMap(root);
      expect(describeFileInMap(entry.map, 'a.ts')?.path).toBe('a.ts');
      expect(describeFileInMap(entry.map, 'missing.ts')).toBeNull();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('applyMutations', () => {
  it('adds a new file and registers its symbols and edges', async () => {
    const root = makeTempRepo({
      'hub.ts': 'export const hub = 1;',
    });
    try {
      const svc = new RepoMapService();
      const entry = await svc.getMap(root);
      expect(entry.map.fileCount).toBe(1);

      fs.writeFileSync(
        path.join(root, 'leaf.ts'),
        "import { hub } from './hub'; export const leaf = hub + 1;\n",
      );
      const outcome = applyMutations(entry.map, [
        { kind: 'upsert', absPath: path.join(root, 'leaf.ts') },
      ]);
      expect(outcome.added).toEqual(['leaf.ts']);
      expect(entry.map.fileCount).toBe(2);
      const hub = entry.map.files.find((f) => f.path === 'hub.ts');
      expect(hub?.importedBy).toEqual(['leaf.ts']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('removes a deleted file and rewires dependents', async () => {
    const root = makeTempRepo({
      'hub.ts': 'export const hub = 1;',
      'leaf.ts': "import { hub } from './hub'; export const leaf = hub + 1;",
    });
    try {
      const svc = new RepoMapService();
      const entry = await svc.getMap(root);
      expect(entry.map.fileCount).toBe(2);
      fs.rmSync(path.join(root, 'leaf.ts'));
      const outcome = applyMutations(entry.map, [
        { kind: 'delete', absPath: path.join(root, 'leaf.ts') },
      ]);
      expect(outcome.removed).toEqual(['leaf.ts']);
      expect(entry.map.fileCount).toBe(1);
      const hub = entry.map.files.find((f) => f.path === 'hub.ts');
      expect(hub?.importedBy).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('updates symbols when a tracked file changes', async () => {
    const root = makeTempRepo({
      'a.ts': 'export const oldName = 1;',
    });
    try {
      const svc = new RepoMapService();
      const entry = await svc.getMap(root);
      expect(entry.map.files[0].symbols.map((s) => s.name)).toEqual(['oldName']);
      fs.writeFileSync(path.join(root, 'a.ts'), 'export const newName = 2;\n');
      const outcome = applyMutations(entry.map, [
        { kind: 'upsert', absPath: path.join(root, 'a.ts') },
      ]);
      expect(outcome.updated).toEqual(['a.ts']);
      expect(entry.map.files[0].symbols.map((s) => s.name)).toEqual(['newName']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('ignores mutations outside the map root or with disallowed extensions', async () => {
    const root = makeTempRepo({ 'a.ts': 'export const a = 1;' });
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
    try {
      const svc = new RepoMapService();
      const entry = await svc.getMap(root);
      fs.writeFileSync(path.join(outside, 'x.ts'), 'export const x = 1;');
      fs.writeFileSync(path.join(root, 'readme.md'), '# readme');
      const outcome = applyMutations(entry.map, [
        { kind: 'upsert', absPath: path.join(outside, 'x.ts') },
        { kind: 'upsert', absPath: path.join(root, 'readme.md') },
      ]);
      expect(outcome.added).toEqual([]);
      expect(outcome.ignored.length).toBe(2);
      expect(entry.map.fileCount).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('RepoMapService auto-invalidation', () => {
  it('noteFileChanged reflects new symbols without explicit refresh', async () => {
    const root = makeTempRepo({ 'a.ts': 'export const alpha = 1;' });
    try {
      const svc = new RepoMapService();
      const entry = await svc.getMap(root);
      const first = entry.map.files[0].symbols.map((s) => s.name);
      expect(first).toEqual(['alpha']);

      fs.writeFileSync(path.join(root, 'a.ts'), 'export const alpha = 1;\nexport const beta = 2;\n');
      svc.noteFileChanged(path.join(root, 'a.ts'));

      const after = await svc.getMap(root);
      const names = after.map.files[0].symbols.map((s) => s.name);
      expect(names.sort()).toEqual(['alpha', 'beta']);
      expect(after).toBe(entry);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('noteFileChanged also picks up newly created files', async () => {
    const root = makeTempRepo({ 'a.ts': 'export const a = 1;' });
    try {
      const svc = new RepoMapService();
      const entry = await svc.getMap(root);
      expect(entry.map.fileCount).toBe(1);
      fs.writeFileSync(path.join(root, 'b.ts'), 'export const b = 2;');
      svc.noteFileChanged(path.join(root, 'b.ts'));
      expect(entry.map.fileCount).toBe(2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('noteFileDeleted removes a file from cached maps', async () => {
    const root = makeTempRepo({
      'a.ts': 'export const a = 1;',
      'b.ts': 'export const b = 2;',
    });
    try {
      const svc = new RepoMapService();
      const entry = await svc.getMap(root);
      expect(entry.map.fileCount).toBe(2);
      fs.rmSync(path.join(root, 'b.ts'));
      svc.noteFileDeleted(path.join(root, 'b.ts'));
      expect(entry.map.fileCount).toBe(1);
      expect(entry.map.files[0].path).toBe('a.ts');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('noteFileMoved applies delete(from) + upsert(to) atomically', async () => {
    const root = makeTempRepo({
      'old.ts': 'export const old = 1;',
      'user.ts': "import { old } from './old'; export const user = old;",
    });
    try {
      const svc = new RepoMapService();
      const entry = await svc.getMap(root);
      expect(entry.map.fileCount).toBe(2);
      fs.renameSync(path.join(root, 'old.ts'), path.join(root, 'renamed.ts'));
      svc.noteFileMoved(path.join(root, 'old.ts'), path.join(root, 'renamed.ts'));
      const paths = entry.map.files.map((f) => f.path).sort();
      expect(paths).toEqual(['renamed.ts', 'user.ts']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('notifications for files outside any cached root are no-ops', async () => {
    const root = makeTempRepo({ 'a.ts': 'export const a = 1;' });
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-note-'));
    try {
      const svc = new RepoMapService();
      const entry = await svc.getMap(root);
      fs.writeFileSync(path.join(outside, 'x.ts'), 'export const x = 1;');
      const outcomes = svc.noteFileChanged(path.join(outside, 'x.ts'));
      expect(outcomes).toEqual([]);
      expect(entry.map.fileCount).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
