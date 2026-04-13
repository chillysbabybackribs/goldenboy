import type { ToolPackManifest } from './types';

export const terminalHeavyToolPack: ToolPackManifest = {
  id: 'terminal-heavy',
  description: 'Long-running terminal work, process control, and command loops.',
  tools: [
    'terminal.exec',
    'terminal.spawn',
    'terminal.write',
    'terminal.kill',
    'chat.thread_summary',
  ],
  relatedPackIds: ['debug', 'implementation'],
};
