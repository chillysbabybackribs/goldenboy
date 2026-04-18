"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fileEditToolPack = void 0;
exports.fileEditToolPack = {
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
//# sourceMappingURL=fileEdit.js.map