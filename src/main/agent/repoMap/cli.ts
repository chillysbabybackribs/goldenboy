#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { buildRepoMap } from './buildRepoMap';
import { renderRepoMap } from './renderRepoMap';

interface CliArgs {
  root: string;
  format: 'markdown' | 'json';
  maxFiles?: number;
  maxSymbols?: number;
  includePrivate: boolean;
  out?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    root: process.cwd(),
    format: 'markdown',
    includePrivate: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--root':
        args.root = argv[++i];
        break;
      case '--format':
        args.format = argv[++i] as 'markdown' | 'json';
        break;
      case '--max-files':
        args.maxFiles = Number(argv[++i]);
        break;
      case '--max-symbols':
        args.maxSymbols = Number(argv[++i]);
        break;
      case '--include-private':
        args.includePrivate = true;
        break;
      case '--out':
        args.out = argv[++i];
        break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
      default:
        if (!a.startsWith('-') && args.root === process.cwd()) {
          args.root = a;
        }
    }
  }
  return args;
}

function printHelp(): void {
  process.stdout.write(
    [
      'Usage: repo-map [options] [root]',
      '',
      'Options:',
      '  --root <dir>          Directory to scan (default: cwd)',
      '  --format <fmt>        markdown | json (default: markdown)',
      '  --max-files <n>       Truncate to top-N files by PageRank',
      '  --max-symbols <n>     Max symbols rendered per file (default: 12)',
      '  --include-private     Also emit non-exported top-level symbols',
      '  --out <file>          Write to file instead of stdout',
      '',
    ].join('\n'),
  );
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const absRoot = path.resolve(args.root);
  if (!fs.existsSync(absRoot)) {
    process.stderr.write(`repo-map: root not found: ${absRoot}\n`);
    process.exit(1);
  }

  const map = buildRepoMap({
    root: absRoot,
    includePrivate: args.includePrivate,
  });

  const output =
    args.format === 'json'
      ? JSON.stringify(map, null, 2)
      : renderRepoMap(map, {
          maxFiles: args.maxFiles,
          maxSymbolsPerFile: args.maxSymbols,
        });

  if (args.out) {
    fs.writeFileSync(args.out, output, 'utf8');
    process.stderr.write(`repo-map: wrote ${output.length} bytes to ${args.out}\n`);
  } else {
    process.stdout.write(output);
    if (!output.endsWith('\n')) process.stdout.write('\n');
  }
}

main();
