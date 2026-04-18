export const ARTIFACT_FORMATS = ['md', 'txt', 'html', 'csv'] as const;
export type ArtifactFormat = typeof ARTIFACT_FORMATS[number];

export const ARTIFACT_STATUSES = ['created', 'active', 'updating', 'failed', 'archived'] as const;
export type ArtifactStatus = typeof ARTIFACT_STATUSES[number];

export type ArtifactActor = 'user' | 'system' | string;

export type ArtifactRecord = {
  id: string;
  title: string;
  format: ArtifactFormat;
  workingPath: string;
  sourcePath?: string;
  createdBy: ArtifactActor;
  lastUpdatedBy: ArtifactActor;
  createdAt: number;
  updatedAt: number;
  status: ArtifactStatus;
  linkedTaskIds: string[];
  previewable: boolean;
  exportable: boolean;
  archived: boolean;
};

export type CreateArtifactInput = {
  title: string;
  format: ArtifactFormat;
  sourcePath?: string;
  createdBy: ArtifactActor;
  taskId?: string;
};

export type ArtifactMetadataPatch = Partial<Pick<
  ArtifactRecord,
  'title' | 'sourcePath' | 'lastUpdatedBy' | 'status' | 'previewable' | 'exportable' | 'archived'
>>;

export function isArtifactFormat(value: string): value is ArtifactFormat {
  return (ARTIFACT_FORMATS as readonly string[]).includes(value);
}

export function isArtifactStatus(value: string): value is ArtifactStatus {
  return (ARTIFACT_STATUSES as readonly string[]).includes(value);
}
