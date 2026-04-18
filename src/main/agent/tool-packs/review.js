"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reviewToolPack = void 0;
exports.reviewToolPack = {
    id: 'review',
    description: 'Code review and regression analysis from repo and chat context.',
    baseline4: [
        'filesystem.search',
        'filesystem.read',
        'chat.thread_summary',
    ],
    baseline6: [
        'filesystem.search',
        'filesystem.read',
        'filesystem.list',
        'chat.thread_summary',
        'chat.search',
    ],
    tools: [
        'filesystem.list',
        'filesystem.search',
        'filesystem.read',
        'chat.thread_summary',
        'chat.read_last',
        'chat.search',
        'chat.read_window',
        'chat.read_message',
    ],
    relatedPackIds: ['chat-recall', 'file-cache'],
};
//# sourceMappingURL=review.js.map