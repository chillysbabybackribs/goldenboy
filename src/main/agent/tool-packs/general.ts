import type { ToolPackManifest } from './types';

export const generalToolPack: ToolPackManifest = {
  id: 'general',
  description: 'Minimal general-purpose local task support.',
  baseline4: [
    'filesystem.read',
    'terminal.exec',
    'chat.thread_summary',
  ],
  baseline6: [
    'filesystem.search',
    'filesystem.read',
    'filesystem.patch',
    'terminal.exec',
    'chat.thread_summary',
  ],
  tools: [
    'filesystem.search',
    'filesystem.read',
    'filesystem.patch',
    'terminal.exec',
    'chat.thread_summary',
    'browser.research_search',
  ],
  relatedPackIds: ['implementation', 'research'],
};
