export interface PageContent {
    url: string;
    title: string;
    content: string;
}
export interface PageElements {
    url: string;
    elements: unknown[];
    forms: unknown[];
}
export interface PageMeta {
    tabId: string;
    url: string;
    title: string;
}
export interface SearchResult extends PageMeta {
    matchingLines: string[];
}
export declare class DiskCache {
    private baseDir;
    constructor(baseDir: string);
    private pagesDir;
    private contentPath;
    private elementsPath;
    private ensurePagesDir;
    private buildFrontmatter;
    private parseFrontmatter;
    writePageContent(taskId: string, tabId: string, data: PageContent): Promise<void>;
    writePageElements(taskId: string, tabId: string, data: PageElements): Promise<void>;
    searchPages(taskId: string, query: string, contextLines?: number): Promise<SearchResult[]>;
    readSection(taskId: string, tabId: string, sectionName: string): Promise<string | null>;
    listPages(taskId: string): Promise<PageMeta[]>;
    cleanup(taskId: string): Promise<void>;
}
