import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readChunkMock } = vi.hoisted(() => ({
  readChunkMock: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
  },
}));

vi.mock('../../../fileKnowledge/FileKnowledgeStore', () => ({
  fileKnowledgeStore: {
    readChunk: readChunkMock,
    search: vi.fn(() => []),
    answerFromCache: vi.fn(() => ({ query: '', answer: '', sources: [], tokenEstimate: 0 })),
    getStats: vi.fn(() => ({ fileCount: 0, chunkCount: 0 })),
    listFiles: vi.fn(() => []),
  },
}));

vi.mock('../../AgentCache', () => ({
  agentCache: { invalidateByToolPrefix: vi.fn() },
}));

vi.mock('../../../state/appStateStore', () => ({
  appStateStore: { dispatch: vi.fn() },
}));

vi.mock('../../../state/actions', () => ({
  ActionType: { ADD_LOG: 'add_log' },
}));

vi.mock('../../../../shared/utils/ids', () => ({
  generateId: (prefix: string) => `${prefix}_test`,
}));

vi.mock('../../../workspaceRoot', () => ({
  APP_WORKSPACE_ROOT: '/tmp',
}));

vi.mock('../../repoMap', () => ({
  repoMapService: { buildRepoMap: vi.fn(() => ({ files: [], symbols: [] })) },
}));

vi.mock('../../workspaceManifest', () => ({
  workspaceManifestService: { getManifest: vi.fn(() => ({})) },
}));

import { createFilesystemToolDefinitions } from './index';

describe('filesystem.read_file_chunk', () => {
  beforeEach(() => {
    readChunkMock.mockReset();
  });

  function makeChunk(id: string, line: number) {
    return {
      id,
      path: `/tmp/file-${id}.ts`,
      relativePath: `file-${id}.ts`,
      language: 'typescript',
      startLine: line,
      endLine: line + 10,
      text: `body for ${id}`,
      tokenEstimate: 25,
      summary: null,
      symbols: [],
      usage: { hits: 0, lastAccessedAt: 0 },
      contentHash: `hash-${id}`,
      freshness: 'fresh' as const,
    };
  }

  it('reads multiple chunks in one call when chunkIds is provided', async () => {
    readChunkMock.mockImplementation(id => id === 'missing' ? null : makeChunk(id, 1));
    const tool = createFilesystemToolDefinitions().find(item => item.name === 'filesystem.read_file_chunk');
    expect(tool).toBeTruthy();

    const result = await tool!.execute(
      { chunkIds: ['chunk_a', 'chunk_b', 'missing', 'chunk_a'] },
      { runId: 'run_fs_batch', agentId: 'agent_fs_batch', mode: 'unrestricted-dev' },
    );

    expect(readChunkMock).toHaveBeenCalledTimes(3);
    expect(result.summary).toMatch(/2\/3 cached file chunks/);
    const data = result.data as { chunks: Array<{ id: string }>; missing: string[] };
    expect(data.chunks.map(chunk => chunk.id)).toEqual(['chunk_a', 'chunk_b']);
    expect(data.missing).toEqual(['missing']);
  });

  it('falls back to the legacy chunkId field and returns a single-chunk summary', async () => {
    readChunkMock.mockReturnValue(makeChunk('chunk_single', 12));
    const tool = createFilesystemToolDefinitions().find(item => item.name === 'filesystem.read_file_chunk');

    const result = await tool!.execute(
      { chunkId: 'chunk_single' },
      { runId: 'run_fs_single', agentId: 'agent_fs_single', mode: 'unrestricted-dev' },
    );

    expect(readChunkMock).toHaveBeenCalledWith('chunk_single', expect.any(Number));
    expect(result.summary).toBe('Read cached file chunk file-chunk_single.ts:12-22');
    const data = result.data as { chunks: Array<{ id: string }>; missing: string[] };
    expect(data.chunks).toHaveLength(1);
    expect(data.missing).toEqual([]);
  });

  it('throws when neither chunkId nor chunkIds is provided', async () => {
    const tool = createFilesystemToolDefinitions().find(item => item.name === 'filesystem.read_file_chunk');
    await expect(
      tool!.execute({}, { runId: 'run_fs_none', agentId: 'agent_fs_none', mode: 'unrestricted-dev' }),
    ).rejects.toThrow(/chunkId or chunkIds/);
  });

  it('throws when all requested ids are missing', async () => {
    readChunkMock.mockReturnValue(null);
    const tool = createFilesystemToolDefinitions().find(item => item.name === 'filesystem.read_file_chunk');
    await expect(
      tool!.execute(
        { chunkIds: ['x', 'y'] },
        { runId: 'run_fs_missing', agentId: 'agent_fs_missing', mode: 'unrestricted-dev' },
      ),
    ).rejects.toThrow(/Cached file chunk not found/);
  });
});
