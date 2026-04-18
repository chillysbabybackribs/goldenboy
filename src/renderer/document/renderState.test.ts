import { describe, expect, it } from 'vitest';
import { createDefaultAppState } from '../../shared/types/appState';
import { getDocumentRenderCheckpoint, shouldRefreshDocumentView } from './renderState';

describe('document render gating', () => {
  it('refreshes on first render', () => {
    const state = createDefaultAppState();
    expect(shouldRefreshDocumentView(null, getDocumentRenderCheckpoint(state))).toBe(true);
  });

  it('refreshes when active artifact changes', () => {
    const previous = { artifactId: 'a', updatedAt: 10 };
    const next = { artifactId: 'b', updatedAt: 10 };
    expect(shouldRefreshDocumentView(previous, next)).toBe(true);
  });

  it('refreshes when current artifact updatedAt changes', () => {
    const previous = { artifactId: 'a', updatedAt: 10 };
    const next = { artifactId: 'a', updatedAt: 11 };
    expect(shouldRefreshDocumentView(previous, next)).toBe(true);
  });

  it('skips refresh when current artifact identity and timestamp are unchanged', () => {
    const previous = { artifactId: 'a', updatedAt: 10 };
    const next = { artifactId: 'a', updatedAt: 10 };
    expect(shouldRefreshDocumentView(previous, next)).toBe(false);
  });

  it('extracts active artifact checkpoint from app state', () => {
    const state = createDefaultAppState();
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

    expect(getDocumentRenderCheckpoint(state)).toEqual({
      artifactId: 'artifact-1',
      updatedAt: 22,
    });
  });
});
