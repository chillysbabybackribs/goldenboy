import { DocumentArtifactSummary, DocumentArtifactView } from '../../shared/types/document';
export declare class DocumentService {
    listArtifacts(): DocumentArtifactSummary[];
    getCurrentArtifactView(): DocumentArtifactView | null;
    getArtifactView(artifactId: string): DocumentArtifactView;
    setCurrentArtifact(artifactId: string | null): DocumentArtifactView | null;
    openArtifact(artifactId: string): DocumentArtifactView;
}
export declare const documentService: DocumentService;
