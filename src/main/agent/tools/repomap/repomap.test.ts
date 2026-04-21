import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('electron', () => ({
  app: {
    getPath: () => process.env.V2_TEST_USER_DATA || os.tmpdir(),
  },
}));
import type { AgentToolContext, AgentToolDefinition } from '../../AgentTypes';
import { createRepoMapToolDefinitions } from './index';
import { createFilesystemToolDefinitions } from '../filesystem';
import { repoMapService } from '../../repoMap';

function makeTempRepo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repomap-tool-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, 'utf8');
  }
  return root;
}

function rmRepo(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}

function getTool(name: string): AgentToolDefinition {
  const tool = createRepoMapToolDefinitions().find((t) => t.name === name);
  if (!tool) throw new Error(`tool not registered: ${name}`);
  return tool;
}

const context: AgentToolContext = {
  runId: 'test-run',
  agentId: 'test-agent',
  mode: 'unrestricted-dev',
};

let repoRoot: string;

beforeEach(() => {
  repoMapService.clear();
  repoRoot = makeTempRepo({
    'src/hub.ts': 'export const hub = 1; export function boot(): void {}',
    'src/leaf/a.ts': [
      "import { hub } from '../hub';",
      '/** First leaf. */',
      'export function runA(): number { return hub; }',
    ].join('\n'),
    'src/leaf/b.ts': [
      "import { hub } from '../hub';",
      'export function runB(): number { return hub + 1; }',
    ].join('\n'),
    'src/unrelated.ts': 'export interface Unrelated { id: string }',
  });
});

afterEach(() => {
  rmRepo(repoRoot);
  repoMapService.clear();
});

describe('repomap tools', () => {
  it('repomap.overview returns a ranked markdown map and structured files', async () => {
    const tool = getTool('repomap.overview');
    const result = await tool.execute({ root: repoRoot, maxFiles: 10 }, context);

    expect(result.summary).toMatch(/Repo map/);
    const data = result.data as {
      meta: { fileCount: number; buildMs: number };
      map: string;
      topFiles: Array<{ path: string; rank: number }>;
    };
    expect(data.meta.fileCount).toBe(4);
    expect(data.map).toContain('## `src/hub.ts`');
    expect(data.topFiles[0].path).toBe('src/hub.ts');
    expect(data.topFiles[0].rank).toBeGreaterThan(data.topFiles[1].rank);
  });

  it('repomap.find_symbol returns file:line hits ranked by exactness then PageRank', async () => {
    const tool = getTool('repomap.find_symbol');
    const result = await tool.execute({ root: repoRoot, name: 'run' }, context);

    const data = result.data as {
      matches: Array<{ name: string; file: string; line: number; kind: string }>;
    };
    const names = data.matches.map((m) => m.name).sort();
    expect(names).toEqual(['runA', 'runB']);
    for (const m of data.matches) expect(m.kind).toBe('function');
    const runA = data.matches.find((m) => m.name === 'runA');
    expect(runA?.file).toBe('src/leaf/a.ts');
    expect(runA?.line).toBeGreaterThanOrEqual(1);
  });

  it('repomap.find_symbol honors exact match and kind filter', async () => {
    const tool = getTool('repomap.find_symbol');
    const result = await tool.execute(
      { root: repoRoot, name: 'hub', exact: true, kind: 'const' },
      context,
    );
    const data = result.data as {
      matches: Array<{ name: string; kind: string }>;
    };
    expect(data.matches).toHaveLength(1);
    expect(data.matches[0].name).toBe('hub');
    expect(data.matches[0].kind).toBe('const');
  });

  it('repomap.describe_file returns symbols, imports, dependents', async () => {
    const tool = getTool('repomap.describe_file');
    const result = await tool.execute(
      { root: repoRoot, path: 'src/hub.ts' },
      context,
    );
    const data = result.data as {
      found: boolean;
      file: {
        symbols: Array<{ name: string }>;
        imports: string[];
        importedBy: string[];
      };
    };
    expect(data.found).toBe(true);
    const names = data.file.symbols.map((s) => s.name).sort();
    expect(names).toEqual(['boot', 'hub']);
    expect(data.file.importedBy.sort()).toEqual(['src/leaf/a.ts', 'src/leaf/b.ts']);
    expect(data.file.imports).toEqual([]);
  });

  it('repomap.describe_file suggests near matches for unknown paths', async () => {
    const tool = getTool('repomap.describe_file');
    const result = await tool.execute(
      { root: repoRoot, path: 'src/leaf/missing.ts' },
      context,
    );
    const data = result.data as { found: boolean; suggestions: string[] };
    expect(data.found).toBe(false);
    expect(data.suggestions).toEqual(expect.arrayContaining([]));
  });

  it('repomap.neighbors walks "in" direction to surface dependents', async () => {
    const tool = getTool('repomap.neighbors');
    const result = await tool.execute(
      { root: repoRoot, path: 'src/hub.ts', direction: 'in', depth: 1 },
      context,
    );
    const data = result.data as {
      found: boolean;
      neighbors: Array<{ path: string; direction: string; depth: number }>;
    };
    expect(data.found).toBe(true);
    const paths = data.neighbors.map((n) => n.path).sort();
    expect(paths).toEqual(['src/leaf/a.ts', 'src/leaf/b.ts']);
    for (const n of data.neighbors) {
      expect(n.direction).toBe('in');
      expect(n.depth).toBe(1);
    }
  });

  it('repomap.neighbors walks "out" direction to surface dependencies', async () => {
    const tool = getTool('repomap.neighbors');
    const result = await tool.execute(
      { root: repoRoot, path: 'src/leaf/a.ts', direction: 'out', depth: 1 },
      context,
    );
    const data = result.data as {
      neighbors: Array<{ path: string; direction: string }>;
    };
    expect(data.neighbors).toHaveLength(1);
    expect(data.neighbors[0].path).toBe('src/hub.ts');
    expect(data.neighbors[0].direction).toBe('out');
  });

  it('repomap.refresh rebuilds the cached map', async () => {
    const overview = getTool('repomap.overview');
    const refresh = getTool('repomap.refresh');

    const first = await overview.execute({ root: repoRoot }, context);
    const firstMeta = (first.data as { meta: { fileCount: number } }).meta;
    expect(firstMeta.fileCount).toBe(4);

    fs.writeFileSync(
      path.join(repoRoot, 'src/extra.ts'),
      'export const extra = true;\n',
      'utf8',
    );

    const stillCached = await overview.execute({ root: repoRoot }, context);
    expect((stillCached.data as { meta: { fileCount: number } }).meta.fileCount).toBe(4);

    const refreshed = await refresh.execute({ root: repoRoot }, context);
    const afterRefresh = (refreshed.data as { meta: { fileCount: number } }).meta;
    expect(afterRefresh.fileCount).toBe(5);

    const fresh = await overview.execute({ root: repoRoot }, context);
    expect((fresh.data as { meta: { fileCount: number } }).meta.fileCount).toBe(5);
  });

  it('rejects unknown root paths', async () => {
    const tool = getTool('repomap.overview');
    await expect(
      tool.execute({ root: path.join(repoRoot, 'does-not-exist') }, context),
    ).rejects.toThrow(/does not exist/);
  });

  it('auto-invalidates when filesystem.write creates a file inside a cached root', async () => {
    const overview = getTool('repomap.overview');
    const find = getTool('repomap.find_symbol');
    const write = createFilesystemToolDefinitions().find((t) => t.name === 'filesystem.write')!;

    await overview.execute({ root: repoRoot }, context);

    const newFile = path.join(repoRoot, 'src/fresh.ts');
    await write.execute(
      { path: newFile, content: 'export function freshlyAdded(): number { return 42; }\n' },
      context,
    );

    const result = await find.execute(
      { root: repoRoot, name: 'freshlyAdded', exact: true },
      context,
    );
    const data = result.data as { matches: Array<{ name: string; file: string }> };
    expect(data.matches).toHaveLength(1);
    expect(data.matches[0].name).toBe('freshlyAdded');
    expect(data.matches[0].file).toBe('src/fresh.ts');
  });

  it('auto-invalidates when filesystem.delete removes a tracked file', async () => {
    const overview = getTool('repomap.overview');
    const find = getTool('repomap.find_symbol');
    const del = createFilesystemToolDefinitions().find((t) => t.name === 'filesystem.delete')!;

    await overview.execute({ root: repoRoot }, context);
    const before = await find.execute({ root: repoRoot, name: 'runA', exact: true }, context);
    expect((before.data as { matches: unknown[] }).matches).toHaveLength(1);

    await del.execute({ path: path.join(repoRoot, 'src/leaf/a.ts') }, context);

    const after = await find.execute({ root: repoRoot, name: 'runA', exact: true }, context);
    expect((after.data as { matches: unknown[] }).matches).toHaveLength(0);
  });

  it('auto-invalidates when filesystem.patch edits a tracked file', async () => {
    const overview = getTool('repomap.overview');
    const find = getTool('repomap.find_symbol');
    const patch = createFilesystemToolDefinitions().find((t) => t.name === 'filesystem.patch')!;

    await overview.execute({ root: repoRoot }, context);

    await patch.execute(
      {
        path: path.join(repoRoot, 'src/hub.ts'),
        search: 'export function boot(): void {}',
        replace: 'export function bootRenamed(): void {}',
      },
      context,
    );

    const result = await find.execute(
      { root: repoRoot, name: 'bootRenamed', exact: true },
      context,
    );
    expect((result.data as { matches: unknown[] }).matches).toHaveLength(1);
    const stale = await find.execute(
      { root: repoRoot, name: 'boot', exact: true },
      context,
    );
    expect((stale.data as { matches: unknown[] }).matches).toHaveLength(0);
  });
});
