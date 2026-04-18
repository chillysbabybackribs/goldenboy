"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatRecallToolPack = void 0;
exports.chatRecallToolPack = {
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
//# sourceMappingURL=chatRecall.js.map