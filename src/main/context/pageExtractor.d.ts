type ExecuteInPage = (expression: string, tabId?: string) => Promise<{
    result: unknown;
    error: string | null;
}>;
export type ContentResult = {
    url: string;
    title: string;
    content: string;
    tier: 'semantic' | 'readability';
};
export type StrippedElement = {
    id: string;
    role: string;
    text: string;
    selector: string;
    href: string | null;
};
export type ElementResult = {
    url: string;
    elements: StrippedElement[];
    forms: unknown[];
};
export declare class PageExtractor {
    private readonly executeInPage;
    constructor(executeInPage: ExecuteInPage);
    /**
     * Two-tier content extraction: semantic first, readability fallback if
     * the semantic tier produces fewer than 200 characters of markdown.
     */
    extractContent(tabId: string): Promise<ContentResult>;
    /**
     * Extract actionable elements and forms, stripping noise fields for disk storage.
     */
    extractElements(tabId: string): Promise<ElementResult>;
    private buildMarkdown;
    private readabilityFallback;
}
export {};
