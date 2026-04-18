"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.implementationToolPack = void 0;
exports.implementationToolPack = {
    id: 'implementation',
    description: 'Local code reading, editing, and build execution.',
    baseline4: [
        'filesystem.search',
        'filesystem.read',
        'filesystem.patch',
    ],
    baseline6: [
        'filesystem.search',
        'filesystem.read',
        'filesystem.patch',
        'filesystem.write',
        'terminal.exec',
    ],
    tools: [
        'filesystem.list',
        'filesystem.search',
        'filesystem.read',
        'filesystem.write',
        'filesystem.patch',
        'filesystem.delete',
        'filesystem.mkdir',
        'filesystem.move',
        'terminal.exec',
        'terminal.spawn',
        'terminal.write',
        'terminal.kill',
    ],
    relatedPackIds: ['file-edit', 'file-cache', 'terminal-heavy', 'artifacts'],
};
//# sourceMappingURL=implementation.js.map