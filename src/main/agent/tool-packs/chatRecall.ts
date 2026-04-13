import type { ToolPackManifest } from './types';

export const chatRecallToolPack: ToolPackManifest = {
  id: 'chat-recall',
  description: 'Deep chat history recall and windowed context lookup.',
  tools: [
    'chat.thread_summary',
    'chat.read_last',
    'chat.search',
    'chat.read_message',
    'chat.read_window',
    'chat.recall',
    'chat.cache_stats',
  ],
  relatedPackIds: ['review'],
};
