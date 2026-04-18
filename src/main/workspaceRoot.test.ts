import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { APP_WORKSPACE_ROOT, resolveWorkspacePath } from './workspaceRoot';

describe('workspaceRoot', () => {
  it('resolves the repository root from the current checkout', () => {
    expect(APP_WORKSPACE_ROOT).toBe(process.cwd());
    expect(resolveWorkspacePath('package.json')).toBe(path.join(process.cwd(), 'package.json'));
  });
});
