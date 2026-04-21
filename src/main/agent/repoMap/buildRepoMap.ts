import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';

export type SymbolKind =
  | 'class'
  | 'function'
  | 'interface'
  | 'type'
  | 'const'
  | 'enum';

export interface RepoSymbol {
  name: string;
  kind: SymbolKind;
  signature: string;
  exported: boolean;
  line: number;
  /** Short one-line leading JSDoc summary, if any. */
  doc?: string;
}

export interface RepoFile {
  /** Path relative to the repo root, using forward slashes. */
  path: string;
  /** Count of source lines (incl. blanks/comments). */
  lines: number;
  /** Top-level declarations in source order. */
  symbols: RepoSymbol[];
  /** Resolved relative paths of in-repo imports. */
  imports: string[];
  /** Raw module specifiers that couldn't be resolved (npm pkgs, node:*). */
  externalImports: string[];
  /** Populated after graph build. */
  importedBy: string[];
  /** PageRank score in [0, 1]. */
  score: number;
}

export interface RepoMap {
  root: string;
  generatedAt: string;
  fileCount: number;
  totalLines: number;
  files: RepoFile[];
}

export interface BuildRepoMapOptions {
  /** Absolute path to the directory to scan. */
  root: string;
  /** Glob-ish extension allow-list. Default: .ts, .tsx */
  extensions?: string[];
  /** Directory names to skip anywhere in the tree. */
  skipDirs?: string[];
  /** PageRank damping factor. Default 0.85 */
  damping?: number;
  /** PageRank iterations. Default 30 */
  iterations?: number;
  /** If true, include non-exported top-level symbols too. Default false. */
  includePrivate?: boolean;
}

const DEFAULT_SKIP = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
]);

export function buildRepoMap(options: BuildRepoMapOptions): RepoMap {
  const {
    root,
    extensions = ['.ts', '.tsx'],
    skipDirs,
    damping = 0.85,
    iterations = 30,
    includePrivate = false,
  } = options;

  const absRoot = path.resolve(root);
  const skip = new Set([...DEFAULT_SKIP, ...(skipDirs ?? [])]);
  const files = walk(absRoot, extensions, skip);

  const parsed: RepoFile[] = files.map((abs) =>
    parseFile(abs, absRoot, includePrivate),
  );

  const byPath = new Map(parsed.map((f) => [f.path, f]));
  resolveImports(parsed, byPath, absRoot);
  populateImportedBy(parsed, byPath);

  const scores = pageRank(parsed, byPath, damping, iterations);
  for (const file of parsed) {
    file.score = scores.get(file.path) ?? 0;
  }

  parsed.sort((a, b) => b.score - a.score);

  return {
    root: absRoot,
    generatedAt: new Date().toISOString(),
    fileCount: parsed.length,
    totalLines: parsed.reduce((acc, f) => acc + f.lines, 0),
    files: parsed,
  };
}

export type FileMutation =
  | { kind: 'upsert'; absPath: string }
  | { kind: 'delete'; absPath: string };

export interface ApplyMutationsOptions {
  damping?: number;
  iterations?: number;
  extensions?: string[];
  includePrivate?: boolean;
}

export interface MutationOutcome {
  /** Paths (relative to map root) that were added. */
  added: string[];
  /** Paths (relative to map root) that were removed. */
  removed: string[];
  /** Paths (relative to map root) whose symbols or imports changed. */
  updated: string[];
  /** Paths skipped because they fell outside the map root or extension allow-list. */
  ignored: string[];
}

/**
 * Apply a batch of per-file mutations to a map in-place. Reparses only the
 * affected files, then rebuilds `importedBy` and PageRank scores across the
 * whole map (both are O(n) and sub-ms for typical codebases).
 */
export function applyMutations(
  map: RepoMap,
  mutations: FileMutation[],
  options: ApplyMutationsOptions = {},
): MutationOutcome {
  const {
    damping = 0.85,
    iterations = 30,
    extensions = ['.ts', '.tsx'],
    includePrivate = false,
  } = options;

  const outcome: MutationOutcome = {
    added: [],
    removed: [],
    updated: [],
    ignored: [],
  };
  if (mutations.length === 0) return outcome;

  const byPath = new Map(map.files.map((f) => [f.path, f] as const));

  for (const mutation of mutations) {
    const relPath = relativeInRoot(map.root, mutation.absPath);
    if (relPath === null) {
      outcome.ignored.push(mutation.absPath);
      continue;
    }
    if (!hasAllowedExtension(relPath, extensions)) {
      outcome.ignored.push(relPath);
      continue;
    }

    const existing = byPath.get(relPath);

    if (mutation.kind === 'delete' || !fs.existsSync(mutation.absPath)) {
      if (!existing) continue;
      byPath.delete(relPath);
      outcome.removed.push(relPath);
      continue;
    }

    const parsed = parseFile(mutation.absPath, map.root, includePrivate);
    if (existing) {
      byPath.set(relPath, parsed);
      outcome.updated.push(relPath);
    } else {
      byPath.set(relPath, parsed);
      outcome.added.push(relPath);
    }
  }

  if (outcome.added.length === 0 && outcome.removed.length === 0 && outcome.updated.length === 0) {
    return outcome;
  }

  const files = Array.from(byPath.values());
  for (const file of files) {
    file.importedBy = [];
  }
  resolveImports(files, byPath, map.root);
  populateImportedBy(files, byPath);

  const scores = pageRank(files, byPath, damping, iterations);
  for (const file of files) {
    file.score = scores.get(file.path) ?? 0;
  }
  files.sort((a, b) => b.score - a.score);

  map.files = files;
  map.fileCount = files.length;
  map.totalLines = files.reduce((acc, f) => acc + f.lines, 0);
  map.generatedAt = new Date().toISOString();
  return outcome;
}

function relativeInRoot(rootAbs: string, absPath: string): string | null {
  const resolvedRoot = path.resolve(rootAbs);
  const resolvedPath = path.resolve(absPath);
  const rel = path.relative(resolvedRoot, resolvedPath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return toPosix(rel);
}

function hasAllowedExtension(relPath: string, exts: string[]): boolean {
  if (relPath.endsWith('.d.ts')) return false;
  return exts.some((e) => relPath.endsWith(e));
}

function walk(root: string, exts: string[], skip: Set<string>): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue;
        stack.push(full);
      } else if (entry.isFile()) {
        if (exts.some((e) => entry.name.endsWith(e))) {
          if (entry.name.endsWith('.d.ts')) continue;
          out.push(full);
        }
      }
    }
  }
  return out.sort();
}

function parseFile(
  absPath: string,
  absRoot: string,
  includePrivate: boolean,
): RepoFile {
  const source = fs.readFileSync(absPath, 'utf8');
  const rel = toPosix(path.relative(absRoot, absPath));
  const sf = ts.createSourceFile(
    absPath,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    absPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const symbols: RepoSymbol[] = [];
  const imports: string[] = [];
  const externalImports: string[] = [];

  for (const stmt of sf.statements) {
    collectImport(stmt, imports, externalImports);
    const extracted = collectSymbol(stmt, sf, includePrivate);
    if (extracted) symbols.push(extracted);
  }

  return {
    path: rel,
    lines: source.split('\n').length,
    symbols,
    imports,
    externalImports,
    importedBy: [],
    score: 0,
  };
}

function collectImport(
  stmt: ts.Statement,
  imports: string[],
  externalImports: string[],
): void {
  if (!ts.isImportDeclaration(stmt)) return;
  const specifier = stmt.moduleSpecifier;
  if (!ts.isStringLiteral(specifier)) return;
  const text = specifier.text;
  if (text.startsWith('.') || text.startsWith('/')) {
    imports.push(text);
  } else {
    externalImports.push(text);
  }
}

function collectSymbol(
  stmt: ts.Statement,
  sf: ts.SourceFile,
  includePrivate: boolean,
): RepoSymbol | null {
  const exported = hasExportModifier(stmt);
  if (!exported && !includePrivate) return null;

  const line = sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1;
  const doc = leadingJSDocSummary(stmt, sf);

  if (ts.isClassDeclaration(stmt) && stmt.name) {
    return {
      name: stmt.name.text,
      kind: 'class',
      signature: classSignature(stmt),
      exported,
      line,
      doc,
    };
  }
  if (ts.isFunctionDeclaration(stmt) && stmt.name) {
    return {
      name: stmt.name.text,
      kind: 'function',
      signature: functionSignature(stmt, sf),
      exported,
      line,
      doc,
    };
  }
  if (ts.isInterfaceDeclaration(stmt)) {
    return {
      name: stmt.name.text,
      kind: 'interface',
      signature: interfaceSignature(stmt),
      exported,
      line,
      doc,
    };
  }
  if (ts.isTypeAliasDeclaration(stmt)) {
    return {
      name: stmt.name.text,
      kind: 'type',
      signature: `type ${stmt.name.text}`,
      exported,
      line,
      doc,
    };
  }
  if (ts.isEnumDeclaration(stmt)) {
    return {
      name: stmt.name.text,
      kind: 'enum',
      signature: `enum ${stmt.name.text}`,
      exported,
      line,
      doc,
    };
  }
  if (ts.isVariableStatement(stmt)) {
    const decl = stmt.declarationList.declarations[0];
    if (!decl || !ts.isIdentifier(decl.name)) return null;
    const name = decl.name.text;
    const kind: SymbolKind =
      decl.initializer &&
      (ts.isArrowFunction(decl.initializer) ||
        ts.isFunctionExpression(decl.initializer))
        ? 'function'
        : 'const';
    return {
      name,
      kind,
      signature: variableSignature(stmt, decl, sf),
      exported,
      line,
      doc,
    };
  }
  return null;
}

function hasExportModifier(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node)
    ? ts.getModifiers(node)
    : undefined;
  return !!modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function classSignature(stmt: ts.ClassDeclaration): string {
  const name = stmt.name?.text ?? '<anonymous>';
  const heritage = (stmt.heritageClauses ?? [])
    .map((clause) => {
      const keyword =
        clause.token === ts.SyntaxKind.ExtendsKeyword ? 'extends' : 'implements';
      const types = clause.types.map((t) => t.expression.getText()).join(', ');
      return `${keyword} ${types}`;
    })
    .join(' ');
  const members = stmt.members
    .map((m) => memberLabel(m))
    .filter((x): x is string => !!x);
  const memberSummary = members.length
    ? ` { ${members.slice(0, 8).join(', ')}${members.length > 8 ? ', ...' : ''} }`
    : '';
  return `class ${name}${heritage ? ` ${heritage}` : ''}${memberSummary}`;
}

function memberLabel(m: ts.ClassElement): string | null {
  if (ts.isConstructorDeclaration(m)) return 'constructor()';
  if (
    (ts.isMethodDeclaration(m) ||
      ts.isGetAccessorDeclaration(m) ||
      ts.isSetAccessorDeclaration(m)) &&
    m.name &&
    ts.isIdentifier(m.name)
  ) {
    const isStatic = (ts.getModifiers(m) ?? []).some(
      (mod) => mod.kind === ts.SyntaxKind.StaticKeyword,
    );
    return `${isStatic ? 'static ' : ''}${m.name.text}()`;
  }
  if (ts.isPropertyDeclaration(m) && m.name && ts.isIdentifier(m.name)) {
    return m.name.text;
  }
  return null;
}

function functionSignature(
  stmt: ts.FunctionDeclaration,
  sf: ts.SourceFile,
): string {
  const name = stmt.name?.text ?? '<anonymous>';
  const params = stmt.parameters
    .map((p) => paramText(p, sf))
    .join(', ');
  const ret = stmt.type ? `: ${compactType(stmt.type.getText(sf))}` : '';
  const async = (ts.getModifiers(stmt) ?? []).some(
    (m) => m.kind === ts.SyntaxKind.AsyncKeyword,
  );
  return `${async ? 'async ' : ''}function ${name}(${params})${ret}`;
}

function interfaceSignature(stmt: ts.InterfaceDeclaration): string {
  const members = stmt.members
    .map((m) => {
      if (m.name && ts.isIdentifier(m.name)) return m.name.text;
      return null;
    })
    .filter((x): x is string => !!x);
  const extendsClause = (stmt.heritageClauses ?? [])
    .filter((c) => c.token === ts.SyntaxKind.ExtendsKeyword)
    .map((c) => c.types.map((t) => t.expression.getText()).join(', '))
    .join(', ');
  const summary = members.length
    ? ` { ${members.slice(0, 8).join(', ')}${members.length > 8 ? ', ...' : ''} }`
    : ' {}';
  return `interface ${stmt.name.text}${extendsClause ? ` extends ${extendsClause}` : ''}${summary}`;
}

function variableSignature(
  stmt: ts.VariableStatement,
  decl: ts.VariableDeclaration,
  sf: ts.SourceFile,
): string {
  const name = (decl.name as ts.Identifier).text;
  const keyword =
    stmt.declarationList.flags & ts.NodeFlags.Const
      ? 'const'
      : stmt.declarationList.flags & ts.NodeFlags.Let
      ? 'let'
      : 'var';
  if (decl.initializer && ts.isArrowFunction(decl.initializer)) {
    const arrow = decl.initializer;
    const params = arrow.parameters.map((p) => paramText(p, sf)).join(', ');
    const ret = arrow.type ? `: ${compactType(arrow.type.getText(sf))}` : '';
    const async = (ts.getModifiers(arrow) ?? []).some(
      (m) => m.kind === ts.SyntaxKind.AsyncKeyword,
    );
    return `${keyword} ${name} = ${async ? 'async ' : ''}(${params})${ret} => …`;
  }
  if (decl.type) {
    return `${keyword} ${name}: ${compactType(decl.type.getText(sf))}`;
  }
  return `${keyword} ${name}`;
}

function paramText(p: ts.ParameterDeclaration, sf: ts.SourceFile): string {
  const name = p.name.getText(sf);
  const optional = p.questionToken ? '?' : '';
  const type = p.type ? `: ${compactType(p.type.getText(sf))}` : '';
  return `${name}${optional}${type}`;
}

function compactType(t: string): string {
  const flat = t.replace(/\s+/g, ' ').trim();
  return flat.length > 60 ? flat.slice(0, 57) + '...' : flat;
}

function leadingJSDocSummary(
  node: ts.Node,
  sf: ts.SourceFile,
): string | undefined {
  const ranges = ts.getLeadingCommentRanges(sf.text, node.getFullStart());
  if (!ranges || ranges.length === 0) return undefined;
  const last = ranges[ranges.length - 1];
  const raw = sf.text.slice(last.pos, last.end);
  if (!raw.startsWith('/**')) return undefined;
  const lines = raw
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trim())
    .filter((l) => l.length > 0 && !l.startsWith('@'));
  if (lines.length === 0) return undefined;
  const summary = lines[0];
  return summary.length > 120 ? summary.slice(0, 117) + '...' : summary;
}

function resolveImports(
  files: RepoFile[],
  byPath: Map<string, RepoFile>,
  absRoot: string,
): void {
  for (const file of files) {
    const resolved: string[] = [];
    for (const spec of file.imports) {
      const hit = resolveSpecifier(file.path, spec, byPath, absRoot);
      if (hit) resolved.push(hit);
    }
    file.imports = Array.from(new Set(resolved)).sort();
  }
}

function resolveSpecifier(
  fromRel: string,
  spec: string,
  byPath: Map<string, RepoFile>,
  absRoot: string,
): string | null {
  const fromDir = path.posix.dirname(toPosix(fromRel));
  const joined = path.posix.normalize(path.posix.join(fromDir, spec));
  const candidates = [
    `${joined}.ts`,
    `${joined}.tsx`,
    `${joined}/index.ts`,
    `${joined}/index.tsx`,
  ];
  for (const c of candidates) {
    if (byPath.has(c)) return c;
  }
  // Absolute-from-root imports (rare in this repo but cheap to handle).
  if (spec.startsWith('/')) {
    const absCandidates = [
      `${spec.slice(1)}.ts`,
      `${spec.slice(1)}.tsx`,
      `${spec.slice(1)}/index.ts`,
    ];
    for (const c of absCandidates) if (byPath.has(c)) return c;
  }
  void absRoot;
  return null;
}

function populateImportedBy(
  files: RepoFile[],
  byPath: Map<string, RepoFile>,
): void {
  for (const file of files) {
    for (const dep of file.imports) {
      const target = byPath.get(dep);
      if (target) target.importedBy.push(file.path);
    }
  }
  for (const file of files) {
    file.importedBy = Array.from(new Set(file.importedBy)).sort();
  }
}

function pageRank(
  files: RepoFile[],
  byPath: Map<string, RepoFile>,
  damping: number,
  iterations: number,
): Map<string, number> {
  const n = files.length;
  if (n === 0) return new Map();
  const scores = new Map<string, number>();
  for (const f of files) scores.set(f.path, 1 / n);

  const outDegree = new Map<string, number>();
  for (const f of files) {
    const edges = f.imports.filter((p) => byPath.has(p));
    outDegree.set(f.path, edges.length);
  }

  for (let iter = 0; iter < iterations; iter++) {
    const next = new Map<string, number>();
    let danglingMass = 0;
    for (const f of files) {
      if ((outDegree.get(f.path) ?? 0) === 0) {
        danglingMass += scores.get(f.path) ?? 0;
      }
    }
    const base = (1 - damping) / n + (damping * danglingMass) / n;
    for (const f of files) next.set(f.path, base);
    for (const f of files) {
      const out = outDegree.get(f.path) ?? 0;
      if (out === 0) continue;
      const share = (damping * (scores.get(f.path) ?? 0)) / out;
      for (const dep of f.imports) {
        if (!byPath.has(dep)) continue;
        next.set(dep, (next.get(dep) ?? 0) + share);
      }
    }
    for (const [k, v] of next) scores.set(k, v);
  }

  return scores;
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}
