"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.artifactsToolPack = void 0;
exports.artifactsToolPack = {
    id: 'artifacts',
    description: 'Managed workspace artifact creation and update for md, txt, html, and csv.',
    tools: [
        'artifact.list',
        'artifact.get',
        'artifact.get_active',
        'artifact.read',
        'artifact.create',
        'artifact.delete',
        'artifact.replace_content',
        'artifact.append_content',
    ],
    relatedPackIds: ['general', 'implementation'],
};
//# sourceMappingURL=artifacts.js.map