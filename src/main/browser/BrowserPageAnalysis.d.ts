import type { WebContentsView } from 'electron';
import type { BrowserActionableElement, BrowserSnapshot } from '../../shared/types/browserIntelligence';
import type { TabInfo } from '../../shared/types/browser';
type TabEntry = {
    id: string;
    view: WebContentsView;
    info: TabInfo;
};
type ResolveEntry = (tabId?: string) => TabEntry | undefined;
export type SearchResultCandidate = {
    index: number;
    title: string;
    url: string;
    snippet: string;
    selector: string;
    source: 'search' | 'generic';
};
export type PageEvidence = {
    tabId: string;
    url: string;
    title: string;
    mainHeading: string;
    summary: string;
    keyFacts: string[];
    quotes: string[];
    dates: string[];
    sourceLinks: string[];
    activeSurfaceType: BrowserSnapshot['viewport']['activeSurfaceType'];
    activeSurfaceLabel: string;
};
type Deps = {
    resolveEntry: ResolveEntry;
    getTabs: () => TabInfo[];
    createTab: (url: string) => TabInfo;
    activateTab: (tabId: string) => void;
    executeInPage: (expression: string, tabId?: string) => Promise<{
        result: unknown;
        error: string | null;
    }>;
    captureTabSnapshot: (tabId?: string) => Promise<BrowserSnapshot>;
    activeTabId: () => string;
};
export declare class BrowserPageAnalysis {
    private deps;
    constructor(deps: Deps);
    extractSearchResults(tabId?: string, limit?: number): Promise<SearchResultCandidate[]>;
    openSearchResultsTabs(input: {
        tabId?: string;
        indices?: number[];
        limit?: number;
        activateFirst?: boolean;
    }): Promise<{
        success: boolean;
        openedTabIds: string[];
        urls: string[];
        sourceResults: SearchResultCandidate[];
        error: string | null;
    }>;
    summarizeTabWorkingSet(tabIds?: string[]): Promise<Array<Record<string, unknown>>>;
    extractPageEvidence(tabId?: string): Promise<PageEvidence | null>;
    compareTabs(tabIds?: string[]): Promise<Record<string, unknown>>;
    synthesizeResearchBrief(input?: {
        tabIds?: string[];
        question?: string;
    }): Promise<Record<string, unknown>>;
    rankActionableElements(snapshot: BrowserSnapshot, options?: {
        preferDismiss?: boolean;
    }): Array<BrowserActionableElement & {
        rankScore: number;
        rankReason: string;
    }>;
}
export {};
