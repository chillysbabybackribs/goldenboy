import type { ToolPackManifest } from './types';

export const fileCacheToolPack: ToolPackManifest = {
  id: 'file-cache',
  description: 'Indexed file-cache search, chunk reads, and cache stats for code-heavy reasoning.',
  tools: [
    'filesystem.index_workspace',
    'filesystem.answer_from_cache',
    'filesystem.search_file_cache',
    'filesystem.read_file_chunk',
    'filesystem.list_cached_files',
    'filesystem.file_cache_stats',
  ],
  relatedPackIds: ['implementation', 'file-edit', 'debug', 'review'],
};
