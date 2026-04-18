import type { AppState } from '../../shared/types/appState';

export type DocumentRenderCheckpoint = {
  artifactId: string | null;
  updatedAt: number | null;
};

export function getDocumentRenderCheckpoint(state: AppState | null | undefined): DocumentRenderCheckpoint {
  const artifactId = state?.activeArtifactId ?? null;
  if (!artifactId) {
    return { artifactId: null, updatedAt: null };
  }

  const artifact = state?.artifacts.find((entry) => entry.id === artifactId);
  return {
    artifactId,
    updatedAt: artifact?.updatedAt ?? null,
  };
}

export function shouldRefreshDocumentView(
  previous: DocumentRenderCheckpoint | null,
  next: DocumentRenderCheckpoint,
): boolean {
  if (!previous) return true;
  return previous.artifactId !== next.artifactId || previous.updatedAt !== next.updatedAt;
}
