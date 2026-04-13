import type { ToolPackManifest } from './types';

export const fileEditToolPack: ToolPackManifest = {
  id: 'file-edit',
  description: 'Focused file reading and editing.',
  tools: [
    'filesystem.list',
    'filesystem.search',
    'filesystem.read',
    'filesystem.write',
    'filesystem.patch',
    'filesystem.delete',
    'filesystem.mkdir',
    'filesystem.move',
  ],
  relatedPackIds: ['implementation', 'debug', 'file-cache'],
};
