"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generalToolPack = void 0;
exports.generalToolPack = {
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
        'chat.read_last',
    ],
    tools: [
        'filesystem.search',
        'filesystem.read',
        'filesystem.patch',
        'terminal.exec',
        'chat.thread_summary',
        'chat.read_last',
        'browser.research_search',
    ],
    relatedPackIds: ['implementation', 'research', 'artifacts'],
};
//# sourceMappingURL=general.js.map