import type { ToolPackManifest } from './types';

export const artifactsToolPack: ToolPackManifest = {
  id: 'artifacts',
  description: 'Managed workspace artifact creation and update for md, txt, html, and csv.',
  tools: [
    'artifact.list',
    'artifact.get',
    'artifact.get_active',
    'artifact.read',
    'artifact.create',
    'artifact.delete',
    'artifact.replace_content',
    'artifact.append_content',
  ],
  relatedPackIds: ['general', 'implementation'],
};
