import type { WebContentsView } from 'electron';
type TabEntry = {
    id: string;
    view: WebContentsView;
};
type ResolveEntry = (tabId?: string) => TabEntry | undefined;
export type BrowserPointerHitTestResult = {
    ok: boolean;
    error: string | null;
    selector: string;
    x?: number;
    y?: number;
    globalX?: number;
    globalY?: number;
    hitSelector?: string | null;
    hitTagName?: string | null;
    hitId?: string | null;
    hitText?: string | null;
    targetSelector?: string | null;
    targetTagName?: string | null;
    targetId?: string | null;
    targetText?: string | null;
    intercepted?: boolean;
};
export declare class BrowserPageInteraction {
    private resolveEntry;
    constructor(resolveEntry: ResolveEntry);
    getPageText(maxLength?: number): Promise<string>;
    executeInPage(expression: string, tabId?: string): Promise<{
        result: unknown;
        error: string | null;
    }>;
    uploadFile(selector: string, filePath: string, tabId?: string): Promise<{
        uploaded: boolean;
        error: string | null;
        method?: string;
        selector?: string;
        filePath?: string;
        fileName?: string;
    }>;
    querySelectorAll(selector: string, tabId?: string, limit?: number): Promise<Array<{
        tag: string;
        text: string;
        href: string | null;
        id: string;
        classes: string[];
    }>>;
    clickElement(selector: string, tabId?: string): Promise<{
        clicked: boolean;
        error: string | null;
        method?: string;
        x?: number;
        y?: number;
        globalX?: number;
        globalY?: number;
        hitTest?: BrowserPointerHitTestResult;
    }>;
    hitTestElement(selector: string, tabId?: string): Promise<BrowserPointerHitTestResult>;
    hoverElement(selector: string, tabId?: string): Promise<{
        hovered: boolean;
        error: string | null;
        method?: string;
        selector?: string;
        x?: number;
        y?: number;
        globalX?: number;
        globalY?: number;
        hitTest?: BrowserPointerHitTestResult;
    }>;
    dragElement(sourceSelector: string, targetSelector: string, tabId?: string): Promise<{
        dragged: boolean;
        error: string | null;
        sourceSelector?: string;
        targetSelector?: string;
        method?: string;
        from?: {
            x: number;
            y: number;
        };
        to?: {
            x: number;
            y: number;
        };
        globalFrom?: {
            x: number;
            y: number;
        };
        globalTo?: {
            x: number;
            y: number;
        };
    }>;
    typeInElement(selector: string, text: string, tabId?: string): Promise<{
        typed: boolean;
        error: string | null;
    }>;
    getPageMetadata(tabId?: string): Promise<Record<string, unknown>>;
    private delay;
    private toGlobalPoint;
}
export {};
