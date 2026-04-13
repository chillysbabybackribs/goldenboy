import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { readFileSyncMock } = vi.hoisted(() => ({
  readFileSyncMock: vi.fn(),
}));
const { spawnSyncMock } = vi.hoisted(() => ({
  spawnSyncMock: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  readFileSyncMock.mockImplementation(actual.readFileSync.bind(actual));
  return {
    ...actual,
    readFileSync: readFileSyncMock,
  };
});

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  spawnSyncMock.mockImplementation(actual.spawnSync.bind(actual));
  return {
    ...actual,
    spawnSync: spawnSyncMock,
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: () => process.env.V2_TEST_USER_DATA || os.tmpdir(),
  },
}));

import { FileKnowledgeStore } from './FileKnowledgeStore';

describe('FileKnowledgeStore', () => {
  let userDataDir = '';
  let workspaceDir = '';

  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-file-cache-user-data-'));
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-file-cache-workspace-'));
    process.env.V2_TEST_USER_DATA = userDataDir;
  });

  afterEach(() => {
    delete process.env.V2_TEST_USER_DATA;
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    readFileSyncMock.mockClear();
    spawnSyncMock.mockClear();
  });

  it('reuses unchanged indexed files without rereading them', () => {
    const store = new FileKnowledgeStore();
    const filePath = path.join(workspaceDir, 'example.ts');
    fs.writeFileSync(filePath, 'export const value = 1;\n', 'utf-8');

    const first = store.indexWorkspace(workspaceDir);
    expect(first.indexedFiles).toBe(1);

    readFileSyncMock.mockClear();
    const second = store.indexWorkspace(workspaceDir);

    expect(second.indexedFiles).toBe(1);
    expect(readFileSyncMock.mock.calls.filter(call => call[0] === filePath)).toHaveLength(0);
  });

  it('refreshes changed files and removes deleted ones', async () => {
    const store = new FileKnowledgeStore();
    const filePath = path.join(workspaceDir, 'example.ts');
    fs.writeFileSync(filePath, 'export const value = 1;\n', 'utf-8');
    store.indexWorkspace(workspaceDir);

    await new Promise(resolve => setTimeout(resolve, 20));
    fs.writeFileSync(filePath, 'export const value = 2;\n', 'utf-8');

    const refreshed = store.refreshFile(filePath, workspaceDir);
    expect(refreshed?.reused).toBe(false);
    const chunk = refreshed?.chunks[0];
    expect(chunk).toBeTruthy();
    const readChunk = store.readChunk(chunk!.id, 200);
    expect(readChunk?.text).toContain('value = 2');

    const searchResults = store.search('value', { pathPrefix: '' });
    expect(searchResults.some(result => result.path === filePath)).toBe(true);

    const window = store.readWindowForPath(filePath, { maxChars: 200 });
    expect(window?.content).toContain('value = 2');

    fs.rmSync(filePath, { force: true });
    expect(store.removeFile(filePath)).toBe(true);
    expect(store.getFreshChunksForPath(filePath)).toBeNull();
  });

  it('falls back to direct file scanning when rg hits E2BIG', () => {
    const store = new FileKnowledgeStore();
    const filePath = path.join(workspaceDir, 'example.ts');
    fs.writeFileSync(filePath, 'export const value = 2;\n', 'utf-8');
    store.indexWorkspace(workspaceDir);

    spawnSyncMock.mockReturnValueOnce({
      pid: 0,
      output: [],
      stdout: '',
      stderr: '',
      status: null,
      signal: null,
      error: Object.assign(new Error('spawn E2BIG'), { code: 'E2BIG' }),
    });

    const results = store.search('value', { pathPrefix: '', limit: 5 });
    expect(results.some(result => result.path === filePath)).toBe(true);
  });
});
