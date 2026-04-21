import type { RepoFile, RepoMap, RepoSymbol } from './buildRepoMap';

export interface RenderRepoMapOptions {
  /** Max files to render. Default: all. */
  maxFiles?: number;
  /** Max symbols to render per file. Default: 12. */
  maxSymbolsPerFile?: number;
  /** Max length of the "top dependents" list per file. Default: 4. */
  maxDependents?: number;
  /** Show PageRank scores next to files. Default: true. */
  showScores?: boolean;
  /** Show line numbers next to each symbol. Default: true. */
  showLines?: boolean;
}

export function renderRepoMap(
  map: RepoMap,
  options: RenderRepoMapOptions = {},
): string {
  const {
    maxFiles,
    maxSymbolsPerFile = 12,
    maxDependents = 4,
    showScores = true,
    showLines = true,
  } = options;

  const files = maxFiles ? map.files.slice(0, maxFiles) : map.files;
  const lines: string[] = [];

  lines.push(`# Repo map`);
  lines.push('');
  lines.push(
    `- root: \`${map.root}\`  `,
    `- files: ${map.fileCount}  `,
    `- total lines: ${map.totalLines}  `,
    `- generated: ${map.generatedAt}`,
  );
  lines.push('');
  lines.push('Files are sorted by PageRank over the import graph.');
  lines.push('');

  for (const file of files) {
    lines.push(...renderFile(file, {
      maxSymbolsPerFile,
      maxDependents,
      showScores,
      showLines,
    }));
    lines.push('');
  }

  return lines.join('\n');
}

function renderFile(
  file: RepoFile,
  opts: Required<Pick<RenderRepoMapOptions,
    'maxSymbolsPerFile' | 'maxDependents' | 'showScores' | 'showLines'>>,
): string[] {
  const out: string[] = [];
  const scoreTag = opts.showScores
    ? `  _[rank ${file.score.toFixed(4)}, ${file.lines} loc, ${file.importedBy.length} in / ${file.imports.length} out]_`
    : '';
  out.push(`## \`${file.path}\`${scoreTag}`);

  if (file.importedBy.length > 0) {
    const shown = file.importedBy.slice(0, opts.maxDependents);
    const more =
      file.importedBy.length > opts.maxDependents
        ? `, +${file.importedBy.length - opts.maxDependents} more`
        : '';
    out.push(`- used by: ${shown.map((p) => `\`${p}\``).join(', ')}${more}`);
  }
  if (file.imports.length > 0) {
    const shown = file.imports.slice(0, opts.maxDependents);
    const more =
      file.imports.length > opts.maxDependents
        ? `, +${file.imports.length - opts.maxDependents} more`
        : '';
    out.push(`- imports: ${shown.map((p) => `\`${p}\``).join(', ')}${more}`);
  }

  if (file.symbols.length === 0) {
    out.push(`- _no top-level exports_`);
    return out;
  }

  const shownSymbols = file.symbols.slice(0, opts.maxSymbolsPerFile);
  const truncated = file.symbols.length - shownSymbols.length;
  out.push('');
  out.push('```');
  for (const sym of shownSymbols) {
    out.push(renderSymbolLine(sym, opts.showLines));
    if (sym.doc) out.push(`    ↳ ${sym.doc}`);
  }
  if (truncated > 0) out.push(`  … +${truncated} more symbols`);
  out.push('```');

  return out;
}

function renderSymbolLine(sym: RepoSymbol, showLines: boolean): string {
  const prefix = showLines ? `L${String(sym.line).padStart(4, ' ')}  ` : '';
  return `${prefix}${sym.signature}`;
}
