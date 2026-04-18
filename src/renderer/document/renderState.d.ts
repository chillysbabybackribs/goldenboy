import type { AppState } from '../../shared/types/appState';
export type DocumentRenderCheckpoint = {
    artifactId: string | null;
    updatedAt: number | null;
};
export declare function getDocumentRenderCheckpoint(state: AppState | null | undefined): DocumentRenderCheckpoint;
export declare function shouldRefreshDocumentView(previous: DocumentRenderCheckpoint | null, next: DocumentRenderCheckpoint): boolean;
