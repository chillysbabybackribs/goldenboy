import { BrowserSurfaceEvalFixture, BrowserSiteStrategy, BrowserActionableElement, BrowserFormModel, BrowserSnapshot } from '../../shared/types/browserIntelligence';
type ExecuteInPage = (expression: string, tabId?: string) => Promise<{
    result: unknown;
    error: string | null;
}>;
export declare class BrowserPerception {
    private readonly executeInPage;
    constructor(executeInPage: ExecuteInPage);
    captureTabSnapshot(tabId: string, strategy?: BrowserSiteStrategy | null): Promise<BrowserSnapshot>;
    getActionableElements(tabId: string, strategy?: BrowserSiteStrategy | null): Promise<BrowserActionableElement[]>;
    getFormModel(tabId: string, strategy?: BrowserSiteStrategy | null): Promise<BrowserFormModel[]>;
    exportSurfaceEvalFixture(tabId: string, name: string, strategy?: BrowserSiteStrategy | null): Promise<BrowserSurfaceEvalFixture>;
    private capturePerception;
}
export {};
