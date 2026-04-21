import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildRepoMap } from './buildRepoMap';
import { renderRepoMap } from './renderRepoMap';

function makeTempRepo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-map-test-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, 'utf8');
  }
  return root;
}

describe('buildRepoMap', () => {
  it('extracts exported symbols with signatures and kinds', () => {
    const root = makeTempRepo({
      'a.ts': [
        'export interface User { id: string; name: string }',
        'export type Id = string;',
        'export const VERSION = 1;',
        'export function greet(name: string): string { return `hi ${name}`; }',
        'export class Service { constructor() {} run() {} }',
        'function notExported() {}',
      ].join('\n'),
    });

    const map = buildRepoMap({ root });
    const file = map.files.find((f) => f.path === 'a.ts');
    expect(file).toBeDefined();
    const names = file!.symbols.map((s) => s.name);
    expect(names).toEqual(['User', 'Id', 'VERSION', 'greet', 'Service']);
    expect(file!.symbols.find((s) => s.name === 'greet')?.kind).toBe('function');
    expect(file!.symbols.find((s) => s.name === 'Service')?.signature).toContain(
      'class Service',
    );
  });

  it('resolves relative imports across extensions and index files', () => {
    const root = makeTempRepo({
      'src/index.ts': [
        "import { a } from './util/a';",
        "import { b } from './util';",
        "export const entry = a + b;",
      ].join('\n'),
      'src/util/a.ts': 'export const a = 1;',
      'src/util/index.ts': "export const b = 2;",
    });

    const map = buildRepoMap({ root });
    const index = map.files.find((f) => f.path === 'src/index.ts')!;
    expect(index.imports).toEqual(
      expect.arrayContaining(['src/util/a.ts', 'src/util/index.ts']),
    );
    const a = map.files.find((f) => f.path === 'src/util/a.ts')!;
    expect(a.importedBy).toEqual(['src/index.ts']);
  });

  it('ranks hub files above leaves via PageRank', () => {
    const root = makeTempRepo({
      'hub.ts': 'export const hub = 1;',
      'leafA.ts': "import { hub } from './hub'; export const a = hub;",
      'leafB.ts': "import { hub } from './hub'; export const b = hub;",
      'leafC.ts': "import { hub } from './hub'; export const c = hub;",
    });

    const map = buildRepoMap({ root });
    expect(map.files[0].path).toBe('hub.ts');
    const hub = map.files[0];
    const leaf = map.files.find((f) => f.path === 'leafA.ts')!;
    expect(hub.score).toBeGreaterThan(leaf.score);
  });

  it('renders a non-empty markdown map', () => {
    const root = makeTempRepo({
      'app.ts': [
        "import { add } from './math';",
        '',
        '/** Entry point. */',
        'export function main(): number { return add(1, 2); }',
      ].join('\n'),
      'math.ts': 'export function add(a: number, b: number): number { return a + b; }',
    });

    const map = buildRepoMap({ root });
    const rendered = renderRepoMap(map, { maxSymbolsPerFile: 5 });
    expect(rendered).toContain('## `math.ts`');
    expect(rendered).toContain('function add(a: number, b: number): number');
    expect(rendered).toContain('function main()');
    expect(rendered).toContain('↳ Entry point.');
  });
});
