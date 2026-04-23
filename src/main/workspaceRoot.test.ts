import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { resolveAppWorkspaceRoot } from './workspaceRoot';

describe('workspaceRoot', () => {
  it('resolves the repo root from the source tree', () => {
    const fromDir = path.resolve(__dirname);
    expect(resolveAppWorkspaceRoot(fromDir, '')).toBe(path.resolve(__dirname, '..', '..'));
  });

  it('resolves the repo root from the built main output tree', () => {
    const fromDir = path.resolve(__dirname, '..', '..', 'dist', 'main', 'main');
    expect(resolveAppWorkspaceRoot(fromDir, '')).toBe(path.resolve(__dirname, '..', '..'));
  });

  it('prefers GOLDENBOY_WORKSPACE_ROOT when provided', () => {
    expect(resolveAppWorkspaceRoot('/tmp/anywhere', '/tmp/override-root')).toBe('/tmp/override-root');
  });
});
