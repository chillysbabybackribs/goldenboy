export type DocumentAttachmentStatus = 'queued' | 'extracting' | 'indexed' | 'stored' | 'unsupported' | 'failed';
export type DocumentImportRequest = {
    path: string;
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
