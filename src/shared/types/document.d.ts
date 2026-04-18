import { ArtifactActor, ArtifactFormat, ArtifactRecord, ArtifactStatus } from './artifacts';
export type DocumentArtifactSummary = {
    id: string;
    title: string;
    format: ArtifactFormat;
    createdAt: number;
    createdBy: ArtifactActor;
    updatedAt: number;
    lastUpdatedBy: ArtifactActor;
    status: ArtifactStatus;
    linkedTaskIds: string[];
    previewable: boolean;
    exportable: boolean;
    archived: boolean;
};
export type DocumentArtifactView = {
    artifact: DocumentArtifactSummary;
    content: string;
};
export declare function toDocumentArtifactSummary(artifact: ArtifactRecord): DocumentArtifactSummary;
