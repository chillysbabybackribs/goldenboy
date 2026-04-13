import type { ToolPackManifest } from './types';

export const orchestrationToolPack: ToolPackManifest = {
  id: 'orchestration',
  description: 'Delegation, sub-agents, and repo-wide coordination.',
  baseline4: [
    'subagent.spawn',
    'subagent.wait',
    'filesystem.read',
  ],
  baseline6: [
    'subagent.spawn',
    'subagent.wait',
    'subagent.list',
    'filesystem.search',
    'filesystem.read',
  ],
  tools: [
    'subagent.spawn',
    'subagent.wait',
    'subagent.message',
    'subagent.cancel',
    'subagent.list',
    'filesystem.search',
    'filesystem.read',
    'chat.thread_summary',
  ],
  relatedPackIds: ['implementation', 'debug'],
};
