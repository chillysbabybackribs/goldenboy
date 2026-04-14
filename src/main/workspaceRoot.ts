import * as path from 'path';

// Default to the repository root when launched from a normal source checkout.
const DEFAULT_WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..');

export const APP_WORKSPACE_ROOT = path.resolve(
  process.env.V2_WORKSPACE_ROOT && process.env.V2_WORKSPACE_ROOT.trim()
    ? process.env.V2_WORKSPACE_ROOT
    : DEFAULT_WORKSPACE_ROOT,
);

export function resolveWorkspacePath(...segments: string[]): string {
  return path.resolve(APP_WORKSPACE_ROOT, ...segments);
}
