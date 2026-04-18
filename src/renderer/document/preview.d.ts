import type { DocumentArtifactView } from '../../shared/types/document';
export declare function renderMarkdownPreview(text: string): string;
export declare function parseCsvRows(text: string): string[][];
export declare function buildSandboxedHtmlDocument(content: string): string;
export declare function formatArtifactMeta(view: DocumentArtifactView): string;
