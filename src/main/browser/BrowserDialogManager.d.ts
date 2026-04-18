import type { WebContentsView } from 'electron';
import { BrowserJavaScriptDialog, TabInfo } from '../../shared/types/browser';
type TabEntry = {
    id: string;
    view: WebContentsView;
    info: TabInfo;
};
type Deps = {
    resolveEntry: (tabId?: string) => TabEntry | undefined;
    resolveTabIdByWebContentsId: (webContentsId: number) => string | null;
    emitLog: (level: 'info' | 'warn' | 'error', message: string) => void;
    syncState: () => void;
};
export declare class BrowserDialogManager {
    private pendingDialogs;
    private promptDialogResolutions;
    private dialogDebuggerTabs;
    private deps;
    constructor(deps: Deps);
    installPromptShimInPage(entry: TabEntry): Promise<void>;
    ensureDebugger(entry: TabEntry): void;
    detachTab(tabId: string): void;
    clearPendingDialogsForTab(tabId: string): void;
    getPendingDialogs(tabId?: string): BrowserJavaScriptDialog[];
    openPromptDialogFallback(input: {
        webContentsId: number;
        message: string;
        defaultPrompt?: string;
        url?: string;
    }): {
        dialogId: string;
        created: boolean;
    };
    pollPromptDialogFallback(dialogId: string): {
        done: boolean;
        value: string | null;
    };
    acceptDialog(input?: {
        tabId?: string;
        dialogId?: string;
        promptText?: string;
    }, activeTabId?: string): Promise<{
        accepted: boolean;
        error: string | null;
        dialog: BrowserJavaScriptDialog | null;
    }>;
    dismissDialog(input?: {
        tabId?: string;
        dialogId?: string;
    }, activeTabId?: string): Promise<{
        dismissed: boolean;
        error: string | null;
        dialog: BrowserJavaScriptDialog | null;
    }>;
    dispose(): void;
    private normalizeJavaScriptDialogType;
    private resolveJavaScriptDialog;
}
export {};
