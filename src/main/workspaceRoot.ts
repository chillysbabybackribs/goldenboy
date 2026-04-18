import * as fs from 'fs';
import * as path from 'path';

function findWorkspaceRoot(startDir: string): string {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, 'package.json'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(startDir, '..', '..');
}

// Resolve the repository root from either source or built output layouts.
const DEFAULT_WORKSPACE_ROOT = findWorkspaceRoot(__dirname);

export const APP_WORKSPACE_ROOT = path.resolve(
  process.env.V2_WORKSPACE_ROOT && process.env.V2_WORKSPACE_ROOT.trim()
    ? process.env.V2_WORKSPACE_ROOT
    : DEFAULT_WORKSPACE_ROOT,
);

export function resolveWorkspacePath(...segments: string[]): string {
  return path.resolve(APP_WORKSPACE_ROOT, ...segments);
}
