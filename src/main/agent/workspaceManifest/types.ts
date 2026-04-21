export type FileType =
  | 'code'
  | 'test'
  | 'doc'
  | 'skill'
  | 'config'
  | 'fixture'
  | 'asset'
  | 'other';

export interface ManifestFile {
  /** Path relative to the manifest root, forward slashes. */
  path: string;
  fileType: FileType;
  /** Short language tag (ts, tsx, py, md, json, etc.) or undefined for non-text. */
  language?: string;
  /** Short extracted purpose line (<= 180 chars), or undefined if unknown. */
  purpose?: string;
  sizeBytes: number;
}

export interface ManifestDirectory {
  /** Path relative to the manifest root, forward slashes. Empty string for root. */
  path: string;
  fileCount: number;
  subdirCount: number;
  /** Aggregate purpose from README / index / AGENTS.md / heuristic, if any. */
  purpose?: string;
}

export interface WorkspaceManifest {
  /** Absolute path. */
  root: string;
  generatedAt: string;
  files: ManifestFile[];
  directories: ManifestDirectory[];
}
