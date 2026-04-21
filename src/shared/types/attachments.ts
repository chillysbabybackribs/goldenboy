export type DocumentAttachmentStatus =
  | 'queued'
  | 'extracting'
  | 'indexed'
  | 'stored'
  | 'unsupported'
  | 'failed';

export type DocumentImportRequest = {
  /** Absolute path to a local file (Electron exposes `File.path` in the renderer). */
  path?: string;
  /** Raw file bytes as base64 when `path` is unavailable (e.g. sandboxed or browser-like picker). */
  dataBase64?: string;
  name?: string;
  mediaType?: string;
  sizeBytes?: number;
  lastModifiedMs?: number;
};

export type DocumentInvocationAttachment = {
  type: 'document';
  id: string;
  name: string;
  mediaType: string;
  sizeBytes: number;
  status: DocumentAttachmentStatus;
  statusDetail?: string | null;
  excerpt?: string;
  chunkCount: number;
  tokenEstimate: number;
  language: string;
};
