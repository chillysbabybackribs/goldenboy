import { artifactService } from '../artifacts/ArtifactService';
import { ensureWindow, focusWindow } from '../windows/windowManager';
import { DocumentArtifactSummary, DocumentArtifactView, toDocumentArtifactSummary } from '../../shared/types/document';

export class DocumentService {
  listArtifacts(): DocumentArtifactSummary[] {
    return artifactService.listArtifacts().map(toDocumentArtifactSummary);
  }

  getCurrentArtifactView(): DocumentArtifactView | null {
    const active = artifactService.getActiveArtifact();
    if (!active) return null;
    return this.getArtifactView(active.id);
  }

  getArtifactView(artifactId: string): DocumentArtifactView {
    const { artifact, content } = artifactService.readContent(artifactId);
    return {
      artifact: toDocumentArtifactSummary(artifact),
      content,
    };
  }

  setCurrentArtifact(artifactId: string | null): DocumentArtifactView | null {
    const artifact = artifactService.setActiveArtifact(artifactId);
    return artifact ? this.getArtifactView(artifact.id) : null;
  }

  openArtifact(artifactId: string): DocumentArtifactView {
    const view = this.setCurrentArtifact(artifactId);
    if (!view) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }
    ensureWindow('document', { showOnReady: true });
    focusWindow('document', { maximize: true });
    return view;
  }
}

export const documentService = new DocumentService();
