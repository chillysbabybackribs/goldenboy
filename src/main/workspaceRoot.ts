import * as fs from 'fs';
import * as path from 'path';

const WORKSPACE_MARKERS = [
  'AGENTS.md',
  'package.json',
  path.join('skills', 'code-edit', 'SKILL.md'),
] as const;

function isWorkspaceRoot(candidate: string): boolean {
  return WORKSPACE_MARKERS.every(marker => fs.existsSync(path.join(candidate, marker)));
}

export function resolveAppWorkspaceRoot(fromDir: string, envRoot = process.env.V2_WORKSPACE_ROOT): string {
  if (envRoot && envRoot.trim()) {
    return path.resolve(envRoot);
  }

  let current = path.resolve(fromDir);
  while (true) {
    if (isWorkspaceRoot(current)) return current;

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return path.resolve(fromDir, '..', '..');
}

export const APP_WORKSPACE_ROOT = resolveAppWorkspaceRoot(__dirname);

export function resolveWorkspacePath(...segments: string[]): string {
  return path.resolve(APP_WORKSPACE_ROOT, ...segments);
}
