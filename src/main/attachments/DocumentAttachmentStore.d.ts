import type { DocumentImportRequest, DocumentInvocationAttachment } from '../../shared/types/attachments';
type StoredDocumentChunk = {
    id: string;
    attachmentId: string;
    taskId: string;
    ordinal: number;
    startLine: number;
    endLine: number;
    charCount: number;
    tokenEstimate: number;
    text: string;
};
export type DocumentSearchResult = {
    chunkId: string;
    attachmentId: string;
    name: string;
    startLine: number;
    endLine: number;
    snippet: string;
    score: number;
    tokenEstimate: number;
};
export type DocumentReadResult = {
    document: DocumentInvocationAttachment;
    content: string;
    truncated: boolean;
};
export type DocumentAttachmentStats = {
    documentCount: number;
    indexedDocumentCount: number;
    chunkCount: number;
    totalTokenEstimate: number;
    updatedAt: number | null;
};
export declare class DocumentAttachmentStore {
    private documents;
    private chunks;
    private updatedAt;
    constructor();
    importDocuments(taskId: string, documents: DocumentImportRequest[]): Promise<DocumentInvocationAttachment[]>;
    listTaskDocuments(taskId: string): DocumentInvocationAttachment[];
    search(taskId: string, query: string, input?: {
        limit?: number;
    }): DocumentSearchResult[];
    readChunk(taskId: string, chunkId: string, maxChars?: number): (StoredDocumentChunk & {
        text: string;
        truncated: boolean;
    }) | null;
    readDocument(taskId: string, documentId: string, maxChars?: number): DocumentReadResult | null;
    getStats(taskId: string): DocumentAttachmentStats;
    clearTask(taskId: string): void;
    private save;
    private findByTaskAndHash;
    private toInvocationAttachment;
}
export declare const documentAttachmentStore: DocumentAttachmentStore;
export {};
