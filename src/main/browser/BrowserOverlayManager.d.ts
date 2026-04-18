import type { WebContentsView } from 'electron';
import type { BrowserActionableElement, BrowserSnapshot } from '../../shared/types/browserIntelligence';
import type { TabInfo } from '../../shared/types/browser';
type TabEntry = {
    id: string;
    view: WebContentsView;
    info: TabInfo;
};
type ResolveEntry = (tabId?: string) => TabEntry | undefined;
type Deps = {
    resolveEntry: ResolveEntry;
    captureTabSnapshot: (tabId?: string) => Promise<BrowserSnapshot>;
    executeInPage: (expression: string, tabId?: string) => Promise<{
        result: unknown;
        error: string | null;
    }>;
    clickElement: (selector: string, tabId?: string) => Promise<{
        clicked: boolean;
        error: string | null;
    }>;
    rankActionableElements: (snapshot: BrowserSnapshot, options?: {
        preferDismiss?: boolean;
    }) => Array<BrowserActionableElement & {
        rankScore: number;
        rankReason: string;
    }>;
};
export declare class BrowserOverlayManager {
    private deps;
    constructor(deps: Deps);
    clickRankedAction(input: {
        tabId?: string;
        index?: number;
        actionId?: string;
        preferDismiss?: boolean;
    }): Promise<{
        success: boolean;
        clickedAction: (BrowserActionableElement & {
            rankScore?: number;
            rankReason?: string;
        }) | null;
        error: string | null;
    }>;
    waitForOverlayState(state: 'open' | 'closed', timeoutMs?: number, tabId?: string): Promise<{
        success: boolean;
        state: 'open' | 'closed';
        observed: boolean;
        foregroundUiType: BrowserSnapshot['viewport']['foregroundUiType'];
        foregroundUiLabel: string;
        error: string | null;
    }>;
    dismissForegroundUI(tabId?: string): Promise<{
        success: boolean;
        method: string | null;
        target: string | null;
        targetSelector: string | null;
        beforeModalPresent: boolean;
        afterModalPresent: boolean;
        beforeForegroundUiType: BrowserSnapshot['viewport']['foregroundUiType'];
        beforeForegroundUiLabel: string;
        afterForegroundUiType: BrowserSnapshot['viewport']['foregroundUiType'];
        afterForegroundUiLabel: string;
        error: string | null;
    }>;
    returnToPrimarySurface(tabId?: string): Promise<{
        success: boolean;
        restored: boolean;
        steps: string[];
        error: string | null;
    }>;
}
export {};
