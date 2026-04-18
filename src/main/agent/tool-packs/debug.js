"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.debugToolPack = void 0;
exports.debugToolPack = {
    id: 'debug',
    description: 'Debugging with code inspection, command execution, and logs.',
    baseline4: [
        'filesystem.search',
        'filesystem.read',
        'terminal.exec',
    ],
    baseline6: [
        'filesystem.search',
        'filesystem.read',
        'filesystem.patch',
        'terminal.exec',
        'terminal.spawn',
    ],
    tools: [
        'filesystem.search',
        'filesystem.read',
        'filesystem.patch',
        'filesystem.list',
        'terminal.exec',
        'terminal.spawn',
        'terminal.write',
        'terminal.kill',
        'browser.evaluate_js',
        'chat.thread_summary',
    ],
    relatedPackIds: ['terminal-heavy', 'file-edit', 'file-cache', 'browser-advanced'],
};
//# sourceMappingURL=debug.js.map