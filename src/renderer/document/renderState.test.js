"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const appState_1 = require("../../shared/types/appState");
const renderState_1 = require("./renderState");
(0, vitest_1.describe)('document render gating', () => {
    (0, vitest_1.it)('refreshes on first render', () => {
        const state = (0, appState_1.createDefaultAppState)();
        (0, vitest_1.expect)((0, renderState_1.shouldRefreshDocumentView)(null, (0, renderState_1.getDocumentRenderCheckpoint)(state))).toBe(true);
    });
    (0, vitest_1.it)('refreshes when active artifact changes', () => {
        const previous = { artifactId: 'a', updatedAt: 10 };
        const next = { artifactId: 'b', updatedAt: 10 };
        (0, vitest_1.expect)((0, renderState_1.shouldRefreshDocumentView)(previous, next)).toBe(true);
    });
    (0, vitest_1.it)('refreshes when current artifact updatedAt changes', () => {
        const previous = { artifactId: 'a', updatedAt: 10 };
        const next = { artifactId: 'a', updatedAt: 11 };
        (0, vitest_1.expect)((0, renderState_1.shouldRefreshDocumentView)(previous, next)).toBe(true);
    });
    (0, vitest_1.it)('skips refresh when current artifact identity and timestamp are unchanged', () => {
        const previous = { artifactId: 'a', updatedAt: 10 };
        const next = { artifactId: 'a', updatedAt: 10 };
        (0, vitest_1.expect)((0, renderState_1.shouldRefreshDocumentView)(previous, next)).toBe(false);
    });
    (0, vitest_1.it)('extracts active artifact checkpoint from app state', () => {
        const state = (0, appState_1.createDefaultAppState)();
        state.artifacts = [
            {
                id: 'artifact-1',
                title: 'Note',
                format: 'md',
                workingPath: '/tmp/note.md',
                createdBy: 'user',
                lastUpdatedBy: 'user',
                createdAt: 1,
                updatedAt: 22,
                status: 'active',
                linkedTaskIds: [],
                previewable: true,
                exportable: true,
                archived: false,
            },
        ];
        state.activeArtifactId = 'artifact-1';
        (0, vitest_1.expect)((0, renderState_1.getDocumentRenderCheckpoint)(state)).toEqual({
            artifactId: 'artifact-1',
            updatedAt: 22,
        });
    });
});
//# sourceMappingURL=renderState.test.js.map