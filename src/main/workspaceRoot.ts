import * as path from 'path';

const DEFAULT_WORKSPACE_ROOT = '/home/dp/Desktop/v2workspace';

export const APP_WORKSPACE_ROOT = path.resolve(
  process.env.V2_WORKSPACE_ROOT && process.env.V2_WORKSPACE_ROOT.trim()
    ? process.env.V2_WORKSPACE_ROOT
    : DEFAULT_WORKSPACE_ROOT,
);

export function resolveWorkspacePath(...segments: string[]): string {
  return path.resolve(APP_WORKSPACE_ROOT, ...segments);
}
