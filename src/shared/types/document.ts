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

export function toDocumentArtifactSummary(artifact: ArtifactRecord): DocumentArtifactSummary {
  return {
    id: artifact.id,
    title: artifact.title,
    format: artifact.format,
    createdAt: artifact.createdAt,
    createdBy: artifact.createdBy,
    updatedAt: artifact.updatedAt,
    lastUpdatedBy: artifact.lastUpdatedBy,
    status: artifact.status,
    linkedTaskIds: [...artifact.linkedTaskIds],
    previewable: artifact.previewable,
    exportable: artifact.exportable,
    archived: artifact.archived,
  };
}
