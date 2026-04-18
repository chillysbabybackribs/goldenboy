"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.orchestrationToolPack = void 0;
exports.orchestrationToolPack = {
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
        'subagent.cancel',
        'subagent.list',
        'filesystem.search',
        'filesystem.read',
        'chat.thread_summary',
    ],
    relatedPackIds: ['implementation', 'debug'],
};
//# sourceMappingURL=orchestration.js.map